import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  nutritionPrefs,
  mealPlans,
  plannedMeals,
  pantryItems,
  groceryLists,
  groceryItems,
  userIngredientPrices,
  userProfiles,
} from '@/lib/db/schema';
import {
  generateMealPlan,
  filterRecipes,
  findMealAlternatives,
  assertNoMinorRestriction,
  mondayOf,
  type NutritionPreferences,
  type MealPlanDraft,
} from '@/lib/engines/nutrition';
import { buildGroceryList, recipesFromPantry, type PantryEntry } from '@/lib/engines/grocery';
import { RECIPE_BY_ID, RECIPE_CATALOG, deriveRecipeAllergens } from '@/lib/content/recipes';
import { INGREDIENT_BY_ID, INGREDIENT_CATEGORY_LABELS } from '@/lib/content/nutrition-base';
import { newId, newToken } from '@/lib/auth/ids';
import { NotFoundError } from './equipment';
import { requireEntitlement } from './entitlements';
import { getEntitlement, type Plan } from '@/lib/engines/entitlements';
import type { AgeBand } from '@/lib/engines/programming';

const DEFAULT_PREFS: NutritionPreferences = {
  diet: 'no_preference',
  cuisines: [],
  allergenIds: [],
  dislikedIngredientIds: [],
  cookingSkill: 'beginner',
  maxPrepMinutes: 45,
  householdSize: 1,
  includeSnacks: false,
  medicalDietaryNote: '',
};

export function getNutritionPrefs(userId: string): NutritionPreferences {
  const row = db.select().from(nutritionPrefs).where(eq(nutritionPrefs.userId, userId)).get();
  if (!row) return { ...DEFAULT_PREFS };
  return {
    diet: row.diet,
    cuisines: row.cuisines,
    allergenIds: row.allergenIds,
    dislikedIngredientIds: row.dislikedIngredientIds,
    cookingSkill: row.cookingSkill,
    maxPrepMinutes: row.maxPrepMinutes,
    householdSize: row.householdSize,
    includeSnacks: row.includeSnacks,
    medicalDietaryNote: row.medicalDietaryNote,
  };
}

export function saveNutritionPrefs(
  userId: string,
  ageBand: AgeBand,
  input: Partial<NutritionPreferences> & Record<string, unknown>,
): void {
  // Refuses restriction-style settings for minors at the write path, not just in the UI.
  assertNoMinorRestriction(ageBand, input);
  const current = getNutritionPrefs(userId);
  const merged = { ...current, ...input } as NutritionPreferences;
  db.insert(nutritionPrefs)
    .values({
      userId,
      diet: merged.diet,
      cuisines: merged.cuisines,
      allergenIds: merged.allergenIds,
      dislikedIngredientIds: merged.dislikedIngredientIds,
      cookingSkill: merged.cookingSkill,
      maxPrepMinutes: Math.max(5, Math.min(240, merged.maxPrepMinutes)),
      householdSize: Math.max(1, Math.min(12, merged.householdSize)),
      includeSnacks: merged.includeSnacks,
      medicalDietaryNote: (merged.medicalDietaryNote ?? '').slice(0, 500),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: nutritionPrefs.userId,
      set: {
        diet: merged.diet,
        cuisines: merged.cuisines,
        allergenIds: merged.allergenIds,
        dislikedIngredientIds: merged.dislikedIngredientIds,
        cookingSkill: merged.cookingSkill,
        maxPrepMinutes: Math.max(5, Math.min(240, merged.maxPrepMinutes)),
        householdSize: Math.max(1, Math.min(12, merged.householdSize)),
        includeSnacks: merged.includeSnacks,
        medicalDietaryNote: (merged.medicalDietaryNote ?? '').slice(0, 500),
        updatedAt: new Date().toISOString(),
      },
    })
    .run();
}

