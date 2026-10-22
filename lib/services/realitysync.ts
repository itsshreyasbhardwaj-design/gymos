import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { workoutSessions, userProfiles } from '@/lib/db/schema';
import {
  adaptToEquipment,
  adaptToTime,
  adaptUnavailableEquipment,
  adaptAfterDifficulty,
  adaptMissedSession,
  adaptScheduleChange,
  type AdaptationProposal,
  type RescheduleProposal,
  type SessionContext,
} from '@/lib/engines/realitysync';
import { equipmentSetForProfile, activeEquipmentSet, NotFoundError } from './equipment';
import {
  getSession,
  replaceSessionSnapshot,
  rescheduleSession,
  skipSession,
  listSessions,
} from './sessions';
import {
  getPreference,
  recordRevision,
  getActivePlan,
  plannedExercisesToGenerated,
} from './plans';
import { requireEntitlement } from './entitlements';
import { mondayOf, addDays } from '@/lib/engines/nutrition';
import type { Plan } from '@/lib/engines/entitlements';
import type { GeneratedExercise } from '@/lib/engines/workout-generator';

function contextFor(userId: string): SessionContext {
  const row = db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).get();
  if (!row) throw new NotFoundError('Finish onboarding first.');
  return {
    ageBand: row.ageBand,
    experience: row.experience,
    limitations: row.limitations,
    dislikedExerciseIds: getPreference<string[]>(userId, 'disliked_exercises', []),
    favouriteExerciseIds: getPreference<string[]>(userId, 'favourite_exercises', []),
  };
}

export type ProposalKind =
  | 'equipment'
  | 'time'
  | 'unavailable'
  | 'difficulty'
  | 'missed'
  | 'schedule';

/** Builds a proposal. Nothing is written until `applyProposal` is called. */
export function propose(
  userId: string,
  plan: Plan,
  input:
    | { kind: 'equipment'; sessionId: string; gymProfileId: string }
    | { kind: 'time'; sessionId: string; minutes: number }
    | { kind: 'unavailable'; sessionId: string; equipmentTypeId: string }
    | { kind: 'difficulty'; sessionId: string; difficulty?: never }
    | { kind: 'missed'; sessionId: string }
    | { kind: 'schedule'; newDays: number[] },
): AdaptationProposal | RescheduleProposal {
  requireEntitlement(plan, userId, 'realitysync');
  const ctx = contextFor(userId);

  if (input.kind === 'schedule') {
    const row = db
      .select({ trainingDays: userProfiles.trainingDays })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .get();
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = listSessions(userId, { from: today, status: ['scheduled'] }).map((s) => ({
      id: s.id,
      scheduledDate: s.scheduledDate,
      label: s.label,
      status: s.status,
    }));
    return adaptScheduleChange(row?.trainingDays ?? [], input.newDays, upcoming);
  }

  const session = getSession(userId, input.sessionId);
  if (session.status === 'completed') {
    throw new Error('That workout is already finished. RealitySync only changes work you have not done yet.');
  }
  const planned = session.exercises as GeneratedExercise[];

  switch (input.kind) {
    case 'equipment': {
      const set = equipmentSetForProfile(input.gymProfileId);
      const current = activeEquipmentSet(userId);
      return adaptToEquipment(planned, ctx, set, {
        fromProfileName: current.profileName ?? 'current',
        toProfileName: input.gymProfileId,
      });
    }
    case 'time':
      return adaptToTime(planned, input.minutes);
    case 'unavailable': {
      const current = activeEquipmentSet(userId);
      return adaptUnavailableEquipment(planned, ctx, current.set, input.equipmentTypeId);
    }
    case 'difficulty': {
      const fb = session.feedback;
      return adaptAfterDifficulty(planned, ctx, {
        difficulty: (fb?.difficulty ?? undefined) as never,
        recovery: (fb?.recovery ?? undefined) as never,
        discomfortReported: fb?.discomfortReported ?? false,
      });
    }
    case 'missed': {
      const monday = mondayOf(new Date().toISOString().slice(0, 10));
      const weekDates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
      const week = listSessions(userId, { from: monday, to: addDays(monday, 6) }).map((s) => ({
        id: s.id,
        scheduledDate: s.scheduledDate,
        label: s.label,
        status: s.status,
      }));
      const profile = db
        .select({ scheduleFlexibility: userProfiles.scheduleFlexibility })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .get();
      return adaptMissedSession(
        { id: session.id, scheduledDate: session.scheduledDate, label: session.label, status: session.status },
        week,
        {
          availableDates: weekDates,
          today: new Date().toISOString().slice(0, 10),
          flexibility: profile?.scheduleFlexibility ?? 'some',
        },
      );
    }
    default:
      throw new Error('Unknown adaptation');
  }
}

export interface ApplyResult {
  applied: true;
  revisionId: string | null;
  sessionId?: string;
  movedTo?: string | null;
}

/**
 * Applies a proposal. Only future/incomplete sessions are touched, and every
 * application is recorded as a plan revision so it can be reviewed or reverted.
 */
export function applyProposal(
  userId: string,
  plan: Plan,
  proposal: AdaptationProposal | RescheduleProposal,
  input: { sessionId?: string },
): ApplyResult {
  requireEntitlement(plan, userId, 'realitysync');
  const activePlan = getActivePlan(userId);
  let revisionId: string | null = null;

  if ('moves' in proposal) {
    for (const move of proposal.moves) {
      if (move.to) rescheduleSession(userId, move.sessionId, move.to);
      else skipSession(userId, move.sessionId, 'Skipped via RealitySync');
    }
    if (activePlan) {
      revisionId = recordRevision(userId, activePlan.id, {
        reason: proposal.summary,
        trigger: proposal.trigger,
        diff: { moves: proposal.moves, changes: proposal.changes },
        explanation: proposal.explanation,
        status: 'accepted',
      });
    }
    return { applied: true, revisionId, movedTo: proposal.moves[0]?.to ?? null };
  }

  if (!input.sessionId) throw new Error('A session is required to apply this change.');
  const session = getSession(userId, input.sessionId);
  if (session.status === 'completed') {
    throw new Error('Completed workouts are never rewritten.');
  }
  replaceSessionSnapshot(userId, input.sessionId, proposal.exercises, {
    label: `${session.label} (adapted)`,
    source: 'adapted',
  });
  if (activePlan) {
    revisionId = recordRevision(userId, activePlan.id, {
      reason: proposal.summary,
      trigger: proposal.trigger,
      diff: { changes: proposal.changes, exercises: proposal.exercises },
      explanation: proposal.explanation,
      status: 'accepted',
    });
  }
  return { applied: true, revisionId, sessionId: input.sessionId };
}

/** Restores a session's prescription from the plan it came from. */
export function revertSession(userId: string, sessionId: string): void {
  const session = getSession(userId, sessionId);
  if (session.status === 'completed') throw new Error('Completed workouts are never rewritten.');
  const row = db
    .select({ workoutDayId: workoutSessions.workoutDayId })
    .from(workoutSessions)
    .where(eq(workoutSessions.id, sessionId))
    .get();
  if (!row?.workoutDayId) throw new NotFoundError('This session is not linked to a plan day.');
  const plan = getActivePlan(userId);
  const day = plan?.days.find((d) => d.id === row.workoutDayId);
  if (!day) throw new NotFoundError('The original plan day no longer exists.');
  replaceSessionSnapshot(userId, sessionId, plannedExercisesToGenerated(day), {
    label: day.label,
    source: 'planned',
  });
}
