import 'server-only';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  workoutSessions,
  exerciseLogs,
  sessionFeedback,
  performanceMilestones,
  substitutionEvents,
  notifications,
} from '@/lib/db/schema';
import { newId, sha256 } from '@/lib/auth/ids';
import { NotFoundError } from './equipment';
import { getActivePlan, plannedExercisesToGenerated, type PlanView } from './plans';
import { detectMilestones, type LogRow } from '@/lib/engines/progress';
import { EXERCISE_BY_ID } from '@/lib/content/exercises';
import { addDays, mondayOf } from '@/lib/engines/nutrition';
import type { GeneratedExercise } from '@/lib/engines/workout-generator';

export interface SessionSnapshotExercise extends GeneratedExercise {
  completedSets?: number;
}

/**
 * Materialises the week's sessions from the active plan.
 *
 * Idempotent: an existing session for a date is never recreated or overwritten, so
 * regenerating a plan can never destroy logged history.
 */
export function materialiseWeek(userId: string, weekStart?: string): { created: number; plan: PlanView | null } {
  const plan = getActivePlan(userId);
  if (!plan) return { created: 0, plan: null };
  const monday = weekStart ?? mondayOf(new Date().toISOString().slice(0, 10));
  let created = 0;

  for (const day of plan.days) {
    if (day.isRest || day.exercises.length === 0) continue;
    // plan dayOfWeek: 0=Sun..6=Sat; monday is index 0 of our week.
    const offset = day.dayOfWeek === 0 ? 6 : day.dayOfWeek - 1;
    const date = addDays(monday, offset);
    const existing = db
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.scheduledDate, date),
          eq(workoutSessions.workoutDayId, day.id),
        ),
      )
      .get();
    if (existing) continue;
    db.insert(workoutSessions)
      .values({
        id: newId(),
        userId,
        planId: plan.id,
        workoutDayId: day.id,
        scheduledDate: date,
        label: day.label,
        focus: day.focus,
        status: 'scheduled',
        source: 'planned',
        plannedSnapshot: plannedExercisesToGenerated(day),
      })
      .run();
    created += 1;
  }
  return { created, plan };
}

export interface SessionView {
  id: string;
  scheduledDate: string;
  label: string;
  focus: string;
  status: string;
  source: string;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  notes: string;
  gymProfileId: string | null;
  exercises: SessionSnapshotExercise[];
  logs: {
    id: string;
    exerciseId: string;
    setIndex: number;
    reps: number | null;
    weightGrams: number | null;
    durationSeconds: number | null;
    rpe: number | null;
    skipped: boolean;
    notes: string;
  }[];
  feedback: {
    difficulty: string | null;
    recovery: string | null;
    enjoyment: number | null;
    discomfortReported: boolean;
    discomfortNote: string;
  } | null;
}

export function getSession(userId: string, sessionId: string): SessionView {
  const row = db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That workout does not exist.');
  const logs = db
    .select()
    .from(exerciseLogs)
    .where(eq(exerciseLogs.sessionId, sessionId))
    .orderBy(exerciseLogs.orderIndex, exerciseLogs.setIndex)
    .all();
  const fb = db.select().from(sessionFeedback).where(eq(sessionFeedback.sessionId, sessionId)).get();
  return {
    id: row.id,
    scheduledDate: row.scheduledDate,
    label: row.label,
    focus: row.focus,
    status: row.status,
    source: row.source,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationSeconds: row.durationSeconds,
    notes: row.notes,
    gymProfileId: row.gymProfileId,
    exercises: (row.plannedSnapshot as SessionSnapshotExercise[]) ?? [],
    logs: logs.map((l) => ({
      id: l.id,
      exerciseId: l.exerciseId,
      setIndex: l.setIndex,
      reps: l.reps,
      weightGrams: l.weightGrams,
      durationSeconds: l.durationSeconds,
      rpe: l.rpe,
      skipped: l.skipped,
      notes: l.notes,
    })),
    feedback: fb
      ? {
          difficulty: fb.difficulty,
          recovery: fb.recovery,
          enjoyment: fb.enjoyment,
          discomfortReported: fb.discomfortReported,
          discomfortNote: fb.discomfortNote,
        }
      : null,
  };
}

