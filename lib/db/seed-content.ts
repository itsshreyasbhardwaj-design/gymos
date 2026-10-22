/**
 * Loads the shared content library (equipment, exercises, ingredients, recipes and the
 * entitlement matrix) into a database. Idempotent, and used by both `npm run db:seed`
 * and the integration tests so they exercise exactly the same content.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { EQUIPMENT_CATALOG } from '@/lib/content/equipment';
import { EXERCISE_CATALOG, EXERCISE_SOURCES } from '@/lib/content/exercises';
import { ALLERGEN_CATALOG, INGREDIENT_CATALOG } from '@/lib/content/nutrition-base';
import { RECIPE_CATALOG, RECIPE_SOURCES, deriveRecipeAllergens } from '@/lib/content/recipes';
import { ENTITLEMENT_MATRIX } from '@/lib/engines/entitlements';

type Db = BetterSQLite3Database<typeof schema>;

const id = () => randomUUID();

export function seedContent(db: Db): void {
  db.transaction((tx) => {
    for (const [index, eq] of EQUIPMENT_CATALOG.entries()) {
      tx.insert(schema.equipmentTypes)
        .values({
          id: eq.id,
          name: eq.name,
          category: eq.category,
          aliases: eq.aliases ?? [],
          description: eq.description ?? '',
          impliesIds: eq.implies ?? [],
          isCustom: false,
          sortOrder: index,
        })
        .onConflictDoUpdate({
          target: schema.equipmentTypes.id,
          set: {
            name: eq.name,
            category: eq.category,
            aliases: eq.aliases ?? [],
            description: eq.description ?? '',
            impliesIds: eq.implies ?? [],
            sortOrder: index,
          },
        })
        .run();
    }

    for (const src of EXERCISE_SOURCES) {
      tx.insert(schema.exerciseSources)
        .values({ id: src.id, label: src.label, citation: src.citation, url: src.url, kind: src.kind })
        .onConflictDoUpdate({
          target: schema.exerciseSources.id,
          set: { label: src.label, citation: src.citation, url: src.url, kind: src.kind },
        })
        .run();
    }

    for (const ex of EXERCISE_CATALOG) {
      const values = {
        name: ex.name,
        aliases: ex.alias ?? [],
        movementPattern: ex.pattern,
        category: ex.cat,
        primaryMuscles: ex.primary,
        secondaryMuscles: ex.secondary ?? [],
        experienceLevel: ex.level,
        setup: ex.setup,
        steps: ex.steps,
        cues: ex.cues ?? [],
        safety: ex.safety ?? [],
        unilateral: ex.unilateral ?? false,
        isTimed: ex.timed ?? false,
        loadable: ex.loadable ?? true,
        tempoFactor: ex.tempo ?? 1,
        teenOk: ex.teenOk !== false,
        childOk: ex.childOk === true,
      };
      tx.insert(schema.exercises)
        .values({
          id: ex.id,
          ...values,
          // Instructions are in-house drafts until a qualified professional reviews them.
          reviewStatus: 'draft',
          sourceId: 'internal-draft-2026',
          mediaStatus: 'placeholder',
        })
        .onConflictDoUpdate({
          target: schema.exercises.id,
          set: { ...values, updatedAt: new Date().toISOString() },
        })
        .run();

      tx.delete(schema.exerciseEquipment)
        .where(sql`exercise_id = ${ex.id}`)
        .run();
      for (const [gi, group] of ex.equip.entries()) {
        for (const equipmentTypeId of group) {
          tx.insert(schema.exerciseEquipment)
            .values({
              id: id(),
              exerciseId: ex.id,
              equipmentTypeId,
              requirement: 'required',
              groupKey: `g${gi + 1}`,
            })
            .onConflictDoNothing()
            .run();
        }
      }
      for (const equipmentTypeId of ex.optional ?? []) {
        tx.insert(schema.exerciseEquipment)
          .values({
            id: id(),
            exerciseId: ex.id,
            equipmentTypeId,
            requirement: 'optional',
            groupKey: 'opt',
          })
          .onConflictDoNothing()
          .run();
      }

      tx.insert(schema.exerciseMedia)
        .values({
          id: `${ex.id}-placeholder`,
          exerciseId: ex.id,
          kind: 'illustration_placeholder',
          url: null,
          attribution: null,
          license: null,
          status: 'placeholder',
        })
        .onConflictDoNothing()
        .run();
    }

    // Relationships are inserted only once every exercise row exists.
    for (const ex of EXERCISE_CATALOG) {
      const rels: [string[], 'substitute' | 'progression' | 'regression'][] = [
        [ex.subs ?? [], 'substitute'],
        [ex.prog ?? [], 'progression'],
        [ex.regr ?? [], 'regression'],
      ];
      for (const [list, relation] of rels) {
        for (const relatedExerciseId of list) {
          tx.insert(schema.exerciseVariations)
            .values({ id: id(), exerciseId: ex.id, relatedExerciseId, relation })
            .onConflictDoNothing()
            .run();
        }
      }
    }

    for (const a of ALLERGEN_CATALOG) {
      tx.insert(schema.allergens)
        .values({ id: a.id, name: a.name, aliases: a.aliases })
        .onConflictDoUpdate({ target: schema.allergens.id, set: { name: a.name, aliases: a.aliases } })
        .run();
    }

    for (const ing of INGREDIENT_CATALOG) {
      const values = {
        name: ing.name,
        category: ing.category,
        defaultUnit: ing.unit,
        allergenIds: ing.allergens ?? [],
        isVegetarian: ing.veg !== false,
        isVegan: ing.vegan !== false,
        containsEgg: ing.egg === true,
        aliases: ing.aliases ?? [],
      };
      tx.insert(schema.ingredients)
        .values({
          id: ing.id,
          ...values,
          // No grounded retail price data ships with GymOS.
          approxPricePaisePerUnit: null,
          priceUnit: null,
          priceSource: null,
        })
        .onConflictDoUpdate({ target: schema.ingredients.id, set: values })
        .run();
    }

    for (const src of RECIPE_SOURCES) {
      tx.insert(schema.recipeSources)
        .values({ id: src.id, label: src.label, citation: src.citation, url: src.url })
        .onConflictDoUpdate({
          target: schema.recipeSources.id,
          set: { label: src.label, citation: src.citation, url: src.url },
        })
        .run();
    }

    for (const r of RECIPE_CATALOG) {
      const values = {
        name: r.name,
        cuisine: r.cuisine,
        mealTypes: r.meals,
        dietTags: r.diet,
        allergenIds: deriveRecipeAllergens(r),
        prepMinutes: r.prep,
        cookMinutes: r.cook,
        servings: r.servings,
        steps: r.steps,
        notes: r.notes ?? '',
        skillLevel: r.skill ?? 'beginner',
      };
      tx.insert(schema.recipes)
        .values({
          id: r.id,
          ...values,
          // No sourced nutritional analysis exists, so it stays null rather than invented.
          nutrition: null,
          nutritionSourceId: null,
          reviewStatus: 'draft',
          sourceId: 'internal-draft-recipes-2026',
        })
        .onConflictDoUpdate({ target: schema.recipes.id, set: values })
        .run();

      tx.delete(schema.recipeIngredients)
        .where(sql`recipe_id = ${r.id}`)
        .run();
      for (const ri of r.ing) {
        tx.insert(schema.recipeIngredients)
          .values({
            id: id(),
            recipeId: r.id,
            ingredientId: ri.id,
            quantity: ri.qty,
            unit: ri.unit,
            optional: ri.optional ?? false,
            note: ri.note ?? '',
          })
          .onConflictDoNothing()
          .run();
      }
    }

    for (const e of ENTITLEMENT_MATRIX) {
      tx.insert(schema.entitlements)
        .values({
          id: `${e.plan}:${e.feature}`,
          plan: e.plan,
          feature: e.feature,
          enabled: e.enabled,
          limitValue: e.limitValue,
          note: e.note,
        })
        .onConflictDoUpdate({
          target: schema.entitlements.id,
          set: { enabled: e.enabled, limitValue: e.limitValue, note: e.note },
        })
        .run();
    }
  });
}
