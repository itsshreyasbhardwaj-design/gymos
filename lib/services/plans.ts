import 'server-only';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  workoutPlans,
  workoutDays,
  plannedExercises,
  workoutSessions,
  exerciseLogs,
  planRevisions,
  preferences,
  userProfiles,
  substitutionEvents,
} from '@/lib/db/schema';
import { generatePlan, type GeneratedPlan, type GeneratedExercise } from '@/lib/engines/workout-generator';
import { EXERCISE_BY_ID } from '@/lib/content/exercises';
import { newId } from '@/lib/auth/ids';
import { activeEquipmentSet, equipmentSetForProfile, NotFoundError } from './equipment';
import { mondayOf, addDays } from '@/lib/engines/nutrition';
import type { Level } from '@/lib/content/exercise-types';
import type { AgeBand } from '@/lib/engines/programming';

export interface ProfileForPlanning {
  userId: string;
  ageBand: AgeBand;
  experience: Level;
  interests: string[];
  trainingDays: number[];
  sessionMinutes: number;
  limitations: string[];
  scheduleFlexibility: 'rigid' | 'some' | 'flexible';
}

export function loadPlanningProfile(userId: string): ProfileForPlanning {
  const row = db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).get();
  if (!row) throw new NotFoundError('Finish onboarding first — GymOS needs your basics to plan.');
  return {
    userId,
    ageBand: row.ageBand,
    experience: row.experience,
    interests: row.interests,
    trainingDays: row.trainingDays,
    sessionMinutes: row.sessionMinutes,
    limitations: row.limitations,
    scheduleFlexibility: row.scheduleFlexibility,
  };
}

export function getPreference<T>(userId: string, key: string, fallback: T): T {
  const row = db
    .select({ value: preferences.value })
    .from(preferences)
    .where(and(eq(preferences.userId, userId), eq(preferences.key, key)))
    .get();
  return (row?.value as T) ?? fallback;
}

export function setPreference(
  userId: string,
  key: string,
  value: unknown,
  source: 'user' | 'onboarding' | 'fitbrain' | 'system' = 'user',
): void {
  db.insert(preferences)
    .values({ userId, key, value, source, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: [preferences.userId, preferences.key],
      set: { value, source, updatedAt: new Date().toISOString() },
    })
    .run();
}

/** Exercise ids logged in the last `days` days, used to keep weekly variety. */
export function recentExerciseIds(userId: string, days = 14): string[] {
  const since = addDays(new Date().toISOString().slice(0, 10), -days);
  const rows = db
    .selectDistinct({ exerciseId: exerciseLogs.exerciseId })
    .from(exerciseLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, exerciseLogs.sessionId))
    .where(and(eq(workoutSessions.userId, userId), gte(workoutSessions.scheduledDate, since)))
    .all();
  return rows.map((r) => r.exerciseId);
}

export interface BuildPlanOptions {
  weekStart?: string;
  gymProfileId?: string;
  minutesOverride?: number;
  name?: string;
}

export function buildPlanDraft(userId: string, opts: BuildPlanOptions = {}): GeneratedPlan {
  const profile = loadPlanningProfile(userId);
  const equipment = opts.gymProfileId
    ? { set: equipmentSetForProfile(opts.gymProfileId), profileName: null as string | null }
    : activeEquipmentSet(userId);
  const weekStart = opts.weekStart ?? mondayOf(new Date().toISOString().slice(0, 10));
  return generatePlan({
    profile,
    availableEquipment: equipment.set,
    gymProfileName: equipment.profileName ?? undefined,
    dislikedExerciseIds: getPreference<string[]>(userId, 'disliked_exercises', []),
    favouriteExerciseIds: getPreference<string[]>(userId, 'favourite_exercises', []),
    recentExerciseIds: recentExerciseIds(userId),
    weekStart,
    minutesOverride: opts.minutesOverride,
  });
}

