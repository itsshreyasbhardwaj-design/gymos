import { describe, it, expect } from 'vitest';
import {
  adaptToEquipment,
  adaptToTime,
  adaptUnavailableEquipment,
  adaptAfterDifficulty,
  adaptMissedSession,
  adaptScheduleChange,
  type SessionContext,
} from '@/lib/engines/realitysync';
import { generatePlan } from '@/lib/engines/workout-generator';
import { expandEquipment, checkEquipment } from '@/lib/engines/equipment';
import { EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import { EXERCISE_BY_ID } from '@/lib/content/exercises';
import { findSubstitutes } from '@/lib/engines/substitution';

const CTX: SessionContext = {
  ageBand: 'adult_18_plus',
  experience: 'regular',
  limitations: [],
};

function gymSession() {
  const plan = generatePlan({
    profile: {
      userId: 'u',
      ageBand: 'adult_18_plus',
      experience: 'regular',
      interests: ['strength_skills'],
      trainingDays: [1],
      sessionMinutes: 60,
      limitations: [],
    },
    availableEquipment: expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids),
    weekStart: '2026-10-19',
  });
  return plan.days.find((d) => !d.isRest)!.exercises;
}

describe('Scenario A — different equipment', () => {
  it('keeps what still works and swaps what does not', () => {
    const planned = gymSession();
    const home = expandEquipment(EQUIPMENT_PRESETS.minimal_home!.ids);
    const proposal = adaptToEquipment(planned, CTX, home, {
      fromProfileName: 'Main Gym',
      toProfileName: 'Home',
    });
    expect(proposal.trigger).toBe('equipment_profile_changed');
    for (const item of proposal.exercises) {
      const seed = EXERCISE_BY_ID.get(item.exerciseId)!;
      expect(checkEquipment(seed, home).ok).toBe(true);
    }
    expect(proposal.changes.some((c) => c.kind === 'substitute' || c.kind === 'keep')).toBe(true);
  });

  it('explains every change and confirms the replacement equipment is available', () => {
    const proposal = adaptToEquipment(
      gymSession(),
      CTX,
      expandEquipment(EQUIPMENT_PRESETS.travel!.ids),
    );
    for (const change of proposal.changes) {
      expect(change.reason.length).toBeGreaterThan(5);
      if (change.kind === 'substitute' || change.kind === 'keep') {
        expect(change.equipmentSatisfied).toBe(true);
      }
    }
    expect(proposal.inputsConsidered.length).toBeGreaterThan(3);
  });

  it('drops a slot rather than claiming a bodyweight equivalent exists', () => {
    const planned = [
      {
        exerciseId: 'lat-pulldown-ex',
        name: 'Lat pulldown',
        slotPattern: 'vertical_pull' as const,
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
    const bodyweight = expandEquipment([]);
    const proposal = adaptToEquipment(planned, CTX, bodyweight);
    expect(proposal.exercises.length).toBe(0);
    expect(proposal.changes[0]?.kind).toBe('blocked');
    expect(proposal.warnings.join(' ')).toMatch(/no equivalent/i);
  });

  it('carries the existing dose across rather than quietly changing the load', () => {
    const planned = [
      {
        exerciseId: 'barbell-bench-press',
        name: 'Barbell bench press',
        slotPattern: 'horizontal_push' as const,
        role: 'primary' as const,
        sets: 4,
        repsLow: 5,
        repsHigh: 8,
        restSeconds: 150,
        intensityNote: '',
        rationale: '',
        estimatedSeconds: 900,
      },
    ];
    const home = expandEquipment(['dumbbells', 'flat_bench']);
    const proposal = adaptToEquipment(planned, CTX, home);
    const replacement = proposal.exercises[0];
    expect(replacement).toBeDefined();
    expect(replacement!.sets).toBe(4);
    expect(replacement!.repsLow).toBe(5);
    expect(replacement!.substitutedFromExerciseId).toBe('barbell-bench-press');
  });

  it('reports no change needed when everything already works', () => {
    const planned = gymSession();
    const same = expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids);
    const proposal = adaptToEquipment(planned, CTX, same);
    expect(proposal.noChangeNeeded).toBe(true);
  });
});

describe('Scenario B — less time', () => {
  it('produces a genuinely shorter session, not the same one rushed', () => {
    const planned = gymSession();
    const before = planned.reduce((s, e) => s + e.estimatedSeconds, 0);
    const proposal = adaptToTime(planned, 20);
    const after = proposal.exercises.reduce((s, e) => s + e.estimatedSeconds, 0);
    expect(after).toBeLessThan(before);
    expect(proposal.exercises.length).toBeLessThanOrEqual(planned.length);
  });

  it('protects the primary work and drops accessories first', () => {
    const planned = gymSession();
    const proposal = adaptToTime(planned, 20);
    const primariesBefore = planned.filter((e) => e.role === 'primary').length;
    const primariesAfter = proposal.exercises.filter((e) => e.role === 'primary').length;
    expect(primariesAfter).toBeGreaterThanOrEqual(Math.min(1, primariesBefore));
    const removed = proposal.changes.filter((c) => c.kind === 'remove');
    expect(removed.length).toBeGreaterThan(0);
  });

  it('never cuts primary work below two sets', () => {
    const planned = gymSession();
    const proposal = adaptToTime(planned, 10);
    for (const e of proposal.exercises) {
      if (e.role === 'primary') expect(e.sets).toBeGreaterThanOrEqual(2);
    }
  });

  it('says plainly when even the trimmed session will not fit', () => {
    const proposal = adaptToTime(gymSession(), 8);
    expect(proposal.warnings.join(' ')).toMatch(/perfectly good session|minutes/i);
  });

  it('changes nothing when the session already fits', () => {
    const proposal = adaptToTime(gymSession(), 120);
    expect(proposal.noChangeNeeded).toBe(true);
  });
});

describe('Scenario C — missed session', () => {
  const missed = {
    id: 's1',
    scheduledDate: '2026-10-19',
    label: 'Monday — Upper body',
    status: 'scheduled',
  };

  it('moves the session to the next free day when there is room', () => {
    const proposal = adaptMissedSession(missed, [missed], {
      availableDates: ['2026-10-19', '2026-10-20', '2026-10-21'],
      today: '2026-10-19',
      flexibility: 'some',
    });
    expect(proposal.moves[0]?.to).toBe('2026-10-20');
    expect(proposal.changes[0]?.kind).toBe('reschedule');
  });

  it('never doubles another session to compensate', () => {
    const proposal = adaptMissedSession(missed, [missed], {
      availableDates: ['2026-10-19'],
      today: '2026-10-19',
      flexibility: 'some',
    });
    expect(proposal.moves[0]?.to).toBeNull();
    expect(proposal.explanation.join(' ')).toMatch(/never|no session is made longer/i);
    expect(JSON.stringify(proposal).toLowerCase()).not.toMatch(/double|make up for|catch up/);
  });

  it('respects a user who said their schedule is fixed', () => {
    const proposal = adaptMissedSession(missed, [missed], {
      availableDates: ['2026-10-19', '2026-10-22'],
      today: '2026-10-19',
      flexibility: 'rigid',
    });
    expect(proposal.moves[0]?.to).toBeNull();
    expect(proposal.changes[0]?.reason).toMatch(/fixed/i);
  });

  it('leaves history alone', () => {
    const proposal = adaptMissedSession(missed, [missed], {
      availableDates: ['2026-10-20'],
      today: '2026-10-19',
      flexibility: 'flexible',
    });
    expect(proposal.explanation.join(' ')).toMatch(/history is untouched/i);
  });
});

describe('Scenario D — equipment unavailable', () => {
  it('only touches exercises that need the unavailable item', () => {
    const planned = gymSession();
    const available = expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids);
    const proposal = adaptUnavailableEquipment(planned, CTX, available, 'leg_press');
    expect(proposal.trigger).toBe('equipment_unavailable');
    const reduced = new Set(available);
    reduced.delete('leg_press');
    for (const item of proposal.exercises) {
      const seed = EXERCISE_BY_ID.get(item.exerciseId)!;
      expect(checkEquipment(seed, reduced).ok).toBe(true);
    }
  });

  it('offers skipping as an option rather than forcing a swap', () => {
    const proposal = adaptUnavailableEquipment(
      gymSession(),
      CTX,
      expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids),
      'cable_machine',
    );
    expect(proposal.explanation.join(' ')).toMatch(/skip that exercise/i);
  });
});

