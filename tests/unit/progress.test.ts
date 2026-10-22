import { describe, it, expect } from 'vitest';
import {
  detectMilestones,
  weeklyMetrics,
  exerciseTrend,
  describeConsistency,
  muscleBalance,
  milestoneLabel,
  type LogRow,
} from '@/lib/engines/progress';

const log = (over: Partial<LogRow> = {}): LogRow => ({
  exerciseId: 'goblet-squat',
  setIndex: 1,
  reps: 10,
  weightGrams: 20000,
  durationSeconds: null,
  skipped: false,
  sessionId: 's1',
  date: '2026-10-19',
  ...over,
});

describe('detectMilestones', () => {
  it('records a first-time milestone with no history', () => {
    const found = detectMilestones([log()], []);
    expect(found.some((m) => m.kind === 'first_time')).toBe(true);
  });

  it('does not re-record first time once there is history', () => {
    const found = detectMilestones([log({ sessionId: 's2' })], [log()]);
    expect(found.some((m) => m.kind === 'first_time')).toBe(false);
  });

  it('records a heavier set only when it beats the record', () => {
    const history = [log({ weightGrams: 30000 })];
    expect(
      detectMilestones([log({ sessionId: 's2', weightGrams: 25000 })], history).some(
        (m) => m.kind === 'heaviest_set',
      ),
    ).toBe(false);
    expect(
      detectMilestones([log({ sessionId: 's2', weightGrams: 35000 })], history).some(
        (m) => m.kind === 'heaviest_set',
      ),
    ).toBe(true);
  });

  it('records most reps and longest hold separately', () => {
    const reps = detectMilestones([log({ reps: 20, sessionId: 's2' })], [log({ reps: 10 })]);
    expect(reps.some((m) => m.kind === 'most_reps' && m.reps === 20)).toBe(true);

    const hold = detectMilestones(
      [log({ exerciseId: 'plank', reps: null, weightGrams: null, durationSeconds: 90, sessionId: 's2' })],
      [log({ exerciseId: 'plank', reps: null, weightGrams: null, durationSeconds: 45 })],
    );
    expect(hold.some((m) => m.kind === 'longest_hold' && m.durationSeconds === 90)).toBe(true);
  });

  it('ignores skipped sets', () => {
    expect(detectMilestones([log({ skipped: true })], [])).toEqual([]);
  });

  it('compares session volume against the best previous SESSION, not the total', () => {
    const history = [
      log({ sessionId: 'a', reps: 10, weightGrams: 20000 }),
      log({ sessionId: 'b', setIndex: 2, reps: 10, weightGrams: 20000 }),
    ];
    // 1 set of the same work is not a volume record even though history has 2 sets total.
    const found = detectMilestones([log({ sessionId: 'c', reps: 10, weightGrams: 20000 })], history);
    expect(found.some((m) => m.kind === 'most_volume')).toBe(false);
  });

  it('never predicts a one-rep max or any future value', () => {
    const found = detectMilestones([log()], []);
    for (const m of found) {
      expect(['first_time', 'most_reps', 'heaviest_set', 'longest_hold', 'most_volume']).toContain(
        m.kind,
      );
    }
    expect(JSON.stringify(found).toLowerCase()).not.toMatch(/1rm|estimated|predict|projected/);
  });

  it('labels milestones readably', () => {
    expect(milestoneLabel({ exerciseId: 'goblet-squat', kind: 'first_time', sessionId: 's' })).toMatch(
      /First time/i,
    );
    expect(
      milestoneLabel({ exerciseId: 'goblet-squat', kind: 'heaviest_set', weightGrams: 25500, sessionId: 's' }),
    ).toContain('25.5 kg');
  });
});

describe('weeklyMetrics', () => {
  it('counts only completed sessions', () => {
    const metrics = weeklyMetrics(
      '2026-10-19',
      [
        { id: 'a', scheduledDate: '2026-10-19', status: 'completed', focus: 'full_body', completedAt: 'x', durationSeconds: 2700 },
        { id: 'b', scheduledDate: '2026-10-21', status: 'skipped', focus: 'full_body', completedAt: null, durationSeconds: null },
      ],
      [log()],
    );
    expect(metrics.sessionsCompleted).toBe(1);
    expect(metrics.sessionsPlanned).toBe(2);
    expect(metrics.totalMinutes).toBe(45);
  });

  it('computes load only from sets that recorded a weight', () => {
    const metrics = weeklyMetrics('2026-10-19', [], [
      log({ reps: 10, weightGrams: 20000 }),
      log({ setIndex: 2, reps: 10, weightGrams: null }),
    ]);
    expect(metrics.volumeKg).toBe(200);
  });
});

describe('exerciseTrend', () => {
  it('returns one point per date, sorted', () => {
    const points = exerciseTrend([
      log({ date: '2026-10-21', weightGrams: 25000 }),
      log({ date: '2026-10-19', weightGrams: 20000 }),
      log({ date: '2026-10-19', setIndex: 2, weightGrams: 22000 }),
    ]);
    expect(points.map((p) => p.date)).toEqual(['2026-10-19', '2026-10-21']);
    expect(points[0]!.bestWeightKg).toBe(22);
  });

  it('returns null rather than zero when nothing was recorded', () => {
    const points = exerciseTrend([log({ weightGrams: null, reps: null, durationSeconds: 60 })]);
    expect(points[0]!.bestWeightKg).toBeNull();
    expect(points[0]!.bestHoldSeconds).toBe(60);
  });
});

describe('describeConsistency', () => {
  it('never scolds, shames or mentions streaks', () => {
    const samples = [
      describeConsistency(0, 3),
      describeConsistency(1, 3),
      describeConsistency(3, 3),
      describeConsistency(0, 0),
    ];
    for (const text of samples) {
      expect(text.toLowerCase()).not.toMatch(/fail|streak|missed out|lazy|should have|behind/);
    }
    expect(describeConsistency(0, 3)).toMatch(/fresh week/i);
  });

  it('reports plain counts', () => {
    expect(describeConsistency(2, 3)).toContain('2 of 3');
  });
});

describe('muscleBalance', () => {
  it('counts sets per primary muscle, most first', () => {
    const balance = muscleBalance([
      log({ exerciseId: 'goblet-squat' }),
      log({ exerciseId: 'goblet-squat', setIndex: 2 }),
      log({ exerciseId: 'push-up' }),
    ]);
    expect(balance[0]!.sets).toBeGreaterThanOrEqual(balance[balance.length - 1]!.sets);
    expect(balance.some((b) => b.muscle === 'quadriceps')).toBe(true);
  });

  it('ignores skipped sets', () => {
    expect(muscleBalance([log({ skipped: true })])).toEqual([]);
  });
});
