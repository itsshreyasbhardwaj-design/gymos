import { describe, it, expect } from 'vitest';
import {
  generatePlan,
  chooseSplit,
  eligibleExercises,
  isEligible,
  estimateExerciseSeconds,
  estimateSessionMinutes,
  type GeneratorContext,
  type GeneratorProfile,
} from '@/lib/engines/workout-generator';
import { expandEquipment, checkEquipment } from '@/lib/engines/equipment';
import { EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import { EXERCISE_BY_ID, EXERCISE_CATALOG } from '@/lib/content/exercises';
import { isAgeAppropriate, isLevelAppropriate } from '@/lib/engines/programming';

const WEEK = '2026-10-19';

function ctx(
  overrides: Partial<GeneratorProfile> = {},
  equipment = EQUIPMENT_PRESETS.commercial_gym!.ids,
  extra: Partial<GeneratorContext> = {},
): GeneratorContext {
  return {
    profile: {
      userId: 'test-user',
      ageBand: 'adult_18_plus',
      experience: 'regular',
      interests: ['general_fitness'],
      trainingDays: [1, 3, 5],
      sessionMinutes: 45,
      limitations: [],
      ...overrides,
    },
    availableEquipment: expandEquipment(equipment),
    weekStart: WEEK,
    ...extra,
  };
}

describe('chooseSplit', () => {
  it('matches the number of days the user actually picked', () => {
    for (const days of [1, 2, 3, 4, 5, 6]) {
      const profile = ctx({ trainingDays: Array.from({ length: days }, (_, i) => i) }).profile;
      expect(chooseSplit(profile).focuses.length).toBe(days);
    }
  });

  it('keeps beginners on full-body rather than a body-part split', () => {
    const { focuses } = chooseSplit(ctx({ experience: 'new', trainingDays: [1, 3, 5] }).profile);
    expect(focuses.every((f) => f === 'full_body')).toBe(true);
  });

  it('gives experienced users a differentiated split', () => {
    const { focuses } = chooseSplit(
      ctx({ experience: 'experienced', trainingDays: [1, 2, 3, 4, 5] }).profile,
    );
    expect(new Set(focuses).size).toBeGreaterThan(1);
  });

  it('plans activity sessions for under-13 accounts', () => {
    const { focuses } = chooseSplit(ctx({ ageBand: 'under_13' }).profile);
    expect(focuses.every((f) => f === 'activity')).toBe(true);
  });

  it('adds a cardio day when the user asked for cardiovascular fitness', () => {
    const { focuses } = chooseSplit(
      ctx({ interests: ['cardiovascular'], trainingDays: [1, 2, 3, 4] }).profile,
    );
    expect(focuses).toContain('conditioning');
  });
});

describe('generatePlan', () => {
  it('is deterministic for identical inputs', () => {
    const a = generatePlan(ctx());
    const b = generatePlan(ctx());
    expect(JSON.stringify(a.days)).toBe(JSON.stringify(b.days));
  });

  it('changes when the week changes', () => {
    const a = generatePlan(ctx());
    const b = generatePlan(ctx({}, undefined, { weekStart: '2026-10-26' }));
    expect(JSON.stringify(a.days)).not.toBe(JSON.stringify(b.days));
  });

  it('schedules exactly the days the user chose and rests the others', () => {
    const plan = generatePlan(ctx({ trainingDays: [2, 4] }));
    const training = plan.days.filter((d) => !d.isRest);
    expect(training.map((d) => d.dayOfWeek)).toEqual([2, 4]);
    expect(plan.days.filter((d) => d.isRest).length).toBe(5);
  });

  it('never assigns an exercise the user lacks equipment for', () => {
    for (const presetKey of Object.keys(EQUIPMENT_PRESETS)) {
      const available = expandEquipment(EQUIPMENT_PRESETS[presetKey]!.ids);
      const plan = generatePlan(ctx({}, EQUIPMENT_PRESETS[presetKey]!.ids));
      for (const day of plan.days) {
        for (const item of day.exercises) {
          const seed = EXERCISE_BY_ID.get(item.exerciseId)!;
          expect(checkEquipment(seed, available).ok).toBe(true);
        }
      }
    }
  });

  it('checks EVERY requirement group, not just the first', () => {
    // Barbell + plates but no bench and no rack: the bench press must not appear.
    const plan = generatePlan(ctx({}, ['barbell', 'weight_plates']));
    const ids = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain('barbell-bench-press');
  });

  it('reports a gap rather than inventing an equipment-free replacement', () => {
    const plan = generatePlan(ctx({ experience: 'new' }, EQUIPMENT_PRESETS.bodyweight_home!.ids));
    const gaps = plan.days.flatMap((d) => d.gaps);
    expect(gaps.length).toBeGreaterThan(0);
    expect(plan.warnings.join(' ')).toMatch(/left out rather than replaced/i);
    // and the slot really is absent, not filled with something unrelated
    const patternsUsed = new Set(plan.days.flatMap((d) => d.exercises.map((e) => e.slotPattern)));
    for (const gap of gaps) expect(patternsUsed.has(gap.pattern)).toBe(false);
  });

  it('respects the experience level ceiling', () => {
    const plan = generatePlan(ctx({ experience: 'new' }));
    for (const day of plan.days) {
      for (const item of day.exercises) {
        const seed = EXERCISE_BY_ID.get(item.exerciseId)!;
        expect(isLevelAppropriate(seed, 'new', 'adult_18_plus')).toBe(true);
      }
    }
  });

  it('only uses child-suitable exercises for under-13 accounts', () => {
    const plan = generatePlan(ctx({ ageBand: 'under_13' }));
    const assigned = plan.days.flatMap((d) => d.exercises);
    expect(assigned.length).toBeGreaterThan(0);
    for (const item of assigned) {
      const seed = EXERCISE_BY_ID.get(item.exerciseId)!;
      expect(isAgeAppropriate(seed, 'under_13')).toBe(true);
    }
  });

  it('excludes everything a stated limitation rules out', () => {
    const plan = generatePlan(ctx({ limitations: ['knee', 'lower_back'] }));
    const ids = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain('conventional-deadlift');
    expect(ids).not.toContain('squat-jump');
    expect(ids).not.toContain('barbell-back-squat');
  });

  it('excludes exercises the user said they dislike', () => {
    const plan = generatePlan(
      ctx({}, undefined, { dislikedExerciseIds: ['barbell-back-squat', 'leg-press'] }),
    );
    const ids = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain('barbell-back-squat');
    expect(ids).not.toContain('leg-press');
  });

  it('fits sessions to the available time', () => {
    for (const minutes of [20, 30, 45, 60]) {
      const plan = generatePlan(ctx({ sessionMinutes: minutes }));
      for (const day of plan.days.filter((d) => !d.isRest)) {
        expect(day.estimatedMinutes).toBeLessThanOrEqual(Math.round(minutes * 1.15));
      }
    }
  });

  it('builds a genuinely shorter session rather than the same one rushed', () => {
    const long = generatePlan(ctx({ sessionMinutes: 60 }));
    const short = generatePlan(ctx({ sessionMinutes: 20 }));
    const count = (p: typeof long) =>
      p.days.filter((d) => !d.isRest).reduce((s, d) => s + d.exercises.length, 0);
    expect(count(short)).toBeLessThan(count(long));
  });

  it('never repeats an exercise within one day', () => {
    const plan = generatePlan(ctx({ trainingDays: [1, 2, 3, 4, 5] }));
    for (const day of plan.days) {
      const ids = day.exercises.map((e) => e.exerciseId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('prefers loadable work for main slots when the equipment is there', () => {
    const plan = generatePlan(ctx({ interests: ['strength_skills'] }));
    const primaries = plan.days.flatMap((d) => d.exercises.filter((e) => e.role === 'primary'));
    const loadable = primaries.filter(
      (e) => (EXERCISE_BY_ID.get(e.exerciseId)?.equip.length ?? 0) > 0,
    );
    expect(loadable.length / primaries.length).toBeGreaterThan(0.7);
  });

  it('prefers a favourite exercise when it fits the slot', () => {
    const plan = generatePlan(ctx({}, undefined, { favouriteExerciseIds: ['goblet-squat'] }));
    const ids = plan.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).toContain('goblet-squat');
  });

  it('records a written rationale for every exercise', () => {
    const plan = generatePlan(ctx());
    for (const day of plan.days) {
      for (const item of day.exercises) expect(item.rationale.length).toBeGreaterThan(10);
    }
  });

  it('snapshots the inputs it used', () => {
    const plan = generatePlan(ctx());
    expect(plan.inputsSnapshot).toMatchObject({
      ageBand: 'adult_18_plus',
      experience: 'regular',
      weekStart: WEEK,
    });
  });

  it('produces a usable plan even with no equipment at all', () => {
    const plan = generatePlan(ctx({ experience: 'some' }, []));
    const total = plan.days.reduce((s, d) => s + d.exercises.length, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('never uses escalating intensity language for minors', () => {
    const plan = generatePlan(ctx({ ageBand: 'teen_13_17' }));
    const notes = plan.days.flatMap((d) => d.exercises.map((e) => e.intensityNote)).join(' ');
    const lower = notes.toLowerCase();
    // Prescriptive maximal-effort language, as opposed to "stay away from failure".
    expect(lower).not.toMatch(/train to failure|to failure\b(?!.*away)/);
    expect(lower).not.toMatch(/one-rep max|1rm|maximum effort|as heavy as/);
    expect(lower).toContain('technique first');
  });

  it('tells adults to judge load by technique rather than by maximal effort', () => {
    const plan = generatePlan(ctx({ experience: 'regular' }));
    const notes = plan.days.flatMap((d) => d.exercises.map((e) => e.intensityNote)).join(' ');
    expect(notes.toLowerCase()).not.toMatch(/one-rep max|1rm|train to failure/);
  });
});

describe('eligibility helper', () => {
  it('agrees with the plan generator about what is usable', () => {
    const filters = {
      availableEquipment: expandEquipment(EQUIPMENT_PRESETS.minimal_home!.ids),
      ageBand: 'adult_18_plus' as const,
      level: 'some' as const,
      excludedExerciseIds: new Set<string>(),
      excludedPatterns: new Set<string>(),
    };
    const pool = eligibleExercises(filters);
    expect(pool.length).toBeGreaterThan(0);
    for (const e of pool) expect(isEligible(e, filters)).toBe(true);
    const rejected = EXERCISE_CATALOG.filter((e) => !pool.includes(e));
    for (const e of rejected) expect(isEligible(e, filters)).toBe(false);
  });
});

describe('time estimation', () => {
  it('doubles the work for unilateral exercises', () => {
    const p = { sets: 3, repsLow: 10, repsHigh: 10, restSeconds: 60, intensityNote: '' };
    const bilateral = estimateExerciseSeconds({ unilateral: false, timed: false }, p);
    const unilateral = estimateExerciseSeconds({ unilateral: true, timed: false }, p);
    expect(unilateral).toBeGreaterThan(bilateral);
  });

  it('includes warm-up and cool-down in the session estimate', () => {
    const minutes = estimateSessionMinutes([
      {
        exerciseId: 'push-up',
        name: 'Push-up',
        slotPattern: 'horizontal_push',
        role: 'primary',
        sets: 1,
        restSeconds: 0,
        intensityNote: '',
        rationale: '',
        estimatedSeconds: 60,
      },
    ]);
    expect(minutes).toBeGreaterThanOrEqual(8);
  });

  it('returns zero for an empty session', () => {
    expect(estimateSessionMinutes([])).toBe(0);
  });
});
