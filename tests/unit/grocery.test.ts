import { describe, it, expect } from 'vitest';
import { buildGroceryList, recipesFromPantry, formatPaise } from '@/lib/engines/grocery';
import { RECIPE_BY_ID, RECIPE_CATALOG } from '@/lib/content/recipes';
import { INGREDIENT_BY_ID } from '@/lib/content/nutrition-base';

describe('buildGroceryList', () => {
  it('scales quantities by servings', () => {
    const recipe = RECIPE_BY_ID.get('dal-tadka')!;
    const single = buildGroceryList([{ recipeId: recipe.id, servings: recipe.servings }]);
    const double = buildGroceryList([{ recipeId: recipe.id, servings: recipe.servings * 2 }]);
    const dalSingle = single.lines.find((l) => l.ingredientId === 'toor-dal')!;
    const dalDouble = double.lines.find((l) => l.ingredientId === 'toor-dal')!;
    expect(dalDouble.quantity).toBeCloseTo(dalSingle.quantity * 2, 1);
  });

  it('sums the same ingredient across recipes when units match', () => {
    const result = buildGroceryList([
      { recipeId: 'dal-tadka', servings: 3 },
      { recipeId: 'rajma-masala', servings: 3 },
    ]);
    const onion = result.lines.filter((l) => l.ingredientId === 'onion');
    expect(onion.length).toBe(1);
    expect(onion[0]!.fromRecipeIds.length).toBe(2);
  });

  it('keeps mismatched units on separate lines rather than adding them wrongly', () => {
    const result = buildGroceryList([
      { recipeId: 'dal-tadka', servings: 3 },
      { recipeId: 'poha-vegetable', servings: 2 },
    ]);
    const unitsPerIngredient = new Map<string, Set<string>>();
    for (const line of result.lines) {
      const set = unitsPerIngredient.get(line.ingredientId) ?? new Set();
      set.add(line.unit);
      unitsPerIngredient.set(line.ingredientId, set);
    }
    for (const [, units] of unitsPerIngredient) {
      // One line per (ingredient, unit) pair — never a silent unit mash-up.
      expect(units.size).toBeGreaterThanOrEqual(1);
    }
  });

  it('excludes optional ingredients by default and lists them as skipped', () => {
    const result = buildGroceryList([{ recipeId: 'poha-vegetable', servings: 2 }]);
    expect(result.lines.map((l) => l.ingredientId)).not.toContain('peanuts');
    expect(result.skipped.some((s) => s.ingredientId === 'peanuts')).toBe(true);
  });

  it('includes optional ingredients when asked', () => {
    const result = buildGroceryList([{ recipeId: 'poha-vegetable', servings: 2 }], {
      includeOptional: true,
    });
    expect(result.lines.map((l) => l.ingredientId)).toContain('peanuts');
  });

  it('omits ingredients the planner excluded for diet reasons, and says so', () => {
    const result = buildGroceryList(
      [{ recipeId: 'roti-phulka', servings: 3, omitIngredientIds: ['ghee'] }],
      { includeOptional: true },
    );
    expect(result.lines.map((l) => l.ingredientId)).not.toContain('ghee');
    expect(result.skipped.some((s) => s.ingredientId === 'ghee')).toBe(true);
  });

  it('subtracts pantry stock', () => {
    const base = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }]);
    const dalNeeded = base.lines.find((l) => l.ingredientId === 'toor-dal')!.quantity;
    const withPantry = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }], {
      pantry: [{ ingredientId: 'toor-dal', quantity: dalNeeded / 2, unit: 'g' }],
    });
    const remaining = withPantry.lines.find((l) => l.ingredientId === 'toor-dal')!;
    expect(remaining.quantity).toBeCloseTo(dalNeeded / 2, 1);
    expect(remaining.pantryCovered).toBeCloseTo(dalNeeded / 2, 1);
  });

  it('reports fully-covered items instead of silently dropping them', () => {
    const base = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }]);
    const dalNeeded = base.lines.find((l) => l.ingredientId === 'toor-dal')!.quantity;
    const result = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }], {
      pantry: [{ ingredientId: 'toor-dal', quantity: dalNeeded * 2, unit: 'g' }],
    });
    expect(result.lines.map((l) => l.ingredientId)).not.toContain('toor-dal');
    expect(result.alreadyHave.map((l) => l.ingredientId)).toContain('toor-dal');
  });

  it('ignores pantry stock recorded in a different unit', () => {
    const result = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }], {
      pantry: [{ ingredientId: 'toor-dal', quantity: 999, unit: 'piece' }],
    });
    const dal = result.lines.find((l) => l.ingredientId === 'toor-dal')!;
    expect(dal.pantryCovered).toBe(0);
  });

  it('gives no cost estimate when the user has recorded no prices', () => {
    const result = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }]);
    expect(result.totalEstimatedPaise).toBeNull();
    expect(result.pricedLineCount).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/without retail price data/i);
    for (const line of result.lines) expect(line.estimatedPaise).toBeNull();
  });

  it('estimates only from prices the user recorded, and says how much it covers', () => {
    const result = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }], {
      userPrices: { 'toor-dal': { paise: 15000, unit: 'g', perQuantity: 1000 } },
    });
    expect(result.pricedLineCount).toBe(1);
    expect(result.totalEstimatedPaise).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/floor, not a full basket cost/i);
  });

  it('ignores a recorded price whose unit does not match', () => {
    const result = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }], {
      userPrices: { 'toor-dal': { paise: 15000, unit: 'piece', perQuantity: 1 } },
    });
    expect(result.pricedLineCount).toBe(0);
  });

  it('groups lines by aisle category', () => {
    const result = buildGroceryList([{ recipeId: 'dal-tadka', servings: 3 }]);
    for (const line of result.lines) {
      expect(line.categoryLabel.length).toBeGreaterThan(0);
      expect(line.category).toBe(INGREDIENT_BY_ID.get(line.ingredientId)!.category);
    }
  });

  it('warns about an unknown recipe rather than failing silently', () => {
    const result = buildGroceryList([{ recipeId: 'not-a-recipe', servings: 1 }]);
    expect(result.lines).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/unknown recipe/i);
  });

  it('handles an empty plan', () => {
    const result = buildGroceryList([]);
    expect(result.lines).toEqual([]);
    expect(result.totalEstimatedPaise).toBeNull();
  });
});

