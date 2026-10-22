import {
  RECIPE_CATALOG,
  RECIPE_BY_ID,
  deriveRecipeAllergens,
  deriveRecipeDietFacts,
  optionalIngredientsToOmit,
  type RecipeSeed,
  type MealSlot,
} from '@/lib/content/recipes';
import { INGREDIENT_BY_ID, ALLERGEN_BY_ID } from '@/lib/content/nutrition-base';
import { createRng } from './rng';
import type { AgeBand } from './programming';

export const NUTRITION_VERSION = 'nutritionos-1.0.0';

export type Diet = 'vegetarian' | 'vegan' | 'eggetarian' | 'non_vegetarian' | 'no_preference';
export type CookingSkill = 'beginner' | 'intermediate' | 'confident';

export interface NutritionPreferences {
  diet: Diet;
  cuisines: string[];
  /** Allergen ids. This is a safety constraint and is applied as a hard filter. */
  allergenIds: string[];
  dislikedIngredientIds: string[];
  cookingSkill: CookingSkill;
  maxPrepMinutes: number;
  householdSize: number;
  includeSnacks: boolean;
  medicalDietaryNote?: string;
}

export interface RecipeEvaluation {
  recipe: RecipeSeed;
  eligible: boolean;
  /** Reasons the recipe was excluded. Empty when eligible. */
  exclusions: { kind: string; detail: string }[];
  score: number;
  /** Optional ingredients to leave out for this user (diet or dislike). */
  omitIngredientIds: string[];
  allergens: string[];
}

const SKILL_ORDER: CookingSkill[] = ['beginner', 'intermediate', 'confident'];

/**
 * Evaluates one recipe against a user's preferences.
 *
 * Hard filters (safety and identity): declared allergens, diet, disliked REQUIRED
 * ingredients, total time, cooking skill.
 * Soft scoring (preference): cuisine match, variety, high-protein tag.
 *
 * Allergen matching uses the recipe's derived allergen set, which includes allergens
 * from OPTIONAL ingredients. A recipe is never offered to someone with that allergy on
 * the assumption they will leave an ingredient out.
 */
export function evaluateRecipe(
  recipe: RecipeSeed,
  prefs: NutritionPreferences,
  opts: { slot?: MealSlot; recentRecipeIds?: string[]; rngValue?: number } = {},
): RecipeEvaluation {
  const exclusions: RecipeEvaluation['exclusions'] = [];
  const allergens = deriveRecipeAllergens(recipe);
  const facts = deriveRecipeDietFacts(recipe);

  for (const a of prefs.allergenIds) {
    if (allergens.includes(a)) {
      exclusions.push({
        kind: 'allergen',
        detail: `contains ${ALLERGEN_BY_ID.get(a)?.name ?? a}`,
      });
    }
  }

  switch (prefs.diet) {
    case 'vegan':
      if (!facts.vegan) exclusions.push({ kind: 'diet', detail: 'not vegan' });
      break;
    case 'vegetarian':
      if (!facts.vegetarian) exclusions.push({ kind: 'diet', detail: 'contains meat or fish' });
      if (facts.containsEgg) exclusions.push({ kind: 'diet', detail: 'contains egg' });
      break;
    case 'eggetarian':
      if (!facts.vegetarian) exclusions.push({ kind: 'diet', detail: 'contains meat or fish' });
      break;
    default:
      break;
  }

  const disliked = new Set(prefs.dislikedIngredientIds);
  const omitIngredientIds = new Set(optionalIngredientsToOmit(recipe, prefs.diet));
  for (const ri of recipe.ing) {
    if (!disliked.has(ri.id)) continue;
    if (ri.optional) {
      omitIngredientIds.add(ri.id);
    } else {
      exclusions.push({
        kind: 'disliked',
        detail: `contains ${INGREDIENT_BY_ID.get(ri.id)?.name ?? ri.id}`,
      });
    }
  }

  const totalMinutes = recipe.prep + recipe.cook;
  if (totalMinutes > prefs.maxPrepMinutes) {
    exclusions.push({
      kind: 'time',
      detail: `takes about ${totalMinutes} min, your limit is ${prefs.maxPrepMinutes} min`,
    });
  }

  const recipeSkill = recipe.skill ?? 'beginner';
  if (SKILL_ORDER.indexOf(recipeSkill) > SKILL_ORDER.indexOf(prefs.cookingSkill)) {
    exclusions.push({ kind: 'skill', detail: `rated ${recipeSkill}` });
  }

  if (opts.slot && !recipe.meals.includes(opts.slot)) {
    exclusions.push({ kind: 'slot', detail: `not suggested for ${opts.slot}` });
  }

  let score = 10;
  if (prefs.cuisines.length > 0 && prefs.cuisines.includes(recipe.cuisine)) score += 6;
  if (prefs.cuisines.length > 0 && !prefs.cuisines.includes(recipe.cuisine)) score -= 2;
  if (recipe.diet.includes('high_protein')) score += 1;
  if ((opts.recentRecipeIds ?? []).includes(recipe.id)) score -= 8;
  if (totalMinutes <= Math.round(prefs.maxPrepMinutes * 0.6)) score += 2;
  score += opts.rngValue ?? 0;

  return {
    recipe,
    eligible: exclusions.length === 0,
    exclusions,
    score,
    omitIngredientIds: [...omitIngredientIds],
    allergens,
  };
}

