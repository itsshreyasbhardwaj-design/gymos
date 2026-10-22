/**
 * The critical safety tests.
 *
 * These correspond one-to-one with the non-negotiable safety requirements for GymOS.
 * Each is written to fail loudly if a future change weakens the guarantee.
 */
import { describe, it, expect } from 'vitest';
import { generatePlan } from '@/lib/engines/workout-generator';
import { adaptToEquipment, adaptMissedSession, adaptAfterDifficulty } from '@/lib/engines/realitysync';
import { findSubstitutes } from '@/lib/engines/substitution';
import { expandEquipment, checkEquipment } from '@/lib/engines/equipment';
import { applyFeedback, isAgeAppropriate } from '@/lib/engines/programming';
import {
  generateMealPlan,
  filterRecipes,
  findMealAlternatives,
  assertNoMinorRestriction,
  evaluateRecipe,
  type NutritionPreferences,
} from '@/lib/engines/nutrition';
import { buildGroceryList } from '@/lib/engines/grocery';
import { EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import { EXERCISE_BY_ID, EXERCISE_CATALOG } from '@/lib/content/exercises';
import { RECIPE_CATALOG, RECIPE_BY_ID, deriveRecipeAllergens } from '@/lib/content/recipes';
import { INGREDIENT_BY_ID, ALLERGEN_CATALOG } from '@/lib/content/nutrition-base';
import { detectIntent } from '@/lib/engines/fitbrain-intents';

const ALL_PRESETS = Object.keys(EQUIPMENT_PRESETS);

const basePrefs = (over: Partial<NutritionPreferences> = {}): NutritionPreferences => ({
  diet: 'no_preference',
  cuisines: [],
  allergenIds: [],
  dislikedIngredientIds: [],
  cookingSkill: 'confident',
  maxPrepMinutes: 90,
  householdSize: 1,
  includeSnacks: true,
  ...over,
});

/* ------------------------------------------------------------------ 1 and 2 */

describe('SAFETY 1 — no unavailable equipment is ever assigned', () => {
  it('holds for every preset, age band and experience level', () => {
    for (const presetKey of ALL_PRESETS) {
      const ids = EQUIPMENT_PRESETS[presetKey]!.ids;
      const available = expandEquipment(ids);
      for (const ageBand of ['under_13', 'teen_13_17', 'adult_18_plus'] as const) {
        for (const experience of ['new', 'some', 'regular', 'experienced'] as const) {
          const plan = generatePlan({
            profile: {
              userId: `safety-${presetKey}-${ageBand}-${experience}`,
              ageBand,
              experience,
              interests: ['general_fitness', 'cardiovascular', 'mobility_flexibility'],
              trainingDays: [1, 3, 5],
              sessionMinutes: 60,
              limitations: [],
            },
            availableEquipment: available,
            weekStart: '2026-10-19',
          });
          for (const day of plan.days) {
            for (const item of day.exercises) {
              const seed = EXERCISE_BY_ID.get(item.exerciseId);
              expect(seed, `${item.exerciseId} must exist`).toBeDefined();
              expect(
                checkEquipment(seed!, available).ok,
                `${item.exerciseId} assigned without equipment (${presetKey})`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('SAFETY 2 — every required equipment group is checked, not just one', () => {
  it('blocks a multi-group exercise when any single group is missing', () => {
    const bench = EXERCISE_BY_ID.get('barbell-bench-press')!;
    expect(bench.equip.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < bench.equip.length; i += 1) {
      // Own everything EXCEPT group i.
      const owned = bench.equip.filter((_, idx) => idx !== i).flat();
      const set = expandEquipment(owned);
      expect(checkEquipment(bench, set).ok, `missing group ${i} should block`).toBe(false);
    }
    expect(checkEquipment(bench, expandEquipment(bench.equip.flat())).ok).toBe(true);
  });

  it('never lets a multi-group exercise into a plan with a partial set', () => {
    const plan = generatePlan({
      profile: {
        userId: 'partial',
        ageBand: 'adult_18_plus',
        experience: 'experienced',
        interests: ['strength_skills'],
        trainingDays: [1, 3, 5],
        sessionMinutes: 90,
        limitations: [],
      },
      availableEquipment: expandEquipment(['barbell', 'weight_plates']),
      weekStart: '2026-10-19',
    });
    const ids = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain('barbell-bench-press');
    expect(ids).not.toContain('barbell-back-squat');
    expect(ids).not.toContain('skull-crusher');
  });
});

/* ----------------------------------------------------------------------- 3 */

describe('SAFETY 3 — a declared limitation removes the movement from every path', () => {
  it('excludes it from generation', () => {
    const plan = generatePlan({
      profile: {
        userId: 'lim',
        ageBand: 'adult_18_plus',
        experience: 'experienced',
        interests: ['general_fitness', 'recreational_sports'],
        trainingDays: [1, 2, 3, 4, 5],
        sessionMinutes: 60,
        limitations: ['knee', 'shoulder', 'lower_back'],
      },
      availableEquipment: expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids),
      weekStart: '2026-10-19',
    });
    const ids = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    const patterns = plan.days.flatMap((d) => d.exercises.map((e) => e.slotPattern));
    for (const banned of [
      'conventional-deadlift',
      'barbell-row',
      'squat-jump',
      'sissy-squat-assisted',
      'dip-chest',
    ]) {
      expect(ids, `${banned} must not be prescribed`).not.toContain(banned);
    }
    expect(patterns).not.toContain('vertical_push');
    expect(patterns).not.toContain('plyometric');
  });

  it('excludes it from substitution suggestions', () => {
    const original = EXERCISE_BY_ID.get('dumbbell-shoulder-press')!;
    const result = findSubstitutes(original, {
      availableEquipment: expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids),
      ageBand: 'adult_18_plus',
      level: 'experienced',
      excludedPatterns: new Set(['vertical_push']),
      excludedExerciseIds: new Set(['arnold-press']),
    });
    for (const option of result.options) {
      expect(option.exercise.pattern).not.toBe('vertical_push');
      expect(option.exercise.id).not.toBe('arnold-press');
    }
  });

  it('excludes it from equipment-change adaptation', () => {
    const planned = generatePlan({
      profile: {
        userId: 'lim2',
        ageBand: 'adult_18_plus',
        experience: 'regular',
        interests: ['general_fitness'],
        trainingDays: [1],
        sessionMinutes: 60,
        limitations: [],
      },
      availableEquipment: expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids),
      weekStart: '2026-10-19',
    }).days.find((d) => !d.isRest)!.exercises;

    const proposal = adaptToEquipment(
      planned,
      { ageBand: 'adult_18_plus', experience: 'regular', limitations: ['avoid_jumping', 'knee'] },
      expandEquipment(EQUIPMENT_PRESETS.minimal_home!.ids),
    );
    for (const item of proposal.exercises) {
      const seed = EXERCISE_BY_ID.get(item.exerciseId)!;
      expect(seed.pattern).not.toBe('plyometric');
    }
  });
});

/* ----------------------------------------------------------------------- 4 */

describe('SAFETY 4 — GymOS never invents an equipment-free replacement', () => {
  it('leaves the slot out and says so', () => {
    const plan = generatePlan({
      profile: {
        userId: 'gap',
        ageBand: 'adult_18_plus',
        experience: 'new',
        interests: ['general_fitness'],
        trainingDays: [1, 3, 5],
        sessionMinutes: 45,
        limitations: [],
      },
      availableEquipment: expandEquipment([]),
      weekStart: '2026-10-19',
    });
    const gaps = plan.days.flatMap((d) => d.gaps);
    expect(gaps.length).toBeGreaterThan(0);
    const assignedPatterns = new Set(plan.days.flatMap((d) => d.exercises.map((e) => e.slotPattern)));
    for (const gap of gaps) expect(assignedPatterns.has(gap.pattern)).toBe(false);
    expect(plan.warnings.join(' ')).toMatch(/does not train the same thing/i);
  });

  it('refuses to substitute a machine pull with a stretch or a cardio session', () => {
    const original = EXERCISE_BY_ID.get('lat-pulldown-ex')!;
    const result = findSubstitutes(original, {
      availableEquipment: expandEquipment([]),
      ageBand: 'adult_18_plus',
      level: 'new',
    });
    expect(result.options).toEqual([]);
    expect(result.noMatchReason).toMatch(/no equipment-free movement/i);
  });

  it('blocks rather than swaps when adapting to an impossible location', () => {
    const planned = [
      {
        exerciseId: 'leg-press',
        name: 'Leg press',
        slotPattern: 'squat' as const,
        role: 'primary' as const,
        sets: 3,
        repsLow: 8,
        repsHigh: 12,
        restSeconds: 120,
        intensityNote: '',
        rationale: '',
        estimatedSeconds: 600,
      },
    ];
    const proposal = adaptToEquipment(
      planned,
      { ageBand: 'adult_18_plus', experience: 'regular', limitations: ['avoid_floor'] },
      expandEquipment([]),
      {},
    );
    // Either a genuine same-pattern bodyweight squat, or nothing. Never a fake equivalent.
    for (const item of proposal.exercises) {
      const seed = EXERCISE_BY_ID.get(item.exerciseId)!;
      expect(seed.pattern).toBe('squat');
      expect(seed.cat).not.toBe('mobility');
    }
  });
});

/* ----------------------------------------------------------------------- 5 */

describe('SAFETY 5 — a missed session never triggers extra training', () => {
  it('moves or drops, and never adds volume elsewhere', () => {
    const missed = { id: 'm', scheduledDate: '2026-10-19', label: 'Monday', status: 'scheduled' };
    for (const flexibility of ['rigid', 'some', 'flexible'] as const) {
      const proposal = adaptMissedSession(missed, [missed], {
        availableDates: ['2026-10-19', '2026-10-20', '2026-10-21'],
        today: '2026-10-19',
        flexibility,
      });
      expect(proposal.moves.length).toBe(1);
      // Nothing is ever added, only moved or dropped.
      expect(proposal.changes.every((c) => ['reschedule', 'remove'].includes(c.kind))).toBe(true);
      // The proposal touches exactly the missed session and no other.
      expect(proposal.moves.every((m) => m.sessionId === missed.id)).toBe(true);
      // It states the guarantee explicitly rather than quietly adding volume.
      expect(proposal.explanation.join(' ')).toMatch(
        /no session is made longer or harder to "make up"/i,
      );
    }
  });

  it('does not escalate the next session after a gap', () => {
    const previous = { sets: 3, repsLow: 8, repsHigh: 12, restSeconds: 90, intensityNote: '' };
    const result = applyFeedback({ previous, ageBand: 'adult_18_plus' });
    expect(result.changed).toBe(false);
  });
});

/* ----------------------------------------------------------------------- 6 */

describe('SAFETY 6 — declared allergens are excluded everywhere, including swaps', () => {
  it('excludes every recipe containing the allergen, including as an optional ingredient', () => {
    for (const allergen of ALLERGEN_CATALOG) {
      const prefs = basePrefs({ allergenIds: [allergen.id] });
      const report = filterRecipes(prefs);
      for (const evaluation of report.eligible) {
        expect(
          deriveRecipeAllergens(evaluation.recipe),
          `${evaluation.recipe.id} slipped past the ${allergen.id} filter`,
        ).not.toContain(allergen.id);
      }
    }
  });

  it('excludes the allergen from a generated week of meals', () => {
    const prefs = basePrefs({ allergenIds: ['peanut', 'milk', 'gluten'] });
    const plan = generateMealPlan({
      userId: 'allergy-user',
      weekStart: '2026-10-19',
      prefs,
      ageBand: 'adult_18_plus',
    });
    expect(plan.meals.length).toBeGreaterThan(0);
    for (const meal of plan.meals) {
      const allergens = deriveRecipeAllergens(RECIPE_BY_ID.get(meal.recipeId)!);
      for (const banned of prefs.allergenIds) expect(allergens).not.toContain(banned);
    }
  });

  it('excludes the allergen from every SWAP option too', () => {
    const prefs = basePrefs({ allergenIds: ['tree_nut', 'shellfish', 'sesame'] });
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
      const alternatives = findMealAlternatives(slot, prefs, { limit: 50 });
      for (const alt of alternatives) {
        const allergens = deriveRecipeAllergens(alt.recipe);
        for (const banned of prefs.allergenIds) expect(allergens).not.toContain(banned);
      }
    }
  });

  it('keeps the allergen out of the grocery list built from a filtered plan', () => {
    const prefs = basePrefs({ allergenIds: ['peanut'] });
    const plan = generateMealPlan({
      userId: 'allergy-grocery',
      weekStart: '2026-10-19',
      prefs,
      ageBand: 'adult_18_plus',
    });
    const result = buildGroceryList(
      plan.meals.map((m) => ({
        recipeId: m.recipeId,
        servings: m.servings,
        omitIngredientIds: m.omitIngredientIds,
      })),
      { includeOptional: true },
    );
    for (const line of result.lines) {
      const ing = INGREDIENT_BY_ID.get(line.ingredientId);
      expect(ing?.allergens ?? []).not.toContain('peanut');
    }
  });

  it('never silently substitutes an allergenic ingredient', () => {
    // A recipe excluded for an allergen is excluded outright, with the reason stated.
    const prefs = basePrefs({ allergenIds: ['milk'] });
    const dairyRecipe = RECIPE_CATALOG.find((r) => deriveRecipeAllergens(r).includes('milk'))!;
    const evaluation = evaluateRecipe(dairyRecipe, prefs);
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.exclusions.some((e) => e.kind === 'allergen')).toBe(true);
    expect(evaluation.omitIngredientIds).not.toContain('milk');
  });
});

/* ----------------------------------------------------------------------- 7 */

describe('SAFETY 7 — under-18 accounts get no restrictive diet and no appearance scoring', () => {
  it('refuses restriction-style settings at the write path', () => {
    for (const ageBand of ['under_13', 'teen_13_17'] as const) {
      expect(() => assertNoMinorRestriction(ageBand, { calorieTarget: 1800 })).toThrow();
      expect(() => assertNoMinorRestriction(ageBand, { calorieCeiling: 1500 })).toThrow();
      expect(() => assertNoMinorRestriction(ageBand, { weightGoalKg: 60 })).toThrow();
      expect(() => assertNoMinorRestriction(ageBand, { deficit: 500 })).toThrow();
      expect(() => assertNoMinorRestriction(ageBand, { bodyFatTarget: 15 })).toThrow();
    }
    expect(() => assertNoMinorRestriction('adult_18_plus', { calorieTarget: 1800 })).not.toThrow();
  });

  it('produces a plan with no calorie or weight language for minors', () => {
    for (const ageBand of ['under_13', 'teen_13_17'] as const) {
      const plan = generateMealPlan({
        userId: `minor-${ageBand}`,
        weekStart: '2026-10-19',
        prefs: basePrefs(),
        ageBand,
      });
      /*
       * Check the PRESCRIPTION itself. The explanation deliberately contains the words
       * "no calorie targets", so scanning the whole object would match its own negation.
       */
      const prescription = JSON.stringify(plan.meals).toLowerCase();
      expect(prescription).not.toMatch(/calorie|kcal|macro|deficit|weight|slim|lean down/);
      for (const meal of plan.meals) {
        expect(Object.keys(meal)).not.toContain('calorieTarget');
        expect(meal.servings).toBeGreaterThan(0);
      }
      // And the explanation must state the guarantee explicitly.
      expect(plan.explanation.join(' ')).toMatch(
        /no restriction, no calorie limits and no weight targets/i,
      );
      expect(plan.explanation.join(' ')).toMatch(/no calorie targets and no portion weighing/i);
    }
  });

  it('never scores appearance anywhere in the product surface', () => {
    const adult = generateMealPlan({
      userId: 'adult',
      weekStart: '2026-10-19',
      prefs: basePrefs(),
      ageBand: 'adult_18_plus',
    });
    const text = JSON.stringify(adult).toLowerCase();
    expect(text).not.toMatch(/body fat|physique|attractive|how you look|beach body/);
  });

  it('keeps the exercise catalog free of appearance-based framing', () => {
    const text = JSON.stringify(EXERCISE_CATALOG).toLowerCase();
    expect(text).not.toMatch(/toned|tone up|beach body|shredded|bikini|six.?pack abs/);
  });
});

/* ----------------------------------------------------------------------- 8 */

describe('SAFETY 8 — medical and injury input never produces treatment advice', () => {
  it('routes injury and medical questions to a safety redirect', () => {
    const queries = [
      'my knee hurts, what should I do',
      'I think I tore something',
      'can you diagnose my shoulder pain',
      'what medicine should I take for sore muscles',
      'I feel dizzy during workouts',
      'I am pregnant, is this safe',
      'how do I treat my back injury',
    ];
    for (const q of queries) {
      expect(detectIntent(q).id, `"${q}" must be redirected`).toBe('safety_redirect');
    }
  });

  it('routes appearance and crash-diet questions to a safety redirect', () => {
    for (const q of ['how do I lose weight fast', 'rate my body', 'am i fat', 'how many calories should i eat']) {
      expect(detectIntent(q).id, `"${q}" must be redirected`).toBe('safety_redirect');
    }
  });

  it('reduces volume without diagnosing when discomfort is reported', () => {
    const planned = [
      {
        exerciseId: 'goblet-squat',
        name: 'Goblet squat',
        slotPattern: 'squat' as const,
        role: 'primary' as const,
        sets: 4,
        repsLow: 8,
        repsHigh: 12,
        restSeconds: 120,
        intensityNote: '',
        rationale: '',
        estimatedSeconds: 800,
      },
    ];
    const proposal = adaptAfterDifficulty(
      planned,
      { ageBand: 'adult_18_plus', experience: 'regular', limitations: [] },
      { discomfortReported: true },
    );
    expect(proposal.exercises[0]!.sets).toBeLessThan(4);
    const text = JSON.stringify(proposal).toLowerCase();
    expect(text).toMatch(/qualified professional/);
    expect(text).not.toMatch(/diagnos|you have a|it is probably|treatment/);
  });
});

/* ----------------------------------------------------------------- 9 and 10 */

describe('SAFETY 9 and 10 — see the integration suite', () => {
  it('documents where cross-user isolation and consent gating are verified', () => {
    // Cross-user data isolation (9) and consent-gated biometrics (10) require the
    // database, so they are covered in tests/integration/authorization.test.ts and
    // tests/integration/privacy.test.ts. This placeholder keeps the numbering honest.
    expect(true).toBe(true);
  });
});
