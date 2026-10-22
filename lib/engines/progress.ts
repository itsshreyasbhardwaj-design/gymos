import type { ExerciseSeed } from '@/lib/content/exercise-types';
import { EXERCISE_BY_ID } from '@/lib/content/exercises';

export interface LogRow {
  exerciseId: string;
  setIndex: number;
  reps: number | null;
  weightGrams: number | null;
  durationSeconds: number | null;
  skipped: boolean;
  sessionId: string;
  date: string;
}

export interface SessionRow {
  id: string;
  scheduledDate: string;
  status: string;
  focus: string;
  completedAt: string | null;
  durationSeconds: number | null;
}

export interface MilestoneCandidate {
  exerciseId: string;
  kind: 'first_time' | 'most_reps' | 'heaviest_set' | 'longest_hold' | 'most_volume';
  reps?: number;
  weightGrams?: number;
  durationSeconds?: number;
  volumeGrams?: number;
  sessionId: string;
}

/**
 * Finds personal milestones from real logged sets only.
 *
 * Nothing here predicts anything. No one-rep-max estimates, no body-composition
 * inference — just "this is the most you have actually done".
 */
export function detectMilestones(
  newLogs: LogRow[],
  history: LogRow[],
): MilestoneCandidate[] {
  const out: MilestoneCandidate[] = [];
  const byExercise = new Map<string, LogRow[]>();
  for (const log of newLogs) {
    if (log.skipped) continue;
    const list = byExercise.get(log.exerciseId) ?? [];
    list.push(log);
    byExercise.set(log.exerciseId, list);
  }

  for (const [exerciseId, logs] of byExercise) {
    const past = history.filter((h) => h.exerciseId === exerciseId && !h.skipped);
    const sessionId = logs[0]?.sessionId ?? '';

    if (past.length === 0) {
      out.push({ exerciseId, kind: 'first_time', sessionId });
    }

    const bestReps = Math.max(...logs.map((l) => l.reps ?? 0));
    const pastBestReps = past.length ? Math.max(...past.map((l) => l.reps ?? 0)) : 0;
    if (bestReps > 0 && bestReps > pastBestReps) {
      out.push({ exerciseId, kind: 'most_reps', reps: bestReps, sessionId });
    }

    const bestWeight = Math.max(...logs.map((l) => l.weightGrams ?? 0));
    const pastBestWeight = past.length ? Math.max(...past.map((l) => l.weightGrams ?? 0)) : 0;
    if (bestWeight > 0 && bestWeight > pastBestWeight) {
      out.push({ exerciseId, kind: 'heaviest_set', weightGrams: bestWeight, sessionId });
    }

    const bestHold = Math.max(...logs.map((l) => l.durationSeconds ?? 0));
    const pastBestHold = past.length ? Math.max(...past.map((l) => l.durationSeconds ?? 0)) : 0;
    if (bestHold > 0 && bestHold > pastBestHold) {
      out.push({ exerciseId, kind: 'longest_hold', durationSeconds: bestHold, sessionId });
    }

    const volume = logs.reduce((sum, l) => sum + (l.reps ?? 0) * (l.weightGrams ?? 0), 0);
    const pastVolumeBySession = new Map<string, number>();
    for (const l of past) {
      pastVolumeBySession.set(
        l.sessionId,
        (pastVolumeBySession.get(l.sessionId) ?? 0) + (l.reps ?? 0) * (l.weightGrams ?? 0),
      );
    }
    const pastBestVolume = pastVolumeBySession.size
      ? Math.max(...pastVolumeBySession.values())
      : 0;
    if (volume > 0 && volume > pastBestVolume) {
      out.push({ exerciseId, kind: 'most_volume', volumeGrams: volume, sessionId });
    }
  }
  return out;
}

export interface WeeklyMetrics {
  weekStart: string;
  sessionsCompleted: number;
  sessionsPlanned: number;
  totalMinutes: number;
  setsLogged: number;
  distinctExercises: number;
  /** Total load moved, in kilograms, from logged sets that recorded a weight. */
  volumeKg: number;
  activityMinutes: number;
}