export interface FilterReport {
  eligible: RecipeEvaluation[];
  excluded: RecipeEvaluation[];
  /** Counts by exclusion kind, shown to the user so filtering is never invisible. */
  exclusionCounts: Record<string, number>;
}

export function filterRecipes(
  prefs: NutritionPreferences,
  opts: { slot?: MealSlot; recentRecipeIds?: string[]; catalog?: RecipeSeed[] } = {},
): FilterReport {
  const catalog = opts.catalog ?? RECIPE_CATALOG;
  const eligible: RecipeEvaluation[] = [];
  const excluded: RecipeEvaluation[] = [];
  const exclusionCounts: Record<string, number> = {};
  for (const recipe of catalog) {
    const evaluation = evaluateRecipe(recipe, prefs, opts);
    if (evaluation.eligible) eligible.push(evaluation);
    else {
      excluded.push(evaluation);
      for (const e of evaluation.exclusions) {
        exclusionCounts[e.kind] = (exclusionCounts[e.kind] ?? 0) + 1;
      }
    }
  }
  eligible.sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name));
  return { eligible, excluded, exclusionCounts };
}

/* ------------------------------------------------------------- meal planning */

export interface PlannedMealDraft {
  date: string;
  slot: MealSlot;
  recipeId: string;
  recipeName: string;
  servings: number;
  omitIngredientIds: string[];
  rationale: string;
}

export interface MealPlanDraft {
  weekStart: string;
  version: string;
  meals: PlannedMealDraft[];
  explanation: string[];
  warnings: string[];
  /** Per-slot alternatives, used by the swap UI. */
  alternatives: Record<string, { recipeId: string; name: string }[]>;
  inputsSnapshot: Record<string, unknown>;
}

export interface MealPlanContext {
  userId: string;
  weekStart: string;
  prefs: NutritionPreferences;
  ageBand: AgeBand;
  recentRecipeIds?: string[];
  days?: number;
  catalog?: RecipeSeed[];
}

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/**
 * Builds a week of meal suggestions.
 *
 * Deliberately NOT a diet: there are no calorie targets, no portion weighing and no
 * restriction. For under-18 accounts the planner refuses to apply any restriction at all
 * (see `assertNoMinorRestriction`).
 */
