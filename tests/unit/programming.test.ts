import { describe, it, expect } from 'vitest';
import {
  prescribe,
  applyFeedback,
  effectiveLevel,
  isAgeAppropriate,
  isLevelAppropriate,
  buildLimitationFilter,
  restFor,
  LIMITATION_OPTIONS,
} from '@/lib/engines/programming';
import { EXERCISE_BY_ID, EXERCISE_CATALOG } from '@/lib/content/exercises';

const ex = (id: string) => {
  const found = EXERCISE_BY_ID.get(id);
  if (!found) throw new Error(`missing fixture exercise ${id}`);
  return found;
};

describe('effectiveLevel', () => {
  it('forces under-13 accounts to the most conservative level', () => {
    expect(effectiveLevel('experienced', 'under_13')).toBe('new');
  });

  it('caps 13-17 accounts regardless of self-reported experience', () => {
    expect(effectiveLevel('experienced', 'teen_13_17')).toBe('some');
    expect(effectiveLevel('new', 'teen_13_17')).toBe('new');
  });

  it('leaves adults alone', () => {
    expect(effectiveLevel('experienced', 'adult_18_plus')).toBe('experienced');
  });
});

describe('prescribe', () => {
  it('gives under-13 accounts practice reps with no intensity target', () => {
    const p = prescribe({
      exercise: ex('bodyweight-squat'),
      role: 'primary',
      level: 'experienced',
      ageBand: 'under_13',
    });
    expect(p.sets).toBeLessThanOrEqual(2);
    expect(p.intensityNote.toLowerCase()).toContain('practise');
    expect(p.intensityNote.toLowerCase()).not.toContain('load');
  });

  it('keeps 13-17 accounts away from failure and caps sets at three', () => {
    const p = prescribe({
      exercise: ex('goblet-squat'),
      role: 'primary',
      level: 'experienced',
      ageBand: 'teen_13_17',
    });
    expect(p.sets).toBeLessThanOrEqual(3);
    expect(p.intensityNote.toLowerCase()).toContain('reserve');
  });

  it('uses rep ranges for rep-based work and seconds for holds', () => {
    const reps = prescribe({
      exercise: ex('goblet-squat'),
      role: 'primary',
      level: 'some',
      ageBand: 'adult_18_plus',
    });
    expect(reps.repsLow).toBeGreaterThan(0);
    expect(reps.durationSeconds).toBeUndefined();

    const hold = prescribe({
      exercise: ex('plank'),
      role: 'accessory',
      level: 'some',
      ageBand: 'adult_18_plus',
    });
    expect(hold.durationSeconds).toBeGreaterThan(0);
    expect(hold.repsLow).toBeUndefined();
  });

  it('scales rest with how demanding the role and level are', () => {
    expect(restFor('primary', 'experienced')).toBeGreaterThan(restFor('primary', 'new'));
    expect(restFor('primary', 'regular')).toBeGreaterThan(restFor('accessory', 'regular'));
  });

  it('never suggests adding load to an exercise that cannot take it', () => {
    const p = prescribe({
      exercise: ex('wall-sit'),
      role: 'accessory',
      level: 'some',
      ageBand: 'adult_18_plus',
    });
    expect(p.intensityNote.toLowerCase()).not.toContain('pick a load');
  });
});