/** Persists a generated plan, deactivating any previous active plan. */
export function savePlan(
  userId: string,
  draft: GeneratedPlan,
  opts: { name?: string; revisionOf?: string } = {},
): string {
  const planId = newId();
  const previous = db
    .select({ id: workoutPlans.id, version: workoutPlans.version })
    .from(workoutPlans)
    .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.isActive, true)))
    .get();

  db.transaction((tx) => {
    if (previous) {
      tx.update(workoutPlans).set({ isActive: false }).where(eq(workoutPlans.id, previous.id)).run();
    }
    tx.insert(workoutPlans)
      .values({
        id: planId,
        userId,
        name: opts.name ?? `Week of ${(draft.inputsSnapshot as { weekStart?: string }).weekStart ?? ''}`.trim(),
        version: (previous?.version ?? 0) + 1,
        isActive: true,
        generatorVersion: draft.generatorVersion,
        splitKind: draft.splitKind,
        inputsSnapshot: draft.inputsSnapshot,
        explanation: draft.explanation,
        revisionOf: opts.revisionOf ?? previous?.id ?? null,
      })
      .run();

    for (const [dayIdx, day] of draft.days.entries()) {
      const dayId = newId();
      tx.insert(workoutDays)
        .values({
          id: dayId,
          planId,
          dayOfWeek: day.dayOfWeek,
          label: day.label,
          focus: day.focus,
          targetMinutes: day.targetMinutes,
          isRest: day.isRest,
          orderIndex: dayIdx,
        })
        .run();
      for (const [exIdx, ex] of day.exercises.entries()) {
        tx.insert(plannedExercises)
          .values({
            id: newId(),
            workoutDayId: dayId,
            exerciseId: ex.exerciseId,
            orderIndex: exIdx,
            slotPattern: ex.slotPattern,
            sets: ex.sets,
            repsLow: ex.repsLow ?? null,
            repsHigh: ex.repsHigh ?? null,
            durationSeconds: ex.durationSeconds ?? null,
            restSeconds: ex.restSeconds,
            intensityNote: ex.intensityNote,
            rationale: ex.rationale,
            substitutedFromExerciseId: ex.substitutedFromExerciseId ?? null,
          })
          .run();
      }
    }
  });
  return planId;
}

export interface PlanDayView {
  id: string;
  dayOfWeek: number;
  label: string;
  focus: string;
  targetMinutes: number;
  isRest: boolean;
  exercises: {
    id: string;
    exerciseId: string;
    name: string;
    slotPattern: string;
    role: string;
    sets: number;
    repsLow: number | null;
    repsHigh: number | null;
    durationSeconds: number | null;
    restSeconds: number;
    intensityNote: string;
    rationale: string;
    substitutedFromExerciseId: string | null;
  }[];
}

export interface PlanView {
  id: string;
  name: string;
  version: number;
  splitKind: string;
  generatorVersion: string;
  explanation: string[];
  createdAt: string;
  days: PlanDayView[];
}

export function getActivePlan(userId: string): PlanView | null {
  const plan = db
    .select()
    .from(workoutPlans)
    .where(and(eq(workoutPlans.userId, userId), eq(workoutPlans.isActive, true)))
    .get();
  if (!plan) return null;
  return hydratePlan(plan);
}

export function getPlan(userId: string, planId: string): PlanView {
  const plan = db
    .select()
    .from(workoutPlans)
    .where(and(eq(workoutPlans.id, planId), eq(workoutPlans.userId, userId)))
    .get();
  if (!plan) throw new NotFoundError('That plan does not exist.');
  return hydratePlan(plan);
}

function hydratePlan(plan: typeof workoutPlans.$inferSelect): PlanView {
  const days = db
    .select()
    .from(workoutDays)
    .where(eq(workoutDays.planId, plan.id))
    .orderBy(workoutDays.dayOfWeek)
    .all();
  const dayIds = days.map((d) => d.id);
  const exercises = dayIds.length
    ? db
        .select()
        .from(plannedExercises)
        .where(inArray(plannedExercises.workoutDayId, dayIds))
        .orderBy(plannedExercises.orderIndex)
        .all()
    : [];
  return {
    id: plan.id,
    name: plan.name,
    version: plan.version,
    splitKind: plan.splitKind,
    generatorVersion: plan.generatorVersion,
    explanation: plan.explanation,
    createdAt: plan.createdAt,
    days: days.map((d) => ({
      id: d.id,
      dayOfWeek: d.dayOfWeek,
      label: d.label,
      focus: d.focus,
      targetMinutes: d.targetMinutes,
      isRest: d.isRest,
      exercises: exercises
        .filter((e) => e.workoutDayId === d.id)
        .map((e) => ({
          id: e.id,
          exerciseId: e.exerciseId,
          name: EXERCISE_BY_ID.get(e.exerciseId)?.name ?? e.exerciseId,
          slotPattern: e.slotPattern,
          role: roleFromRest(e.restSeconds),
          sets: e.sets,
          repsLow: e.repsLow,
          repsHigh: e.repsHigh,
          durationSeconds: e.durationSeconds,
          restSeconds: e.restSeconds,
          intensityNote: e.intensityNote,
          rationale: e.rationale,
          substitutedFromExerciseId: e.substitutedFromExerciseId,
        })),
    })),
  };
}