export function listSessions(
  userId: string,
  opts: { from?: string; to?: string; status?: string[]; limit?: number } = {},
) {
  const clauses = [eq(workoutSessions.userId, userId)];
  if (opts.from) clauses.push(gte(workoutSessions.scheduledDate, opts.from));
  if (opts.to) clauses.push(lte(workoutSessions.scheduledDate, opts.to));
  if (opts.status?.length) clauses.push(inArray(workoutSessions.status, opts.status as never[]));
  return db
    .select({
      id: workoutSessions.id,
      scheduledDate: workoutSessions.scheduledDate,
      label: workoutSessions.label,
      focus: workoutSessions.focus,
      status: workoutSessions.status,
      source: workoutSessions.source,
      completedAt: workoutSessions.completedAt,
      durationSeconds: workoutSessions.durationSeconds,
      setCount: sql<number>`(select count(*) from exercise_logs el where el.session_id = ${workoutSessions.id} and el.skipped = 0)`,
    })
    .from(workoutSessions)
    .where(and(...clauses))
    .orderBy(desc(workoutSessions.scheduledDate))
    .limit(opts.limit ?? 60)
    .all();
}

export function startSession(userId: string, sessionId: string, gymProfileId?: string): SessionView {
  const session = getSession(userId, sessionId);
  if (session.status === 'completed') return session;
  db.update(workoutSessions)
    .set({
      status: 'in_progress',
      startedAt: session.startedAt ?? new Date().toISOString(),
      gymProfileId: gymProfileId ?? session.gymProfileId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(workoutSessions.id, sessionId))
    .run();
  return getSession(userId, sessionId);
}

export interface LogSetInput {
  exerciseId: string;
  setIndex: number;
  reps?: number | null;
  weightGrams?: number | null;
  durationSeconds?: number | null;
  rpe?: number | null;
  skipped?: boolean;
  notes?: string;
}

/**
 * Upserts a single logged set. The unique index on (session, exercise, set) makes
 * repeated submissions idempotent — a double-tap or a refresh cannot duplicate a set.
 */
export function logSet(userId: string, sessionId: string, input: LogSetInput): void {
  const session = getSession(userId, sessionId);
  if (session.status === 'completed') {
    throw new Error('This workout is already finished. Start a new one to log more work.');
  }
  if (!EXERCISE_BY_ID.has(input.exerciseId)) throw new NotFoundError('Unknown exercise.');
  const orderIndex = session.exercises.findIndex((e) => e.exerciseId === input.exerciseId);
  db.insert(exerciseLogs)
    .values({
      id: newId(),
      sessionId,
      exerciseId: input.exerciseId,
      orderIndex: orderIndex < 0 ? 99 : orderIndex,
      setIndex: input.setIndex,
      reps: input.reps ?? null,
      weightGrams: input.weightGrams ?? null,
      durationSeconds: input.durationSeconds ?? null,
      rpe: input.rpe ?? null,
      skipped: input.skipped ?? false,
      notes: (input.notes ?? '').slice(0, 300),
    })
    .onConflictDoUpdate({
      target: [exerciseLogs.sessionId, exerciseLogs.exerciseId, exerciseLogs.setIndex],
      set: {
        reps: input.reps ?? null,
        weightGrams: input.weightGrams ?? null,
        durationSeconds: input.durationSeconds ?? null,
        rpe: input.rpe ?? null,
        skipped: input.skipped ?? false,
        notes: (input.notes ?? '').slice(0, 300),
      },
    })
    .run();
  db.update(workoutSessions)
    .set({ status: 'in_progress', updatedAt: new Date().toISOString() })
    .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.status, 'scheduled')))
    .run();
}

export function deleteLoggedSet(userId: string, sessionId: string, exerciseId: string, setIndex: number): void {
  getSession(userId, sessionId);
  db.delete(exerciseLogs)
    .where(
      and(
        eq(exerciseLogs.sessionId, sessionId),
        eq(exerciseLogs.exerciseId, exerciseId),
        eq(exerciseLogs.setIndex, setIndex),
      ),
    )
    .run();
}