function ageBandOf(userId: string): AgeBand {
  const row = db
    .select({ ageBand: userProfiles.ageBand })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .get();
  return row?.ageBand ?? 'adult_18_plus';
}

/* ------------------------------------------------------------- meal planning */

export function buildMealPlanDraft(
  userId: string,
  plan: Plan,
  opts: { weekStart?: string; days?: number } = {},
): MealPlanDraft {
  const prefs = getNutritionPrefs(userId);
  const allowedDays = getEntitlement(plan, 'meal_plan_days').limitValue ?? 7;
  const days = Math.min(opts.days ?? allowedDays, allowedDays);
  const draft = generateMealPlan({
    userId,
    weekStart: opts.weekStart ?? mondayOf(new Date().toISOString().slice(0, 10)),
    prefs,
    ageBand: ageBandOf(userId),
    recentRecipeIds: recentRecipeIds(userId),
    days,
  });
  if (plan === 'free' && days < 7) {
    draft.explanation.push(
      `Your free plan covers ${days} day(s) of meal suggestions. GymOS Pro plans the full week.`,
    );
  }
  return draft;
}

export function recentRecipeIds(userId: string, limit = 20): string[] {
  const rows = db
    .select({ recipeId: plannedMeals.recipeId })
    .from(plannedMeals)
    .innerJoin(mealPlans, eq(mealPlans.id, plannedMeals.mealPlanId))
    .where(eq(mealPlans.userId, userId))
    .orderBy(desc(plannedMeals.date))
    .limit(limit)
    .all();
  return rows.map((r) => r.recipeId);
}

export function saveMealPlan(userId: string, draft: MealPlanDraft): string {
  const id = newId();
  db.transaction((tx) => {
    const existing = tx
      .select({ id: mealPlans.id })
      .from(mealPlans)
      .where(and(eq(mealPlans.userId, userId), eq(mealPlans.weekStart, draft.weekStart)))
      .get();
    if (existing) {
      tx.delete(mealPlans).where(eq(mealPlans.id, existing.id)).run();
    }
    tx.update(mealPlans).set({ isActive: false }).where(eq(mealPlans.userId, userId)).run();
    tx.insert(mealPlans)
      .values({
        id,
        userId,
        weekStart: draft.weekStart,
        isActive: true,
        inputsSnapshot: draft.inputsSnapshot,
        explanation: draft.explanation,
      })
      .run();
    for (const meal of draft.meals) {
      tx.insert(plannedMeals)
        .values({
          id: newId(),
          mealPlanId: id,
          date: meal.date,
          slot: meal.slot,
          recipeId: meal.recipeId,
          servings: meal.servings,
          status: 'planned',
        })
        .run();
    }
  });
  return id;
}

export interface MealPlanView {
  id: string;
  weekStart: string;
  explanation: string[];
  meals: {
    id: string;
    date: string;
    slot: string;
    recipeId: string;
    recipeName: string;
    servings: number;
    status: string;
    swappedFromRecipeId: string | null;
    totalMinutes: number;
    cuisine: string;
    allergens: string[];
  }[];
}

export function getActiveMealPlan(userId: string): MealPlanView | null {
  const plan = db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.userId, userId), eq(mealPlans.isActive, true)))
    .get();
  if (!plan) return null;
  return hydrateMealPlan(plan);
}

export function getMealPlan(userId: string, planId: string): MealPlanView {
  const plan = db
    .select()
    .from(mealPlans)
    .where(and(eq(mealPlans.id, planId), eq(mealPlans.userId, userId)))
    .get();
  if (!plan) throw new NotFoundError('That meal plan does not exist.');
  return hydrateMealPlan(plan);
}