/** Rest length is a reliable proxy for the slot role once persisted. */
function roleFromRest(restSeconds: number): string {
  if (restSeconds >= 110) return 'primary';
  if (restSeconds >= 70) return 'secondary';
  if (restSeconds === 0) return 'conditioning';
  if (restSeconds <= 20) return 'mobility';
  return 'accessory';
}

export function plannedExercisesToGenerated(day: PlanDayView): GeneratedExercise[] {
  return day.exercises.map((e) => {
    const seed = EXERCISE_BY_ID.get(e.exerciseId);
    const prescription = {
      sets: e.sets,
      repsLow: e.repsLow ?? undefined,
      repsHigh: e.repsHigh ?? undefined,
      durationSeconds: e.durationSeconds ?? undefined,
      restSeconds: e.restSeconds,
      intensityNote: e.intensityNote,
    };
    const sides = seed?.unilateral ? 2 : 1;
    const midReps =
      e.repsLow && e.repsHigh ? (e.repsLow + e.repsHigh) / 2 : (e.repsHigh ?? e.repsLow ?? 10);
    const workPerSet = e.durationSeconds ?? Math.round(midReps * 3.5 * (seed?.tempo ?? 1));
    return {
      ...prescription,
      exerciseId: e.exerciseId,
      name: e.name,
      slotPattern: e.slotPattern as GeneratedExercise['slotPattern'],
      role: e.role as GeneratedExercise['role'],
      rationale: e.rationale,
      estimatedSeconds: e.sets * (workPerSet * sides + e.restSeconds),
      substitutedFromExerciseId: e.substitutedFromExerciseId ?? undefined,
    };
  });
}

/* --------------------------------------------------------------- plan editing */

export function replacePlannedExercise(
  userId: string,
  plannedExerciseId: string,
  newExerciseId: string,
  reason: string,
): void {
  const row = ownedPlannedExercise(userId, plannedExerciseId);
  if (!EXERCISE_BY_ID.has(newExerciseId)) throw new NotFoundError('Unknown exercise.');
  db.transaction((tx) => {
    tx.update(plannedExercises)
      .set({
        exerciseId: newExerciseId,
        substitutedFromExerciseId: row.exerciseId,
        rationale: `Swapped by you. ${reason}`.trim(),
      })
      .where(eq(plannedExercises.id, plannedExerciseId))
      .run();
    tx.insert(substitutionEvents)
      .values({
        id: newId(),
        userId,
        fromExerciseId: row.exerciseId,
        toExerciseId: newExerciseId,
        reason: reason || 'manual swap',
      })
      .run();
  });
}

export function removePlannedExercise(userId: string, plannedExerciseId: string): void {
  ownedPlannedExercise(userId, plannedExerciseId);
  db.delete(plannedExercises).where(eq(plannedExercises.id, plannedExerciseId)).run();
}

export function addPlannedExercise(
  userId: string,
  workoutDayId: string,
  exerciseId: string,
  prescription: {
    sets: number;
    repsLow?: number | null;
    repsHigh?: number | null;
    durationSeconds?: number | null;
    restSeconds: number;
  },
): void {
  const day = ownedWorkoutDay(userId, workoutDayId);
  const seed = EXERCISE_BY_ID.get(exerciseId);
  if (!seed) throw new NotFoundError('Unknown exercise.');
  const existing = db
    .select({ c: sql<number>`count(*)` })
    .from(plannedExercises)
    .where(eq(plannedExercises.workoutDayId, day.id))
    .all();
  db.insert(plannedExercises)
    .values({
      id: newId(),
      workoutDayId: day.id,
      exerciseId,
      orderIndex: existing[0]?.c ?? 0,
      slotPattern: seed.pattern,
      sets: prescription.sets,
      repsLow: prescription.repsLow ?? null,
      repsHigh: prescription.repsHigh ?? null,
      durationSeconds: prescription.durationSeconds ?? null,
      restSeconds: prescription.restSeconds,
      intensityNote: '',
      rationale: 'Added by you.',
    })
    .run();
}