export function substituteInSession(
  userId: string,
  sessionId: string,
  fromExerciseId: string,
  toExerciseId: string,
  reason: string,
): SessionView {
  const session = getSession(userId, sessionId);
  const seed = EXERCISE_BY_ID.get(toExerciseId);
  if (!seed) throw new NotFoundError('Unknown exercise.');
  const updated = session.exercises.map((e) =>
    e.exerciseId === fromExerciseId
      ? {
          ...e,
          exerciseId: toExerciseId,
          name: seed.name,
          substitutedFromExerciseId: fromExerciseId,
          rationale: `Swapped during the session. ${reason}`.trim(),
        }
      : e,
  );
  db.transaction((tx) => {
    tx.update(workoutSessions)
      .set({ plannedSnapshot: updated, updatedAt: new Date().toISOString() })
      .where(eq(workoutSessions.id, sessionId))
      .run();
    tx.insert(substitutionEvents)
      .values({
        id: newId(),
        userId,
        sessionId,
        fromExerciseId,
        toExerciseId,
        reason: reason || 'in-session swap',
      })
      .run();
  });
  return getSession(userId, sessionId);
}

export interface CompleteSessionInput {
  durationSeconds?: number;
  notes?: string;
  feedback?: {
    difficulty?: 'too_easy' | 'about_right' | 'hard' | 'too_hard';
    recovery?: 'fresh' | 'ok' | 'tired' | 'very_tired';
    enjoyment?: number;
    discomfortReported?: boolean;
    discomfortNote?: string;
  };
  /** Client-provided key so a retried submit cannot create a second completion. */
  idempotencyKey?: string;
}

export interface CompleteSessionResult {
  session: SessionView;
  milestones: { label: string; kind: string; exerciseId: string }[];
  alreadyCompleted: boolean;
}

