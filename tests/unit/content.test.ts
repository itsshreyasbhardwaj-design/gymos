import { describe, it, expect } from 'vitest';
import {
  EXERCISE_CATALOG,
  EXERCISE_BY_ID,
  validateExerciseCatalog,
} from '@/lib/content/exercises';
import {
  RECIPE_CATALOG,
  validateRecipeCatalog,
  deriveRecipeAllergens,
  deriveRecipeDietFacts,
} from '@/lib/content/recipes';
import { EQUIPMENT_CATALOG, EQUIPMENT_PRESETS, EQUIPMENT_BY_ID } from '@/lib/content/equipment';
import { INGREDIENT_BY_ID, ALLERGEN_BY_ID } from '@/lib/content/nutrition-base';
import { MOVEMENT_PATTERN_LABELS } from '@/lib/content/exercise-types';

describe('content catalogs', () => {
  it('has a substantial exercise library', () => {
    expect(EXERCISE_CATALOG.length).toBeGreaterThanOrEqual(150);
  });

  it('passes structural validation with no issues', () => {
    expect(validateExerciseCatalog()).toEqual([]);
    expect(validateRecipeCatalog()).toEqual([]);
  });

  it('references only equipment that exists', () => {
    for (const ex of EXERCISE_CATALOG) {
      for (const group of ex.equip) {
        for (const eq of group) expect(EQUIPMENT_BY_ID.has(eq)).toBe(true);
      }
      for (const eq of ex.optional ?? []) expect(EQUIPMENT_BY_ID.has(eq)).toBe(true);
    }
  });

  it('covers every movement pattern used by the templates', () => {
    const covered = new Set(EXERCISE_CATALOG.map((e) => e.pattern));
    for (const pattern of Object.keys(MOVEMENT_PATTERN_LABELS)) {
      expect(covered.has(pattern as never)).toBe(true);
    }
  });

  it('only points substitutes at exercises that exist', () => {
    for (const ex of EXERCISE_CATALOG) {
      for (const sub of ex.subs ?? []) expect(EXERCISE_BY_ID.has(sub)).toBe(true);
    }
  });

  it('keeps every equipment preset pointed at real equipment', () => {
    for (const preset of Object.values(EQUIPMENT_PRESETS)) {
      for (const id of preset.ids) expect(EQUIPMENT_BY_ID.has(id)).toBe(true);
    }
  });

  it('has equipment in every declared category', () => {
    const categories = new Set(EQUIPMENT_CATALOG.map((e) => e.category));
    expect(categories.size).toBeGreaterThanOrEqual(8);
  });
});

describe('recipe content', () => {
  it('has a usable catalog', () => {
    expect(RECIPE_CATALOG.length).toBeGreaterThanOrEqual(60);
  });

  it('derives allergens from ingredients, including optional ones', () => {
    for (const recipe of RECIPE_CATALOG) {
      const derived = new Set(deriveRecipeAllergens(recipe));
      for (const ri of recipe.ing) {
        const ing = INGREDIENT_BY_ID.get(ri.id);
        for (const a of ing?.allergens ?? []) {
          expect(derived.has(a)).toBe(true);
          expect(ALLERGEN_BY_ID.has(a)).toBe(true);
        }
      }
    }
  });

  it('never tags a recipe vegan when a required ingredient is not', () => {
    for (const recipe of RECIPE_CATALOG) {
      if (!recipe.diet.includes('vegan')) continue;
      expect(deriveRecipeDietFacts(recipe).vegan).toBe(true);
    }
  });

  it('ships no invented nutritional analysis', () => {
    for (const recipe of RECIPE_CATALOG) {
      expect(Object.prototype.hasOwnProperty.call(recipe, 'nutrition')).toBe(false);
    }
  });

  it('has Indian cuisines well represented', () => {
    const indian = RECIPE_CATALOG.filter((r) =>
      ['bengali', 'north_indian', 'south_indian', 'home_style'].includes(r.cuisine),
    );
    expect(indian.length / RECIPE_CATALOG.length).toBeGreaterThan(0.6);
  });
});