export function updatePlannedExerciseDose(
  userId: string,
  plannedExerciseId: string,
  dose: { sets?: number; repsLow?: number | null; repsHigh?: number | null; durationSeconds?: number | null; restSeconds?: number },
): void {
  ownedPlannedExercise(userId, plannedExerciseId);
  db.update(plannedExercises)
    .set({
      sets: dose.sets,
      repsLow: dose.repsLow,
      repsHigh: dose.repsHigh,
      durationSeconds: dose.durationSeconds,
      restSeconds: dose.restSeconds,
    })
    .where(eq(plannedExercises.id, plannedExerciseId))
    .run();
}

function ownedPlannedExercise(userId: string, plannedExerciseId: string) {
  const row = db
    .select({
      id: plannedExercises.id,
      exerciseId: plannedExercises.exerciseId,
      workoutDayId: plannedExercises.workoutDayId,
    })
    .from(plannedExercises)
    .innerJoin(workoutDays, eq(workoutDays.id, plannedExercises.workoutDayId))
    .innerJoin(workoutPlans, eq(workoutPlans.id, workoutDays.planId))
    .where(and(eq(plannedExercises.id, plannedExerciseId), eq(workoutPlans.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That exercise is not part of one of your plans.');
  return row;
}

export function ownedWorkoutDay(userId: string, workoutDayId: string) {
  const row = db
    .select({
      id: workoutDays.id,
      planId: workoutDays.planId,
      dayOfWeek: workoutDays.dayOfWeek,
      label: workoutDays.label,
      focus: workoutDays.focus,
      targetMinutes: workoutDays.targetMinutes,
      isRest: workoutDays.isRest,
    })
    .from(workoutDays)
    .innerJoin(workoutPlans, eq(workoutPlans.id, workoutDays.planId))
    .where(and(eq(workoutDays.id, workoutDayId), eq(workoutPlans.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That workout day is not part of one of your plans.');
  return row;
}

/* ------------------------------------------------------------ plan revisions */

export function recordRevision(
  userId: string,
  planId: string,
  input: { reason: string; trigger: string; diff: unknown; explanation: string[]; status?: 'proposed' | 'accepted' },
): string {
  const id = newId();
  db.insert(planRevisions)
    .values({
      id,
      planId,
      userId,
      reason: input.reason,
      trigger: input.trigger,
      diff: input.diff,
      explanation: input.explanation,
      status: input.status ?? 'proposed',
      appliedAt: input.status === 'accepted' ? new Date().toISOString() : null,
    })
    .run();
  return id;
}

export function listRevisions(userId: string, planId?: string) {
  const where = planId
    ? and(eq(planRevisions.userId, userId), eq(planRevisions.planId, planId))
    : eq(planRevisions.userId, userId);
  return db.select().from(planRevisions).where(where).orderBy(desc(planRevisions.createdAt)).limit(50).all();
}

export function setRevisionStatus(
  userId: string,
  revisionId: string,
  status: 'accepted' | 'rejected' | 'reverted',
): void {
  const row = db
    .select({ id: planRevisions.id })
    .from(planRevisions)
    .where(and(eq(planRevisions.id, revisionId), eq(planRevisions.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That plan revision does not exist.');
  db.update(planRevisions)
    .set({ status, appliedAt: status === 'accepted' ? new Date().toISOString() : null })
    .where(eq(planRevisions.id, revisionId))
    .run();
}

export function listPlanHistory(userId: string) {
  return db
    .select({
      id: workoutPlans.id,
      name: workoutPlans.name,
      version: workoutPlans.version,
      isActive: workoutPlans.isActive,
      splitKind: workoutPlans.splitKind,
      createdAt: workoutPlans.createdAt,
    })
    .from(workoutPlans)
    .where(eq(workoutPlans.userId, userId))
    .orderBy(desc(workoutPlans.createdAt))
    .limit(30)
    .all();
}