function hydrateMealPlan(plan: typeof mealPlans.$inferSelect): MealPlanView {
  const meals = db
    .select()
    .from(plannedMeals)
    .where(eq(plannedMeals.mealPlanId, plan.id))
    .orderBy(plannedMeals.date, plannedMeals.slot)
    .all();
  return {
    id: plan.id,
    weekStart: plan.weekStart,
    explanation: plan.explanation,
    meals: meals.map((m) => {
      const recipe = RECIPE_BY_ID.get(m.recipeId);
      return {
        id: m.id,
        date: m.date,
        slot: m.slot,
        recipeId: m.recipeId,
        recipeName: recipe?.name ?? m.recipeId,
        servings: m.servings,
        status: m.status,
        swappedFromRecipeId: m.swappedFromRecipeId,
        totalMinutes: (recipe?.prep ?? 0) + (recipe?.cook ?? 0),
        cuisine: recipe?.cuisine ?? '',
        allergens: recipe ? deriveRecipeAllergens(recipe) : [],
      };
    }),
  };
}

/**
 * Swaps one planned meal. The replacement is re-checked against the user's hard
 * filters, so a swap can never slip an allergen past the planner.
 */
export function swapMeal(userId: string, plannedMealId: string, newRecipeId: string): void {
  const row = db
    .select({
      id: plannedMeals.id,
      recipeId: plannedMeals.recipeId,
      slot: plannedMeals.slot,
      mealPlanId: plannedMeals.mealPlanId,
    })
    .from(plannedMeals)
    .innerJoin(mealPlans, eq(mealPlans.id, plannedMeals.mealPlanId))
    .where(and(eq(plannedMeals.id, plannedMealId), eq(mealPlans.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That planned meal does not exist.');

  const recipe = RECIPE_BY_ID.get(newRecipeId);
  if (!recipe) throw new NotFoundError('Unknown recipe.');

  const prefs = getNutritionPrefs(userId);
  const report = filterRecipes(prefs, { slot: row.slot as never });
  const allowed = report.eligible.find((e) => e.recipe.id === newRecipeId);
  if (!allowed) {
    const blocked = report.excluded.find((e) => e.recipe.id === newRecipeId);
    const reasons = blocked?.exclusions.map((x) => x.detail).join('; ') ?? 'it does not match your preferences';
    throw new Error(`${recipe.name} cannot be added: ${reasons}.`);
  }

  db.update(plannedMeals)
    .set({ recipeId: newRecipeId, swappedFromRecipeId: row.recipeId, status: 'planned' })
    .where(eq(plannedMeals.id, plannedMealId))
    .run();
}

export function mealAlternatives(userId: string, plannedMealId: string) {
  const row = db
    .select({ slot: plannedMeals.slot, recipeId: plannedMeals.recipeId })
    .from(plannedMeals)
    .innerJoin(mealPlans, eq(mealPlans.id, plannedMeals.mealPlanId))
    .where(and(eq(plannedMeals.id, plannedMealId), eq(mealPlans.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That planned meal does not exist.');
  const prefs = getNutritionPrefs(userId);
  return findMealAlternatives(row.slot as never, prefs, {
    excludeRecipeIds: [row.recipeId],
    limit: 8,
  }).map((e) => ({
    recipeId: e.recipe.id,
    name: e.recipe.name,
    cuisine: e.recipe.cuisine,
    totalMinutes: e.recipe.prep + e.recipe.cook,
    omitIngredientIds: e.omitIngredientIds,
  }));
}

export function setMealStatus(userId: string, plannedMealId: string, status: 'planned' | 'cooked' | 'skipped'): void {
  const row = db
    .select({ id: plannedMeals.id })
    .from(plannedMeals)
    .innerJoin(mealPlans, eq(mealPlans.id, plannedMeals.mealPlanId))
    .where(and(eq(plannedMeals.id, plannedMealId), eq(mealPlans.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That planned meal does not exist.');
  db.update(plannedMeals).set({ status }).where(eq(plannedMeals.id, plannedMealId)).run();
}

/* ------------------------------------------------------------------- pantry */

export function listPantry(userId: string) {
  return db
    .select({
      id: pantryItems.id,
      ingredientId: pantryItems.ingredientId,
      quantity: pantryItems.quantity,
      unit: pantryItems.unit,
      addedAt: pantryItems.addedAt,
      bestBefore: pantryItems.bestBefore,
      notes: pantryItems.notes,
    })
    .from(pantryItems)
    .where(eq(pantryItems.userId, userId))
    .all()
    .map((p) => ({
      ...p,
      name: INGREDIENT_BY_ID.get(p.ingredientId)?.name ?? p.ingredientId,
      category: INGREDIENT_BY_ID.get(p.ingredientId)?.category ?? 'other',
      categoryLabel:
        INGREDIENT_CATEGORY_LABELS[INGREDIENT_BY_ID.get(p.ingredientId)?.category ?? 'other'] ?? 'Other',
    }));
}

export function upsertPantryItem(
  userId: string,
  plan: Plan,
  input: { ingredientId: string; quantity: number; unit: string; bestBefore?: string | null; notes?: string },
): void {
  requireEntitlement(plan, userId, 'pantry');
  if (!INGREDIENT_BY_ID.has(input.ingredientId)) throw new NotFoundError('Unknown ingredient.');
  db.insert(pantryItems)
    .values({
      id: newId(),
      userId,
      ingredientId: input.ingredientId,
      quantity: Math.max(0, input.quantity),
      unit: input.unit,
      bestBefore: input.bestBefore ?? null,
      notes: (input.notes ?? '').slice(0, 300),
    })
    .onConflictDoUpdate({
      target: [pantryItems.userId, pantryItems.ingredientId, pantryItems.unit],
      set: {
        quantity: Math.max(0, input.quantity),
        bestBefore: input.bestBefore ?? null,
        notes: (input.notes ?? '').slice(0, 300),
      },
    })
    .run();
}

export function deletePantryItem(userId: string, id: string): void {
  db.delete(pantryItems).where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId))).run();
}

/** Recipes you can mostly make from what is in the pantry, with allergens respected. */
export function pantrySuggestions(userId: string) {
  const prefs = getNutritionPrefs(userId);
  const report = filterRecipes(prefs);
  const eligibleIds = new Set(report.eligible.map((e) => e.recipe.id));
  const pantry: PantryEntry[] = listPantry(userId).map((p) => ({
    ingredientId: p.ingredientId,
    quantity: p.quantity,
    unit: p.unit,
  }));
  return recipesFromPantry(
    pantry,
    RECIPE_CATALOG.filter((r) => eligibleIds.has(r.id)),
    { minCoverage: 0.5 },
  ).slice(0, 12);
}

/* ------------------------------------------------------------------ grocery */

export function userPriceMap(userId: string): Record<string, { paise: number; unit: string; perQuantity: number }> {
  const rows = db
    .select()
    .from(userIngredientPrices)
    .where(eq(userIngredientPrices.userId, userId))
    .all();
  const out: Record<string, { paise: number; unit: string; perQuantity: number }> = {};
  for (const r of rows) {
    out[r.ingredientId] = { paise: r.pricePaise, unit: r.unit, perQuantity: r.perQuantity };
  }
  return out;
}

export function recordIngredientPrice(
  userId: string,
  input: { ingredientId: string; pricePaise: number; perQuantity: number; unit: string },
): void {
  if (!INGREDIENT_BY_ID.has(input.ingredientId)) throw new NotFoundError('Unknown ingredient.');
  db.insert(userIngredientPrices)
    .values({
      id: newId(),
      userId,
      ingredientId: input.ingredientId,
      pricePaise: Math.max(0, Math.round(input.pricePaise)),
      perQuantity: Math.max(0.01, input.perQuantity),
      unit: input.unit,
    })
    .onConflictDoUpdate({
      target: [userIngredientPrices.userId, userIngredientPrices.ingredientId, userIngredientPrices.unit],
      set: {
        pricePaise: Math.max(0, Math.round(input.pricePaise)),
        perQuantity: Math.max(0.01, input.perQuantity),
        recordedAt: new Date().toISOString(),
      },
    })
    .run();
}

export function generateGroceryList(
  userId: string,
  plan: Plan,
  opts: { mealPlanId?: string; name?: string; includeOptional?: boolean } = {},
): string {
  requireEntitlement(plan, userId, 'grocery_lists');
  const mealPlan = opts.mealPlanId ? getMealPlan(userId, opts.mealPlanId) : getActiveMealPlan(userId);
  if (!mealPlan) throw new NotFoundError('Create a meal plan first.');

  const prefs = getNutritionPrefs(userId);
  const report = filterRecipes(prefs);
  const omitByRecipe = new Map(report.eligible.map((e) => [e.recipe.id, e.omitIngredientIds]));

  const result = buildGroceryList(
    mealPlan.meals
      .filter((m) => m.status !== 'skipped')
      .map((m) => ({
        recipeId: m.recipeId,
        servings: m.servings,
        omitIngredientIds: omitByRecipe.get(m.recipeId) ?? [],
      })),
    {
      pantry: listPantry(userId).map((p) => ({
        ingredientId: p.ingredientId,
        quantity: p.quantity,
        unit: p.unit,
      })),
      userPrices: userPriceMap(userId),
      includeOptional: opts.includeOptional ?? false,
    },
  );

  const listId = newId();
  db.transaction((tx) => {
    tx.insert(groceryLists)
      .values({
        id: listId,
        userId,
        mealPlanId: mealPlan.id,
        name: opts.name ?? `Groceries for week of ${mealPlan.weekStart}`,
      })
      .run();
    for (const line of result.lines) {
      tx.insert(groceryItems)
        .values({
          id: newId(),
          listId,
          ingredientId: line.ingredientId,
          quantity: line.quantity,
          unit: line.unit,
          category: line.category,
          source: 'generated',
          estimatedPaise: line.estimatedPaise,
          note: line.notes.join('; ').slice(0, 300),
        })
        .run();
    }
  });
  return listId;
}

export function listGroceryLists(userId: string) {
  return db
    .select({
      id: groceryLists.id,
      name: groceryLists.name,
      createdAt: groceryLists.createdAt,
      shareToken: groceryLists.shareToken,
      itemCount: sql<number>`(select count(*) from grocery_items gi where gi.list_id = ${groceryLists.id})`,
      purchasedCount: sql<number>`(select count(*) from grocery_items gi where gi.list_id = ${groceryLists.id} and gi.purchased = 1)`,
    })
    .from(groceryLists)
    .where(eq(groceryLists.userId, userId))
    .orderBy(desc(groceryLists.createdAt))
    .all();
}

export function getGroceryList(userId: string, listId: string) {
  const list = db
    .select()
    .from(groceryLists)
    .where(and(eq(groceryLists.id, listId), eq(groceryLists.userId, userId)))
    .get();
  if (!list) throw new NotFoundError('That grocery list does not exist.');
  const items = db
    .select()
    .from(groceryItems)
    .where(eq(groceryItems.listId, listId))
    .all()
    .map((item) => ({
      ...item,
      name: item.customName ?? INGREDIENT_BY_ID.get(item.ingredientId ?? '')?.name ?? 'Item',
      categoryLabel: INGREDIENT_CATEGORY_LABELS[item.category] ?? 'Other',
    }));
  const pricedCount = items.filter((i) => i.estimatedPaise != null).length;
  const total = items.reduce((s, i) => s + (i.estimatedPaise ?? 0), 0);
  return {
    list,
    items: items.sort(
      (a, b) => a.categoryLabel.localeCompare(b.categoryLabel) || a.name.localeCompare(b.name),
    ),
    pricedCount,
    totalEstimatedPaise: pricedCount > 0 ? total : null,
  };
}

export function toggleGroceryItem(userId: string, itemId: string, purchased: boolean): void {
  const row = db
    .select({ id: groceryItems.id })
    .from(groceryItems)
    .innerJoin(groceryLists, eq(groceryLists.id, groceryItems.listId))
    .where(and(eq(groceryItems.id, itemId), eq(groceryLists.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That item does not exist.');
  db.update(groceryItems).set({ purchased }).where(eq(groceryItems.id, itemId)).run();
}

export function addGroceryItem(
  userId: string,
  listId: string,
  input: { customName?: string; ingredientId?: string; quantity?: number; unit?: string },
): void {
  getGroceryList(userId, listId);
  const category = input.ingredientId
    ? (INGREDIENT_BY_ID.get(input.ingredientId)?.category ?? 'other')
    : 'other';
  db.insert(groceryItems)
    .values({
      id: newId(),
      listId,
      ingredientId: input.ingredientId ?? null,
      customName: input.customName?.slice(0, 80) ?? null,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      category,
      source: 'manual',
    })
    .run();
}

export function deleteGroceryItem(userId: string, itemId: string): void {
  const row = db
    .select({ id: groceryItems.id })
    .from(groceryItems)
    .innerJoin(groceryLists, eq(groceryLists.id, groceryItems.listId))
    .where(and(eq(groceryItems.id, itemId), eq(groceryLists.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That item does not exist.');
  db.delete(groceryItems).where(eq(groceryItems.id, itemId)).run();
}

export function shareGroceryList(userId: string, listId: string): string {
  getGroceryList(userId, listId);
  const token = newToken(16);
  db.update(groceryLists)
    .set({ shareToken: token, updatedAt: new Date().toISOString() })
    .where(eq(groceryLists.id, listId))
    .run();
  return token;
}

export function unshareGroceryList(userId: string, listId: string): void {
  getGroceryList(userId, listId);
  db.update(groceryLists).set({ shareToken: null }).where(eq(groceryLists.id, listId)).run();
}

/** Read-only public view of a shared list. Contains no personal data beyond the items. */
export function getSharedGroceryList(token: string) {
  const list = db.select().from(groceryLists).where(eq(groceryLists.shareToken, token)).get();
  if (!list) return null;
  const items = db
    .select()
    .from(groceryItems)
    .where(eq(groceryItems.listId, list.id))
    .all()
    .map((item) => ({
      name: item.customName ?? INGREDIENT_BY_ID.get(item.ingredientId ?? '')?.name ?? 'Item',
      quantity: item.quantity,
      unit: item.unit,
      categoryLabel: INGREDIENT_CATEGORY_LABELS[item.category] ?? 'Other',
      purchased: item.purchased,
    }));
  return { name: list.name, items };
}

export function deleteGroceryList(userId: string, listId: string): void {
  getGroceryList(userId, listId);
  db.delete(groceryLists).where(eq(groceryLists.id, listId)).run();
}

export function recipeIdsInPlan(userId: string, planId: string): string[] {
  const rows = db
    .select({ recipeId: plannedMeals.recipeId })
    .from(plannedMeals)
    .innerJoin(mealPlans, eq(mealPlans.id, plannedMeals.mealPlanId))
    .where(and(eq(mealPlans.userId, userId), eq(mealPlans.id, planId)))
    .all();
  return [...new Set(rows.map((r) => r.recipeId))];
}

export function listMealPlanHistory(userId: string) {
  return db
    .select({
      id: mealPlans.id,
      weekStart: mealPlans.weekStart,
      isActive: mealPlans.isActive,
      createdAt: mealPlans.createdAt,
      mealCount: sql<number>`(select count(*) from planned_meals pm where pm.meal_plan_id = ${mealPlans.id})`,
    })
    .from(mealPlans)
    .where(eq(mealPlans.userId, userId))
    .orderBy(desc(mealPlans.weekStart))
    .limit(20)
    .all();
}

export { inArray };