export function completeSession(
  userId: string,
  sessionId: string,
  input: CompleteSessionInput = {},
): CompleteSessionResult {
  const session = getSession(userId, sessionId);
  if (session.status === 'completed') {
    return { session, milestones: [], alreadyCompleted: true };
  }

  const completionKey = sha256(`${sessionId}:${input.idempotencyKey ?? 'default'}`);
  const now = new Date().toISOString();

  const newLogs: LogRow[] = session.logs
    .filter((l) => !l.skipped)
    .map((l) => ({
      exerciseId: l.exerciseId,
      setIndex: l.setIndex,
      reps: l.reps,
      weightGrams: l.weightGrams,
      durationSeconds: l.durationSeconds,
      skipped: l.skipped,
      sessionId,
      date: session.scheduledDate,
    }));

  const historyRows = db
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
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.status, 'completed'),
        sql`${exerciseLogs.sessionId} != ${sessionId}`,
      ),
    )
    .all();

  const milestones = detectMilestones(newLogs, historyRows);

  db.transaction((tx) => {
    tx.update(workoutSessions)
      .set({
        status: 'completed',
        completedAt: now,
        durationSeconds:
          input.durationSeconds ??
          (session.startedAt ? Math.round((Date.parse(now) - Date.parse(session.startedAt)) / 1000) : null),
        notes: (input.notes ?? session.notes).slice(0, 1000),
        completionKey,
        updatedAt: now,
      })
      .where(eq(workoutSessions.id, sessionId))
      .run();

    if (input.feedback) {
      tx.insert(sessionFeedback)
        .values({
          id: newId(),
          sessionId,
          difficulty: input.feedback.difficulty ?? null,
          recovery: input.feedback.recovery ?? null,
          enjoyment: input.feedback.enjoyment ?? null,
          discomfortReported: input.feedback.discomfortReported ?? false,
          discomfortNote: (input.feedback.discomfortNote ?? '').slice(0, 500),
        })
        .onConflictDoUpdate({
          target: sessionFeedback.sessionId,
          set: {
            difficulty: input.feedback.difficulty ?? null,
            recovery: input.feedback.recovery ?? null,
            enjoyment: input.feedback.enjoyment ?? null,
            discomfortReported: input.feedback.discomfortReported ?? false,
            discomfortNote: (input.feedback.discomfortNote ?? '').slice(0, 500),
          },
        })
        .run();
    }

    for (const m of milestones) {
      tx.insert(performanceMilestones)
        .values({
          id: newId(),
          userId,
          exerciseId: m.exerciseId,
          kind: m.kind,
          reps: m.reps ?? null,
          weightGrams: m.weightGrams ?? null,
          durationSeconds: m.durationSeconds ?? null,
          volumeGrams: m.volumeGrams ?? null,
          sessionId,
          achievedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }

    if (input.feedback?.discomfortReported) {
      tx.insert(notifications)
        .values({
          id: newId(),
          userId,
          kind: 'discomfort_followup',
          title: 'You reported discomfort',
          body: 'GymOS has eased off your next session. It cannot tell you what caused it — if it continues, please see a qualified professional.',
          href: '/workouts',
        })
        .run();
    }
  });

  return {
    session: getSession(userId, sessionId),
    milestones: milestones.map((m) => ({
      label: milestoneText(m.kind, m.exerciseId, m),
      kind: m.kind,
      exerciseId: m.exerciseId,
    })),
    alreadyCompleted: false,
  };
}

function milestoneText(
  kind: string,
  exerciseId: string,
  m: { reps?: number; weightGrams?: number; durationSeconds?: number },
): string {
  const name = EXERCISE_BY_ID.get(exerciseId)?.name ?? exerciseId;
  switch (kind) {
    case 'first_time':
      return `First ${name} logged`;
    case 'most_reps':
      return `${name}: most reps yet (${m.reps})`;
    case 'heaviest_set':
      return `${name}: heaviest set yet (${((m.weightGrams ?? 0) / 1000).toFixed(1)} kg)`;
    case 'longest_hold':
      return `${name}: longest hold yet (${m.durationSeconds}s)`;
    default:
      return `${name}: most total work in one session`;
  }
}

export function skipSession(userId: string, sessionId: string, reason?: string): void {
  getSession(userId, sessionId);
  db.update(workoutSessions)
    .set({
      status: 'skipped',
      notes: (reason ?? '').slice(0, 300),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(workoutSessions.id, sessionId))
    .run();
}

export function rescheduleSession(userId: string, sessionId: string, newDate: string): void {
  const session = getSession(userId, sessionId);
  if (session.status === 'completed') {
    throw new Error('Completed workouts stay where they are — history is never rewritten.');
  }
  db.update(workoutSessions)
    .set({ scheduledDate: newDate, status: 'scheduled', updatedAt: new Date().toISOString() })
    .where(eq(workoutSessions.id, sessionId))
    .run();
}

export function createAdhocSession(
  userId: string,
  input: { date: string; label: string; focus: string; exercises: GeneratedExercise[]; source?: 'adhoc' | 'adapted'; gymProfileId?: string },
): string {
  const id = newId();
  db.insert(workoutSessions)
    .values({
      id,
      userId,
      scheduledDate: input.date,
      label: input.label,
      focus: input.focus,
      status: 'scheduled',
      source: input.source ?? 'adhoc',
      plannedSnapshot: input.exercises,
      gymProfileId: input.gymProfileId ?? null,
    })
    .run();
  return id;
}

/** Replaces the prescription for a NOT-yet-completed session. History is untouchable. */
export function replaceSessionSnapshot(
  userId: string,
  sessionId: string,
  exercises: GeneratedExercise[],
  opts: { label?: string; source?: 'planned' | 'adhoc' | 'adapted' } = {},
): void {
  const session = getSession(userId, sessionId);
  if (session.status === 'completed') {
    throw new Error('Completed workouts cannot be re-planned.');
  }
  db.update(workoutSessions)
    .set({
      plannedSnapshot: exercises,
      label: opts.label ?? session.label,
      source: opts.source ?? 'adapted',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(workoutSessions.id, sessionId))
    .run();
}

export function todaySession(userId: string, date?: string) {
  const day = date ?? new Date().toISOString().slice(0, 10);
  return db
    .select({
      id: workoutSessions.id,
      label: workoutSessions.label,
      focus: workoutSessions.focus,
      status: workoutSessions.status,
      scheduledDate: workoutSessions.scheduledDate,
    })
    .from(workoutSessions)
    .where(and(eq(workoutSessions.userId, userId), eq(workoutSessions.scheduledDate, day)))
    .get();
}

export function nextSession(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .select({
      id: workoutSessions.id,
      label: workoutSessions.label,
      focus: workoutSessions.focus,
      status: workoutSessions.status,
      scheduledDate: workoutSessions.scheduledDate,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        gte(workoutSessions.scheduledDate, today),
        inArray(workoutSessions.status, ['scheduled', 'in_progress']),
      ),
    )
    .orderBy(workoutSessions.scheduledDate)
    .get();
}

export function missedSessions(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return db
    .select({
      id: workoutSessions.id,
      label: workoutSessions.label,
      scheduledDate: workoutSessions.scheduledDate,
      status: workoutSessions.status,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        sql`${workoutSessions.scheduledDate} < ${today}`,
        eq(workoutSessions.status, 'scheduled'),
      ),
    )
    .orderBy(desc(workoutSessions.scheduledDate))
    .limit(10)
    .all();
}