export function generateMealPlan(ctx: MealPlanContext): MealPlanDraft {
  const { prefs, weekStart } = ctx;
  const days = ctx.days ?? 7;
  const slots: MealSlot[] = prefs.includeSnacks ? [...SLOTS, 'snack'] : SLOTS;
  const warnings: string[] = [];
  const explanation: string[] = [];
  const meals: PlannedMealDraft[] = [];
  const alternatives: MealPlanDraft['alternatives'] = {};

  const servingsPerMeal = Math.max(1, prefs.householdSize);
  const usedRecentWindow: string[] = [...(ctx.recentRecipeIds ?? [])];

  const reportBySlot = new Map<MealSlot, FilterReport>();
  for (const slot of slots) {
    reportBySlot.set(
      slot,
      filterRecipes(prefs, { slot, recentRecipeIds: ctx.recentRecipeIds, catalog: ctx.catalog }),
    );
  }

  for (let dayIdx = 0; dayIdx < days; dayIdx += 1) {
    const date = addDays(weekStart, dayIdx);
    const usedToday = new Set<string>();
    for (const slot of slots) {
      const report = reportBySlot.get(slot);
      if (!report || report.eligible.length === 0) {
        warnings.push(
          `No recipe in the library fits your preferences for ${slot}. Nothing was invented — widen a preference or add your own recipes.`,
        );
        continue;
      }
      const rng = createRng(ctx.userId, weekStart, date, slot);
      const ranked = report.eligible
        .map((evaluation) => {
          let score = evaluation.score + rng() * 3;
          // Keep variety: strongly avoid anything used in the last few days.
          const recentIdx = usedRecentWindow.lastIndexOf(evaluation.recipe.id);
          if (recentIdx >= 0) score -= 12;
          if (usedToday.has(evaluation.recipe.id)) score -= 100;
          return { evaluation, score };
        })
        .sort(
          (a, b) =>
            b.score - a.score || a.evaluation.recipe.name.localeCompare(b.evaluation.recipe.name),
        );

      const chosen = ranked[0];
      if (!chosen) continue;
      const { recipe, omitIngredientIds } = chosen.evaluation;
      meals.push({
        date,
        slot,
        recipeId: recipe.id,
        recipeName: recipe.name,
        servings: servingsPerMeal,
        omitIngredientIds,
        rationale: buildMealRationale(chosen.evaluation, prefs),
      });
      usedToday.add(recipe.id);
      usedRecentWindow.push(recipe.id);
      if (usedRecentWindow.length > 12) usedRecentWindow.shift();

      alternatives[`${date}:${slot}`] = ranked
        .slice(1, 6)
        .map((r) => ({ recipeId: r.evaluation.recipe.id, name: r.evaluation.recipe.name }));
    }
  }

  const totalCatalog = (ctx.catalog ?? RECIPE_CATALOG).length;
  explanation.push(
    `${days} day(s) planned across ${slots.join(', ')} from a library of ${totalCatalog} recipes.`,
  );
  if (prefs.allergenIds.length > 0) {
    const names = prefs.allergenIds.map((a) => ALLERGEN_BY_ID.get(a)?.name ?? a).join(', ');
    const blocked = new Set<string>();
    for (const report of reportBySlot.values()) {
      for (const e of report.excluded) {
        if (e.exclusions.some((x) => x.kind === 'allergen')) blocked.add(e.recipe.id);
      }
    }
    explanation.push(
      `Allergens excluded: ${names}. ${blocked.size} recipe(s) were removed entirely, including any where the allergen appears only as an optional ingredient.`,
    );
  }
  if (prefs.diet !== 'no_preference') {
    explanation.push(`Diet: ${prefs.diet.replace(/_/g, ' ')}.`);
  }
  if (prefs.cuisines.length > 0) {
    explanation.push(`Preferred cuisines favoured: ${prefs.cuisines.join(', ')}.`);
  }
  explanation.push(
    `Nothing takes longer than ${prefs.maxPrepMinutes} minutes end to end, and everything is rated at or below "${prefs.cookingSkill}" difficulty.`,
  );
  explanation.push(`Portions are set for a household of ${servingsPerMeal}.`);
  explanation.push(
    'There are no calorie targets and no portion weighing. Swap anything you like — the grocery list follows your changes.',
  );

  if (ctx.ageBand !== 'adult_18_plus') {
    explanation.push(
      'This is an age-appropriate plan: balanced meals with no restriction, no calorie limits and no weight targets.',
    );
  }
  if (prefs.medicalDietaryNote && prefs.medicalDietaryNote.trim().length > 0) {
    warnings.push(
      'You have recorded a medical dietary requirement. GymOS does not build therapeutic diets — please have a qualified dietitian review anything here before you rely on it.',
    );
  }

  return {
    weekStart,
    version: NUTRITION_VERSION,
    meals,
    explanation,
    warnings,
    alternatives,
    inputsSnapshot: {
      diet: prefs.diet,
      cuisines: prefs.cuisines,
      allergenIds: prefs.allergenIds,
      dislikedIngredientIds: prefs.dislikedIngredientIds,
      cookingSkill: prefs.cookingSkill,
      maxPrepMinutes: prefs.maxPrepMinutes,
      householdSize: prefs.householdSize,
      includeSnacks: prefs.includeSnacks,
      ageBand: ctx.ageBand,
      days,
    },
  };
}

function buildMealRationale(evaluation: RecipeEvaluation, prefs: NutritionPreferences): string {
  const parts: string[] = [];
  const r = evaluation.recipe;
  if (prefs.cuisines.includes(r.cuisine)) parts.push(`${r.cuisine.replace(/_/g, ' ')} — one of your preferred cuisines.`);
  parts.push(`About ${r.prep + r.cook} minutes total.`);
  if (prefs.allergenIds.length > 0) {
    parts.push(`Free of your declared allergens.`);
  }
  if (evaluation.omitIngredientIds.length > 0) {
    const names = evaluation.omitIngredientIds
      .map((id) => INGREDIENT_BY_ID.get(id)?.name ?? id)
      .join(', ');
    parts.push(`Leave out the optional ${names} to fit your preferences.`);
  }
  return parts.join(' ');
}

/** Swap options for one slot, respecting every hard filter. */
export function findMealAlternatives(
  slot: MealSlot,
  prefs: NutritionPreferences,
  opts: { excludeRecipeIds?: string[]; limit?: number; catalog?: RecipeSeed[] } = {},
): RecipeEvaluation[] {
  const report = filterRecipes(prefs, { slot, catalog: opts.catalog });
  const exclude = new Set(opts.excludeRecipeIds ?? []);
  return report.eligible.filter((e) => !exclude.has(e.recipe.id)).slice(0, opts.limit ?? 8);
}

/**
 * Guard used by every nutrition write path. Restriction features are not merely
 * hidden for minors — the server refuses them.
 */
export function assertNoMinorRestriction(ageBand: AgeBand, payload: Record<string, unknown>): void {
  if (ageBand === 'adult_18_plus') return;
  const banned = ['calorieTarget', 'calorieCeiling', 'weightGoalKg', 'deficit', 'bodyFatTarget'];
  for (const key of banned) {
    if (payload[key] !== undefined && payload[key] !== null) {
      throw new Error(
        `Restriction-style nutrition settings are not available for under-18 accounts (blocked: ${key}).`,
      );
    }
  }
}

export function recipeName(id: string): string {
  return RECIPE_BY_ID.get(id)?.name ?? id;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