describe('applyFeedback', () => {
  const base = {
    sets: 3,
    repsLow: 8,
    repsHigh: 12,
    restSeconds: 90,
    intensityNote: '',
  };

  it('reduces volume when discomfort is reported, and never escalates', () => {
    const result = applyFeedback({
      previous: base,
      difficulty: 'too_easy',
      recovery: 'fresh',
      discomfortReported: true,
      ageBand: 'adult_18_plus',
    });
    expect(result.next.sets).toBeLessThan(base.sets);
    expect(result.reason).toBe('discomfort_reported');
    expect(result.next.intensityNote.toLowerCase()).toContain('professional');
  });

  it('reduces volume and lengthens rest after a session reported too hard', () => {
    const result = applyFeedback({
      previous: base,
      difficulty: 'too_hard',
      ageBand: 'adult_18_plus',
    });
    expect(result.next.sets).toBe(2);
    expect(result.next.restSeconds).toBeGreaterThan(base.restSeconds);
    expect(result.next.repsHigh!).toBeLessThan(base.repsHigh);
  });

  it('eases off when recovery is very poor even if difficulty felt fine', () => {
    const result = applyFeedback({
      previous: base,
      difficulty: 'about_right',
      recovery: 'very_tired',
      ageBand: 'adult_18_plus',
    });
    expect(result.next.sets).toBeLessThan(base.sets);
  });

  it('adds only ONE small increment when a session felt easy', () => {
    const result = applyFeedback({
      previous: base,
      difficulty: 'too_easy',
      recovery: 'fresh',
      ageBand: 'adult_18_plus',
    });
    expect(result.next.sets).toBe(base.sets);
    expect(result.next.repsLow).toBe(base.repsLow + 1);
    expect(result.next.repsHigh).toBe(base.repsHigh + 2);
  });

  it('does not escalate without positive feedback', () => {
    const result = applyFeedback({ previous: base, ageBand: 'adult_18_plus' });
    expect(result.changed).toBe(false);
    expect(result.next).toEqual(base);
  });

  it('does not escalate on "too easy" when recovery is poor', () => {
    const result = applyFeedback({
      previous: base,
      difficulty: 'too_easy',
      recovery: 'very_tired',
      ageBand: 'adult_18_plus',
    });
    expect(result.next.sets).toBeLessThan(base.sets);
  });

  it('keeps minors capped even after repeated positive feedback', () => {
    let current = { sets: 3, restSeconds: 60, durationSeconds: 30, intensityNote: '' };
    for (let i = 0; i < 10; i += 1) {
      current = applyFeedback({
        previous: current,
        difficulty: 'too_easy',
        recovery: 'fresh',
        ageBand: 'teen_13_17',
      }).next as typeof current;
    }
    expect(current.sets).toBeLessThanOrEqual(3);
  });
});

describe('age suitability', () => {
  it('excludes technique-heavy lifts from 13-17 accounts', () => {
    expect(isAgeAppropriate(ex('conventional-deadlift'), 'teen_13_17')).toBe(false);
    expect(isAgeAppropriate(ex('sissy-squat-assisted'), 'teen_13_17')).toBe(false);
  });

  it('allows only explicitly child-suitable exercises for under-13 accounts', () => {
    const allowed = EXERCISE_CATALOG.filter((e) => isAgeAppropriate(e, 'under_13'));
    expect(allowed.length).toBeGreaterThan(10);
    expect(allowed.every((e) => e.childOk === true)).toBe(true);
    expect(isAgeAppropriate(ex('barbell-back-squat'), 'under_13')).toBe(false);
  });

  it('never offers an exercise above the effective experience level', () => {
    expect(isLevelAppropriate(ex('pull-up'), 'new', 'adult_18_plus')).toBe(false);
    expect(isLevelAppropriate(ex('pull-up'), 'experienced', 'adult_18_plus')).toBe(true);
    // A teen is capped at "some" however they describe themselves.
    expect(isLevelAppropriate(ex('pull-up'), 'experienced', 'teen_13_17')).toBe(false);
  });
});

describe('limitation filters', () => {
  it('excludes jumping for someone who asked for no impact', () => {
    const filter = buildLimitationFilter(['avoid_jumping']);
    expect(filter.excludedPatterns.has('plyometric')).toBe(true);
    expect(filter.notes.length).toBeGreaterThan(0);
  });

  it('excludes loaded spinal flexion for a sensitive lower back', () => {
    const filter = buildLimitationFilter(['lower_back']);
    expect(filter.excludedExerciseIds.has('conventional-deadlift')).toBe(true);
    expect(filter.excludedExerciseIds.has('barbell-row')).toBe(true);
  });

  it('excludes overhead pressing for sensitive shoulders', () => {
    const filter = buildLimitationFilter(['shoulder']);
    expect(filter.excludedPatterns.has('vertical_push')).toBe(true);
  });

  it('points pregnancy and postpartum users to their own healthcare professional', () => {
    const filter = buildLimitationFilter(['pregnancy_postpartum']);
    expect(filter.notes.join(' ')).toMatch(/healthcare professional/i);
  });

  it('handles every documented limitation without throwing', () => {
    for (const option of LIMITATION_OPTIONS) {
      const filter = buildLimitationFilter([option.id]);
      expect(filter.notes.length).toBe(1);
    }
  });

  it('ignores unknown limitation ids rather than failing', () => {
    expect(buildLimitationFilter(['not-a-real-limitation']).notes).toEqual([]);
  });
});