describe('Scenario E — session was too hard', () => {
  it('reduces volume and never escalates', () => {
    const planned = gymSession();
    const proposal = adaptAfterDifficulty(planned, CTX, { difficulty: 'too_hard' });
    for (const [i, item] of proposal.exercises.entries()) {
      expect(item.sets).toBeLessThanOrEqual(planned[i]!.sets);
    }
    expect(proposal.changes.every((c) => c.kind === 'reduce')).toBe(true);
  });

  it('warns and defers to a professional when discomfort was reported', () => {
    const proposal = adaptAfterDifficulty(gymSession(), CTX, { discomfortReported: true });
    expect(proposal.warnings.join(' ')).toMatch(/qualified professional/i);
    expect(proposal.warnings.join(' ')).toMatch(/cannot tell you what caused it/i);
  });

  it('does not try to diagnose the cause', () => {
    const proposal = adaptAfterDifficulty(gymSession(), CTX, { discomfortReported: true });
    const text = JSON.stringify(proposal).toLowerCase();
    expect(text).not.toMatch(/strain|tendonitis|impingement|you (probably|likely) have/);
  });
});

describe('Scenario F — travel', () => {
  it('re-plans onto the travel profile and flags it as travel', () => {
    const proposal = adaptToEquipment(
      gymSession(),
      CTX,
      expandEquipment(EQUIPMENT_PRESETS.travel!.ids),
      { travel: true },
    );
    expect(proposal.trigger).toBe('travel');
  });
});

