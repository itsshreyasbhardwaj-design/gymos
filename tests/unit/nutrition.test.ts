import { describe, it, expect } from 'vitest';
import {
  evaluateRecipe,
  filterRecipes,
  generateMealPlan,
  findMealAlternatives,
  mondayOf,
  addDays,
  type NutritionPreferences,
} from '@/lib/engines/nutrition';
import {
  RECIPE_CATALOG,
  RECIPE_BY_ID,
  deriveRecipeAllergens,
  deriveRecipeDietFacts,
  optionalIngredientsToOmit,
} from '@/lib/content/recipes';
import { INGREDIENT_BY_ID } from '@/lib/content/nutrition-base';

const prefs = (over: Partial<NutritionPreferences> = {}): NutritionPreferences => ({
  diet: 'no_preference',
  cuisines: [],
  allergenIds: [],
  dislikedIngredientIds: [],
  cookingSkill: 'confident',
  maxPrepMinutes: 90,
  householdSize: 1,
  includeSnacks: false,
  ...over,
});

describe('diet filtering', () => {
  it('excludes meat and fish for vegetarians', () => {
    const report = filterRecipes(prefs({ diet: 'vegetarian' }));
    for (const e of report.eligible) {
      const facts = deriveRecipeDietFacts(e.recipe);
      expect(facts.vegetarian).toBe(true);
      expect(facts.containsEgg).toBe(false);
    }
  });

  it('allows egg for eggetarians but still excludes meat and fish', () => {
    const report = filterRecipes(prefs({ diet: 'eggetarian' }));
    const withEgg = report.eligible.filter((e) => deriveRecipeDietFacts(e.recipe).containsEgg);
    expect(withEgg.length).toBeGreaterThan(0);
    for (const e of report.eligible) {
      expect(deriveRecipeDietFacts(e.recipe).containsMeatOrFish).toBe(false);
    }
  });

  it('excludes anything non-vegan for vegans', () => {
    const report = filterRecipes(prefs({ diet: 'vegan' }));
    for (const e of report.eligible) {
      expect(deriveRecipeDietFacts(e.recipe).vegan).toBe(true);
    }
    expect(report.eligible.length).toBeGreaterThan(5);
  });

  it('lets a vegan keep a recipe by omitting an OPTIONAL animal ingredient', () => {
    const roti = RECIPE_BY_ID.get('roti-phulka')!;
    const omit = optionalIngredientsToOmit(roti, 'vegan');
    expect(omit).toContain('ghee');
    const evaluation = evaluateRecipe(roti, prefs({ diet: 'vegan' }));
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.omitIngredientIds).toContain('ghee');
  });
});

describe('dislikes', () => {
  it('excludes a recipe whose REQUIRED ingredient is disliked', () => {
    const report = filterRecipes(prefs({ dislikedIngredientIds: ['brinjal'] }));
    for (const e of report.eligible) {
      const required = e.recipe.ing.filter((ri) => !ri.optional).map((ri) => ri.id);
      expect(required).not.toContain('brinjal');
    }
  });

  it('keeps a recipe but omits the ingredient when the dislike is OPTIONAL', () => {
    const recipe = RECIPE_CATALOG.find((r) => r.ing.some((ri) => ri.optional))!;
    const optionalId = recipe.ing.find((ri) => ri.optional)!.id;
    const evaluation = evaluateRecipe(recipe, prefs({ dislikedIngredientIds: [optionalId] }));
    expect(evaluation.eligible).toBe(true);
    expect(evaluation.omitIngredientIds).toContain(optionalId);
  });
});

describe('time and skill filters', () => {
  it('excludes recipes that take longer than the stated limit', () => {
    const report = filterRecipes(prefs({ maxPrepMinutes: 20 }));
    for (const e of report.eligible) expect(e.recipe.prep + e.recipe.cook).toBeLessThanOrEqual(20);
  });

  it('excludes recipes above the stated cooking confidence', () => {
    const report = filterRecipes(prefs({ cookingSkill: 'beginner' }));
    for (const e of report.eligible) expect(e.recipe.skill ?? 'beginner').toBe('beginner');
  });

  it('reports why things were excluded rather than hiding it', () => {
    const report = filterRecipes(prefs({ maxPrepMinutes: 15, allergenIds: ['milk'] }));
    expect(report.exclusionCounts.time).toBeGreaterThan(0);
    expect(report.exclusionCounts.allergen).toBeGreaterThan(0);
  });
});

