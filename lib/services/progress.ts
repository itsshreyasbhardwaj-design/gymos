import 'server-only';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  exerciseLogs,
  workoutSessions,
  activityRecords,
  performanceMilestones,
  progressSnapshots,
  biometricRecords,
  plannedMeals,
  mealPlans,
} from '@/lib/db/schema';
import {
  weeklyMetrics,
  exerciseTrend,
  describeConsistency,
  muscleBalance,
  milestoneLabel,
  type LogRow,
} from '@/lib/engines/progress';
import { EXERCISE_BY_ID } from '@/lib/content/exercises';
import { MUSCLE_LABELS } from '@/lib/content/exercise-types';
import { newId } from '@/lib/auth/ids';
import { addDays, mondayOf } from '@/lib/engines/nutrition';
import { getEntitlement, type Plan } from '@/lib/engines/entitlements';
import { getConsent } from './account';

/** The history window a plan allows. Free accounts see the last 30 days. */
export function historyWindowStart(plan: Plan): string | null {
  const days = getEntitlement(plan, 'history_days').limitValue;
  if (days == null) return null;
  return addDays(new Date().toISOString().slice(0, 10), -days);
}

function logRows(userId: string, from: string | null): LogRow[] {
  const clauses = [eq(workoutSessions.userId, userId)];
  if (from) clauses.push(gte(workoutSessions.scheduledDate, from));
  return db
    .select({
      exerciseId: exerciseLogs.exerciseId,
      setIndex: exerciseLogs.setIndex,
      reps: exerciseLogs.reps,
      weightGrams: exerciseLogs.weightGrams,
      durationSeconds: exerciseLogs.durationSeconds,
      skipped: exerciseLogs.skipped,
      sessionId: exerciseLogs.sessionId,
      date: workoutSessions.scheduledDate,
    })
    .from(exerciseLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, exerciseLogs.sessionId))
    .where(and(...clauses))
    .all();
}

export interface ProgressOverview {
  windowStart: string | null;
  windowLimited: boolean;
  weeks: {
    weekStart: string;
    sessionsCompleted: number;
    sessionsPlanned: number;
    totalMinutes: number;
    setsLogged: number;
    volumeKg: number;
    activityMinutes: number;
  }[];
  consistencyNote: string;
  totals: {
    sessionsCompleted: number;
    setsLogged: number;
    distinctExercises: number;
    volumeKg: number;
    activityMinutes: number;
  };
  muscleBalance: { muscle: string; label: string; sets: number }[];
  milestones: { label: string; achievedAt: string; exerciseId: string }[];
  mealsPlanned: number;
  mealsCooked: number;
  biometricsEnabled: boolean;
}

export function progressOverview(userId: string, plan: Plan, weeks = 8): ProgressOverview {
  const windowStart = historyWindowStart(plan);
  const today = new Date().toISOString().slice(0, 10);
  const earliestRequested = addDays(mondayOf(today), -7 * (weeks - 1));
  const from =
    windowStart && windowStart > earliestRequested ? windowStart : earliestRequested;

  const sessions = db
    .select({
      id: workoutSessions.id,
      scheduledDate: workoutSessions.scheduledDate,
      status: workoutSessions.status,
      focus: workoutSessions.focus,
      completedAt: workoutSessions.completedAt,
      durationSeconds: workoutSessions.durationSeconds,
    })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), gte(workoutSessions.scheduledDate, from)))
    .all();
  const logs = logRows(userId, from);

  const activity = db
    .select({ date: activityRecords.date, minutes: activityRecords.minutes })
    .from(activityRecords)
    .where(and(eq(activityRecords.userId, userId), gte(activityRecords.date, from)))
    .all();

  const weekBuckets: ProgressOverview['weeks'] = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const weekStart = addDays(mondayOf(today), -7 * i);
    if (windowStart && weekStart < windowStart && addDays(weekStart, 6) < windowStart) continue;
    const weekEnd = addDays(weekStart, 6);
    const weekSessions = sessions.filter(
      (s) => s.scheduledDate >= weekStart && s.scheduledDate <= weekEnd,
    );
    const weekLogs = logs.filter((l) => l.date >= weekStart && l.date <= weekEnd);
    const weekActivity = activity
      .filter((a) => a.date >= weekStart && a.date <= weekEnd)
      .reduce((s, a) => s + (a.minutes ?? 0), 0);
    const m = weeklyMetrics(weekStart, weekSessions, weekLogs, weekActivity);
    weekBuckets.push({
      weekStart: m.weekStart,
      sessionsCompleted: m.sessionsCompleted,
      sessionsPlanned: m.sessionsPlanned,
      totalMinutes: m.totalMinutes,
      setsLogged: m.setsLogged,
      volumeKg: m.volumeKg,
      activityMinutes: m.activityMinutes,
    });
  }

  const completed = sessions.filter((s) => s.status === 'completed').length;
  const planned = sessions.length;

  const milestones = db
    .select()
    .from(performanceMilestones)
    .where(eq(performanceMilestones.userId, userId))
    .orderBy(desc(performanceMilestones.achievedAt))
    .limit(12)
    .all();

  const meals = db
    .select({ status: plannedMeals.status })
    .from(plannedMeals)
    .innerJoin(mealPlans, eq(mealPlans.id, plannedMeals.mealPlanId))
    .where(eq(mealPlans.userId, userId))
    .all();

  return {
    windowStart,
    windowLimited: windowStart != null,
    weeks: weekBuckets,
    consistencyNote: describeConsistency(completed, planned),
    totals: {
      sessionsCompleted: completed,
      setsLogged: logs.filter((l) => !l.skipped).length,
      distinctExercises: new Set(logs.map((l) => l.exerciseId)).size,
      volumeKg: Math.round(
        logs.reduce((s, l) => s + (l.reps ?? 0) * (l.weightGrams ?? 0), 0) / 1000,
      ),
      activityMinutes: activity.reduce((s, a) => s + (a.minutes ?? 0), 0),
    },
    muscleBalance: muscleBalance(logs)
      .slice(0, 12)
      .map((m) => ({ ...m, label: MUSCLE_LABELS[m.muscle] ?? m.muscle })),
    milestones: milestones.map((m) => ({
      label: milestoneLabel({
        exerciseId: m.exerciseId,
        kind: m.kind,
        reps: m.reps ?? undefined,
        weightGrams: m.weightGrams ?? undefined,
        durationSeconds: m.durationSeconds ?? undefined,
        volumeGrams: m.volumeGrams ?? undefined,
        sessionId: m.sessionId ?? '',
      }),
      achievedAt: m.achievedAt,
      exerciseId: m.exerciseId,
    })),
    mealsPlanned: meals.length,
    mealsCooked: meals.filter((m) => m.status === 'cooked').length,
    biometricsEnabled: getConsent(userId, 'biometrics'),
  };
}