describe('Scenario G — schedule change', () => {
  it('moves upcoming sessions onto the new days', () => {
    const proposal = adaptScheduleChange(
      [1, 3, 5],
      [2, 4],
      [
        { id: 'a', scheduledDate: '2026-10-19', label: 'Upper', status: 'scheduled' },
        { id: 'b', scheduledDate: '2026-10-21', label: 'Lower', status: 'scheduled' },
      ],
    );
    expect(proposal.moves.length).toBe(2);
    for (const move of proposal.moves) {
      const dow = new Date(`${move.to}T00:00:00Z`).getUTCDay();
      expect([2, 4]).toContain(dow);
    }
  });

  it('says that completed sessions are never moved', () => {
    const proposal = adaptScheduleChange([1], [3], []);
    expect(proposal.explanation.join(' ')).toMatch(/completed sessions.*stay/i);
  });
});

describe('substitution engine', () => {
  it('prefers curated substitutes that the user can actually do', () => {
    const original = EXERCISE_BY_ID.get('barbell-bench-press')!;
    const result = findSubstitutes(original, {
      availableEquipment: expandEquipment(['dumbbells', 'flat_bench']),
      ageBand: 'adult_18_plus',
      level: 'regular',
    });
    expect(result.options.length).toBeGreaterThan(0);
    expect(result.options[0]?.exercise.id).toBe('dumbbell-bench-press');
  });

  it('marks a different-pattern match as partial', () => {
    const original = EXERCISE_BY_ID.get('lat-pulldown-ex')!;
    const result = findSubstitutes(original, {
      availableEquipment: expandEquipment(['dumbbells']),
      ageBand: 'adult_18_plus',
      level: 'regular',
    });
    for (const option of result.options) {
      if (!option.samePattern) expect(option.reason).toMatch(/partial match/i);
    }
  });

  it('falls back to a muscle match only when it can label it as partial', () => {
    const original = EXERCISE_BY_ID.get('leg-press')!;
    const result = findSubstitutes(original, {
      availableEquipment: expandEquipment([]),
      ageBand: 'adult_18_plus',
      level: 'new',
      excludedPatterns: new Set(['squat']),
    });
    // The squat pattern is excluded, so anything offered must be a different pattern
    // AND must say so rather than implying it is equivalent.
    expect(result.options.length).toBeGreaterThan(0);
    for (const option of result.options) {
      expect(option.samePattern).toBe(false);
      expect(option.reason).toMatch(/partial match/i);
      expect(option.sharedPrimaryMuscles.length).toBeGreaterThan(0);
    }
  });

  it('returns nothing, with a reason, when no honest substitute exists at all', () => {
    const original = EXERCISE_BY_ID.get('lat-pulldown-ex')!;
    const result = findSubstitutes(original, {
      availableEquipment: expandEquipment([]),
      ageBand: 'adult_18_plus',
      level: 'new',
    });
    // Nothing trains the lats with no equipment at a beginner level, so GymOS says so.
    expect(result.options.length).toBe(0);
    expect(result.noMatchReason).toBeTruthy();
    expect(result.noMatchReason).toMatch(/no equipment-free movement|not available/i);
  });

  it('never offers a stretch as a substitute for a strength exercise', () => {
    // Regression: child's pose shares the "lats" tag with a lat pulldown, but a
    // mobility stretch is not a substitute for a strength exercise.
    for (const id of ['lat-pulldown-ex', 'barbell-row', 'pull-up']) {
      const original = EXERCISE_BY_ID.get(id)!;
      const result = findSubstitutes(original, {
        availableEquipment: expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids),
        ageBand: 'adult_18_plus',
        level: 'experienced',
      });
      for (const option of result.options) {
        expect(option.exercise.cat).not.toBe('mobility');
        expect(option.exercise.cat).not.toBe('cardio');
      }
    }
  });

  it('never offers a strength exercise as a substitute for cardio', () => {
    const original = EXERCISE_BY_ID.get('brisk-walk')!;
    const result = findSubstitutes(original, {
      availableEquipment: expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids),
      ageBand: 'adult_18_plus',
      level: 'regular',
    });
    for (const option of result.options) expect(option.exercise.cat).toBe('cardio');
  });

  it('never suggests something the age band forbids', () => {
    const original = EXERCISE_BY_ID.get('barbell-back-squat')!;
    const result = findSubstitutes(original, {
      availableEquipment: expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids),
      ageBand: 'under_13',
      level: 'some',
    });
    for (const option of result.options) expect(option.exercise.childOk).toBe(true);
  });
});