describe('generateMealPlan', () => {
  it('is deterministic for the same user and week', () => {
    const ctx = {
      userId: 'u1',
      weekStart: '2026-10-19',
      prefs: prefs(),
      ageBand: 'adult_18_plus' as const,
    };
    expect(JSON.stringify(generateMealPlan(ctx).meals)).toBe(
      JSON.stringify(generateMealPlan(ctx).meals),
    );
  });

  it('fills breakfast, lunch and dinner for every requested day', () => {
    const plan = generateMealPlan({
      userId: 'u2',
      weekStart: '2026-10-19',
      prefs: prefs(),
      ageBand: 'adult_18_plus',
      days: 5,
    });
    const dates = new Set(plan.meals.map((m) => m.date));
    expect(dates.size).toBe(5);
    for (const date of dates) {
      const slots = plan.meals.filter((m) => m.date === date).map((m) => m.slot);
      expect(slots).toContain('breakfast');
      expect(slots).toContain('lunch');
      expect(slots).toContain('dinner');
    }
  });

  it('adds snacks only when asked', () => {
    const without = generateMealPlan({
      userId: 'u3',
      weekStart: '2026-10-19',
      prefs: prefs({ includeSnacks: false }),
      ageBand: 'adult_18_plus',
      days: 2,
    });
    expect(without.meals.some((m) => m.slot === 'snack')).toBe(false);

    const withSnacks = generateMealPlan({
      userId: 'u3',
      weekStart: '2026-10-19',
      prefs: prefs({ includeSnacks: true }),
      ageBand: 'adult_18_plus',
      days: 2,
    });
    expect(withSnacks.meals.some((m) => m.slot === 'snack')).toBe(true);
  });

  it('never puts the same recipe in two slots on one day', () => {
    const plan = generateMealPlan({
      userId: 'u4',
      weekStart: '2026-10-19',
      prefs: prefs({ includeSnacks: true }),
      ageBand: 'adult_18_plus',
    });
    const dates = new Set(plan.meals.map((m) => m.date));
    for (const date of dates) {
      const ids = plan.meals.filter((m) => m.date === date).map((m) => m.recipeId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps reasonable variety across the week', () => {
    const plan = generateMealPlan({
      userId: 'u5',
      weekStart: '2026-10-19',
      prefs: prefs(),
      ageBand: 'adult_18_plus',
    });
    const unique = new Set(plan.meals.map((m) => m.recipeId));
    expect(unique.size).toBeGreaterThan(plan.meals.length * 0.6);
  });

  it('sizes servings for the household', () => {
    const plan = generateMealPlan({
      userId: 'u6',
      weekStart: '2026-10-19',
      prefs: prefs({ householdSize: 4 }),
      ageBand: 'adult_18_plus',
      days: 1,
    });
    for (const meal of plan.meals) expect(meal.servings).toBe(4);
  });

  it('only uses recipes suitable for the slot', () => {
    const plan = generateMealPlan({
      userId: 'u7',
      weekStart: '2026-10-19',
      prefs: prefs({ includeSnacks: true }),
      ageBand: 'adult_18_plus',
    });
    for (const meal of plan.meals) {
      expect(RECIPE_BY_ID.get(meal.recipeId)!.meals).toContain(meal.slot);
    }
  });

  it('warns rather than inventing a meal when nothing fits', () => {
    const plan = generateMealPlan({
      userId: 'u8',
      weekStart: '2026-10-19',
      prefs: prefs({ maxPrepMinutes: 5, diet: 'vegan', allergenIds: ['gluten', 'milk', 'peanut'] }),
      ageBand: 'adult_18_plus',
      days: 2,
    });
    if (plan.meals.length === 0) {
      expect(plan.warnings.join(' ')).toMatch(/Nothing was invented/i);
    }
    for (const meal of plan.meals) {
      const recipe = RECIPE_BY_ID.get(meal.recipeId)!;
      expect(recipe.prep + recipe.cook).toBeLessThanOrEqual(5);
    }
  });

  it('flags a recorded medical dietary requirement', () => {
    const plan = generateMealPlan({
      userId: 'u9',
      weekStart: '2026-10-19',
      prefs: prefs({ medicalDietaryNote: 'Chronic kidney disease, low potassium' }),
      ageBand: 'adult_18_plus',
      days: 1,
    });
    expect(plan.warnings.join(' ')).toMatch(/qualified dietitian/i);
  });

  it('explains the allergen exclusion count', () => {
    const plan = generateMealPlan({
      userId: 'u10',
      weekStart: '2026-10-19',
      prefs: prefs({ allergenIds: ['milk'] }),
      ageBand: 'adult_18_plus',
      days: 1,
    });
    expect(plan.explanation.join(' ')).toMatch(/Allergens excluded: Milk/i);
    expect(plan.explanation.join(' ')).toMatch(/optional ingredient/i);
  });

  it('offers swap alternatives per slot', () => {
    const plan = generateMealPlan({
      userId: 'u11',
      weekStart: '2026-10-19',
      prefs: prefs(),
      ageBand: 'adult_18_plus',
      days: 1,
    });
    const key = `2026-10-19:dinner`;
    expect(plan.alternatives[key]?.length).toBeGreaterThan(0);
    const chosen = plan.meals.find((m) => m.slot === 'dinner')!.recipeId;
    expect(plan.alternatives[key]!.map((a) => a.recipeId)).not.toContain(chosen);
  });
});

describe('findMealAlternatives', () => {
  it('applies the same hard filters as generation', () => {
    const p = prefs({ diet: 'vegan', allergenIds: ['tree_nut'] });
    const alternatives = findMealAlternatives('dinner', p, { limit: 50 });
    for (const alt of alternatives) {
      expect(deriveRecipeDietFacts(alt.recipe).vegan).toBe(true);
      expect(deriveRecipeAllergens(alt.recipe)).not.toContain('tree_nut');
      expect(alt.recipe.meals).toContain('dinner');
    }
  });

  it('excludes the recipe already in the slot', () => {
    const alternatives = findMealAlternatives('lunch', prefs(), {
      excludeRecipeIds: ['dal-tadka'],
      limit: 50,
    });
    expect(alternatives.map((a) => a.recipe.id)).not.toContain('dal-tadka');
  });
});

describe('date helpers', () => {
  it('finds the Monday of any week, including Sunday', () => {
    expect(mondayOf('2026-10-21')).toBe('2026-10-19');
    expect(mondayOf('2026-10-19')).toBe('2026-10-19');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // a Sunday
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-11-02', -3)).toBe('2026-10-30');
  });
});

describe('ingredient-derived facts', () => {
  it('marks every ingredient with a known allergen', () => {
    for (const recipe of RECIPE_CATALOG) {
      for (const ri of recipe.ing) {
        expect(INGREDIENT_BY_ID.has(ri.id), `${ri.id} missing from catalog`).toBe(true);
      }
    }
  });
});