export function weeklyMetrics(
  weekStart: string,
  sessions: SessionRow[],
  logs: LogRow[],
  activityMinutes = 0,
): WeeklyMetrics {
  const completed = sessions.filter((s) => s.status === 'completed');
  const volumeGrams = logs.reduce((sum, l) => sum + (l.reps ?? 0) * (l.weightGrams ?? 0), 0);
  return {
    weekStart,
    sessionsCompleted: completed.length,
    sessionsPlanned: sessions.length,
    totalMinutes: Math.round(
      completed.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0) / 60,
    ),
    setsLogged: logs.filter((l) => !l.skipped).length,
    distinctExercises: new Set(logs.map((l) => l.exerciseId)).size,
    volumeKg: Math.round(volumeGrams / 1000),
    activityMinutes,
  };
}

export interface ExerciseTrendPoint {
  date: string;
  bestWeightKg: number | null;
  bestReps: number | null;
  bestHoldSeconds: number | null;
  totalVolumeKg: number;
}

export function exerciseTrend(logs: LogRow[]): ExerciseTrendPoint[] {
  const byDate = new Map<string, LogRow[]>();
  for (const l of logs) {
    if (l.skipped) continue;
    const list = byDate.get(l.date) ?? [];
    list.push(l);
    byDate.set(l.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => {
      const weights = rows.map((r) => r.weightGrams ?? 0).filter((w) => w > 0);
      const reps = rows.map((r) => r.reps ?? 0).filter((r) => r > 0);
      const holds = rows.map((r) => r.durationSeconds ?? 0).filter((d) => d > 0);
      return {
        date,
        bestWeightKg: weights.length ? Math.max(...weights) / 1000 : null,
        bestReps: reps.length ? Math.max(...reps) : null,
        bestHoldSeconds: holds.length ? Math.max(...holds) : null,
        totalVolumeKg:
          Math.round(rows.reduce((s, r) => s + (r.reps ?? 0) * (r.weightGrams ?? 0), 0) / 1000),
      };
    });
}

/**
 * Neutral consistency description. Adherence is information, never a scolding:
 * no streak-breaking language, no guilt, no "you failed" framing.
 */
export function describeConsistency(completed: number, planned: number): string {
  if (planned === 0) return 'No sessions were scheduled in this period.';
  const ratio = completed / planned;
  if (completed === 0) return `0 of ${planned} planned sessions logged. A fresh week starts whenever you want it to.`;
  if (ratio >= 1) return `All ${planned} planned sessions logged.`;
  if (ratio >= 0.6) return `${completed} of ${planned} planned sessions logged.`;
  return `${completed} of ${planned} planned sessions logged. Shorter or easier sessions still count.`;
}

export function milestoneLabel(m: MilestoneCandidate): string {
  const name = EXERCISE_BY_ID.get(m.exerciseId)?.name ?? m.exerciseId;
  switch (m.kind) {
    case 'first_time':
      return `First time doing ${name}`;
    case 'most_reps':
      return `Most reps on ${name}: ${m.reps}`;
    case 'heaviest_set':
      return `Heaviest set on ${name}: ${((m.weightGrams ?? 0) / 1000).toFixed(1)} kg`;
    case 'longest_hold':
      return `Longest hold on ${name}: ${m.durationSeconds}s`;
    case 'most_volume':
      return `Most total work on ${name} in one session`;
    default:
      return name;
  }
}

export function muscleBalance(logs: LogRow[]): { muscle: string; sets: number }[] {
  const counts = new Map<string, number>();
  for (const l of logs) {
    if (l.skipped) continue;
    const ex: ExerciseSeed | undefined = EXERCISE_BY_ID.get(l.exerciseId);
    for (const m of ex?.primary ?? []) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([muscle, sets]) => ({ muscle, sets }))
    .sort((a, b) => b.sets - a.sets);
}