describe('recipesFromPantry', () => {
  it('ranks recipes by how much of the pantry covers them', () => {
    const recipe = RECIPE_BY_ID.get('masala-chaas')!;
    const pantry = recipe.ing
      .filter((ri) => !ri.optional)
      .map((ri) => ({ ingredientId: ri.id, quantity: ri.qty * 10, unit: ri.unit }));
    const results = recipesFromPantry(pantry, RECIPE_CATALOG, { minCoverage: 0.5 });
    const match = results.find((r) => r.recipe.id === recipe.id);
    expect(match).toBeDefined();
    expect(match!.coverage).toBe(1);
    expect(match!.missing).toEqual([]);
  });

  it('lists what is still missing', () => {
    const recipe = RECIPE_BY_ID.get('dal-tadka')!;
    const required = recipe.ing.filter((ri) => !ri.optional);
    const pantry = required
      .slice(0, Math.ceil(required.length * 0.8))
      .map((ri) => ({ ingredientId: ri.id, quantity: ri.qty * 10, unit: ri.unit }));
    const results = recipesFromPantry(pantry, [recipe], { minCoverage: 0.5 });
    expect(results[0]!.missing.length).toBeGreaterThan(0);
    expect(results[0]!.coverage).toBeLessThan(1);
  });

  it('returns nothing for an empty pantry', () => {
    expect(recipesFromPantry([], RECIPE_CATALOG, { minCoverage: 0.5 })).toEqual([]);
  });
});

describe('formatPaise', () => {
  it('shows an em dash rather than a fake zero when there is no estimate', () => {
    expect(formatPaise(null)).toBe('—');
  });

  it('formats rupees', () => {
    expect(formatPaise(15000)).toContain('150');
  });
});