export function exerciseHistory(userId: string, exerciseId: string, plan: Plan) {
  const from = historyWindowStart(plan);
  const logs = logRows(userId, from).filter((l) => l.exerciseId === exerciseId);
  return {
    exerciseName: EXERCISE_BY_ID.get(exerciseId)?.name ?? exerciseId,
    points: exerciseTrend(logs),
    setCount: logs.filter((l) => !l.skipped).length,
  };
}

export function loggedExerciseIds(userId: string): { exerciseId: string; name: string; sets: number }[] {
  return db
    .select({ exerciseId: exerciseLogs.exerciseId, sets: sql<number>`count(*)` })
    .from(exerciseLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, exerciseLogs.sessionId))
    .where(eq(workoutSessions.userId, userId))
    .groupBy(exerciseLogs.exerciseId)
    .orderBy(desc(sql`count(*)`))
    .all()
    .map((r) => ({
      exerciseId: r.exerciseId,
      name: EXERCISE_BY_ID.get(r.exerciseId)?.name ?? r.exerciseId,
      sets: r.sets,
    }));
}

/* --------------------------------------------------------------- activities */

export function listActivities(userId: string, limit = 50) {
  return db
    .select()
    .from(activityRecords)
    .where(eq(activityRecords.userId, userId))
    .orderBy(desc(activityRecords.date))
    .limit(limit)
    .all();
}

export function addActivity(
  userId: string,
  input: {
    kind: 'walk' | 'cycle' | 'run' | 'swim' | 'sport' | 'other';
    date: string;
    minutes?: number;
    distanceMeters?: number;
    steps?: number;
    notes?: string;
  },
): void {
  db.insert(activityRecords)
    .values({
      id: newId(),
      userId,
      kind: input.kind,
      date: input.date,
      minutes: input.minutes ?? null,
      distanceMeters: input.distanceMeters ?? null,
      steps: input.steps ?? null,
      notes: (input.notes ?? '').slice(0, 300),
      source: 'manual',
    })
    .run();
}

export function deleteActivity(userId: string, id: string): void {
  db.delete(activityRecords)
    .where(and(eq(activityRecords.id, id), eq(activityRecords.userId, userId)))
    .run();
}

/* --------------------------------------------------------------- biometrics */

export class ConsentRequiredError extends Error {
  constructor(message = 'This needs your consent first.') {
    super(message);
    this.name = 'ConsentRequiredError';
  }
}

export function listBiometrics(userId: string, limit = 60) {
  if (!getConsent(userId, 'biometrics')) throw new ConsentRequiredError();
  return db
    .select()
    .from(biometricRecords)
    .where(eq(biometricRecords.userId, userId))
    .orderBy(desc(biometricRecords.date))
    .limit(limit)
    .all();
}

export function recordBiometric(
  userId: string,
  input: {
    date: string;
    kind: 'steps' | 'sleep_minutes' | 'resting_hr' | 'body_mass_grams' | 'self_reported_recovery';
    value: number;
    unit: string;
  },
): void {
  if (!getConsent(userId, 'biometrics')) {
    throw new ConsentRequiredError(
      'Turn on optional biometric records in Settings → Privacy before saving these.',
    );
  }
  db.insert(biometricRecords)
    .values({
      id: newId(),
      userId,
      date: input.date,
      kind: input.kind,
      value: input.value,
      unit: input.unit,
      source: 'manual',
    })
    .onConflictDoUpdate({
      target: [biometricRecords.userId, biometricRecords.date, biometricRecords.kind],
      set: { value: input.value, unit: input.unit },
    })
    .run();
}

export function deleteAllBiometrics(userId: string): number {
  const rows = db
    .select({ id: biometricRecords.id })
    .from(biometricRecords)
    .where(eq(biometricRecords.userId, userId))
    .all();
  db.delete(biometricRecords).where(eq(biometricRecords.userId, userId)).run();
  return rows.length;
}

export function snapshotWeek(userId: string, weekStart: string, metrics: Record<string, number>): void {
  db.insert(progressSnapshots)
    .values({ id: newId(), userId, weekStart, metrics })
    .onConflictDoUpdate({
      target: [progressSnapshots.userId, progressSnapshots.weekStart],
      set: { metrics },
    })
    .run();
}
