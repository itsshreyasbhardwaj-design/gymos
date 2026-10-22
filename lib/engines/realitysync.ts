import { EXERCISE_BY_ID } from '@/lib/content/exercises';
import type { ExerciseSeed } from '@/lib/content/exercise-types';
import type { Level } from '@/lib/content/exercise-types';
import { checkEquipment, describeMissing, equipmentName } from './equipment';
import { findSubstitutes, describeEquipmentUsed } from './substitution';
import {
  prescribe,
  applyFeedback,
  buildLimitationFilter,
  effectiveLevel,
  restFor,
  type AgeBand,
  type Difficulty,
  type Recovery,
  type Prescription,
  type SlotRole,
} from './programming';
import {
  estimateExerciseSeconds,
  estimateSessionMinutes,
  type GeneratedExercise,
} from './workout-generator';
import { DAY_NAMES } from './workout-templates';

export const REALITYSYNC_VERSION = 'realitysync-1.0.0';

export type AdaptationTrigger =
  | 'equipment_profile_changed'
  | 'equipment_unavailable'
  | 'time_reduced'
  | 'missed_session'
  | 'session_too_hard'
  | 'travel'
  | 'schedule_changed';

export interface AdaptationChange {
  kind: 'substitute' | 'remove' | 'reduce' | 'reschedule' | 'keep' | 'blocked';
  exerciseId?: string;
  exerciseName?: string;
  toExerciseId?: string;
  toExerciseName?: string;
  from?: string;
  to?: string;
  reason: string;
  /** Explicitly confirms the replacement's equipment needs are met. */
  equipmentSatisfied: boolean;
  equipmentUsed?: string;
  alternatives?: { id: string; name: string; reason: string }[];
}

export interface AdaptationProposal {
  trigger: AdaptationTrigger;
  version: string;
  summary: string;
  changes: AdaptationChange[];
  /** What the engine looked at. Shown to the user so adaptation is never a black box. */
  inputsConsidered: string[];
  explanation: string[];
  warnings: string[];
  /** The adapted prescription. Empty for pure rescheduling proposals. */
  exercises: GeneratedExercise[];
  estimatedMinutes: number;
  /** True when the proposal changes nothing. */
  noChangeNeeded: boolean;
}

export interface SessionContext {
  ageBand: AgeBand;
  experience: Level;
  limitations: string[];
  dislikedExerciseIds?: string[];
  favouriteExerciseIds?: string[];
}

function filtersFor(ctx: SessionContext, available: Set<string>) {
  const lim = buildLimitationFilter(ctx.limitations);
  return {
    availableEquipment: available,
    ageBand: ctx.ageBand,
    level: ctx.experience,
    excludedExerciseIds: new Set<string>([
      ...lim.excludedExerciseIds,
      ...(ctx.dislikedExerciseIds ?? []),
    ]),
    excludedPatterns: lim.excludedPatterns,
    limitationNotes: lim.notes,
  };
}

function seedOf(id: string): ExerciseSeed | undefined {
  return EXERCISE_BY_ID.get(id);
}

/* ------------------------------------- Scenario A / F: equipment or location change */

/**
 * Re-maps a planned session onto a different equipment profile, preserving the
 * intended movement patterns wherever a real replacement exists.
 */
export function adaptToEquipment(
  planned: GeneratedExercise[],
  ctx: SessionContext,
  newEquipment: Set<string>,
  opts: { fromProfileName?: string; toProfileName?: string; travel?: boolean } = {},
): AdaptationProposal {
  const f = filtersFor(ctx, newEquipment);
  const level = effectiveLevel(ctx.experience, ctx.ageBand);
  const changes: AdaptationChange[] = [];
  const warnings: string[] = [];
  const out: GeneratedExercise[] = [];
  const used = new Set<string>();

  for (const item of planned) {
    const original = seedOf(item.exerciseId);
    if (!original) {
      warnings.push(`Skipped unknown exercise "${item.exerciseId}".`);
      continue;
    }
    const check = checkEquipment(original, newEquipment);
    const blockedForOtherReason =
      f.excludedExerciseIds.has(original.id) || f.excludedPatterns.has(original.pattern);

    if (check.ok && !blockedForOtherReason) {
      changes.push({
        kind: 'keep',
        exerciseId: original.id,
        exerciseName: original.name,
        reason: `Works with ${describeEquipmentUsed(original, newEquipment)} at the new location.`,
        equipmentSatisfied: true,
        equipmentUsed: describeEquipmentUsed(original, newEquipment),
      });
      out.push(item);
      used.add(original.id);
      continue;
    }

    const result = findSubstitutes(original, f, { limit: 4 });
    const pick = result.options.find((o) => !used.has(o.exercise.id));
    if (!pick) {
      changes.push({
        kind: 'blocked',
        exerciseId: original.id,
        exerciseName: original.name,
        reason:
          result.noMatchReason ??
          `No replacement for ${original.name} is available with the equipment at this location.`,
        equipmentSatisfied: false,
      });
      warnings.push(
        `${original.name} has no equivalent here (needs ${describeMissing(check) || 'a different setup'}). The slot is left out rather than swapped for something that trains something else.`,
      );
      continue;
    }

    const prescription = prescribe({
      exercise: pick.exercise,
      role: item.role,
      level,
      ageBand: ctx.ageBand,
    });
    // Carry over the user's existing dose where the shape matches, so a location change
    // is not quietly used as an excuse to change the training load.
    const carried: Prescription = carryDose(item, prescription, pick.exercise);
    out.push({
      ...carried,
      exerciseId: pick.exercise.id,
      name: pick.exercise.name,
      slotPattern: item.slotPattern,
      role: item.role,
      estimatedSeconds: estimateExerciseSeconds(pick.exercise, carried),
      rationale: `Replaces ${original.name}. ${pick.reason}`,
      substitutedFromExerciseId: original.id,
    });
    used.add(pick.exercise.id);
    changes.push({
      kind: 'substitute',
      exerciseId: original.id,
      exerciseName: original.name,
      toExerciseId: pick.exercise.id,
      toExerciseName: pick.exercise.name,
      reason: `${original.name} needs ${describeMissing(check) || 'equipment not available here'}. ${pick.reason}`,
      equipmentSatisfied: true,
      equipmentUsed: describeEquipmentUsed(pick.exercise, newEquipment),
      alternatives: result.options
        .slice(1)
        .map((o) => ({ id: o.exercise.id, name: o.exercise.name, reason: o.reason })),
    });
    if (!pick.samePattern) {
      warnings.push(
        `${pick.exercise.name} is only a partial match for ${original.name}: different movement pattern, overlapping muscles (${pick.sharedPrimaryMuscles.join(', ')}).`,
      );
    }
  }

  const substituted = changes.filter((c) => c.kind === 'substitute').length;
  const blocked = changes.filter((c) => c.kind === 'blocked').length;
  return {
    trigger: opts.travel ? 'travel' : 'equipment_profile_changed',
    version: REALITYSYNC_VERSION,
    summary:
      substituted === 0 && blocked === 0
        ? 'Your whole session works at the new location — nothing needed changing.'
        : `${substituted} exercise(s) swapped${blocked > 0 ? `, ${blocked} left out with no equivalent` : ''}.`,
    changes,
    inputsConsidered: [
      `Equipment profile: ${opts.fromProfileName ?? 'previous'} → ${opts.toProfileName ?? 'new'}`,
      `${newEquipment.size - 1} item(s) available at the new location`,
      `Experience level: ${level}`,
      `Age band: ${ctx.ageBand}`,
      ctx.limitations.length > 0
        ? `Stated limitations: ${ctx.limitations.join(', ')}`
        : 'No stated limitations',
      'Your original movement patterns, preserved where a real equivalent exists',
    ],
    explanation: [
      'Each planned exercise was checked against the new equipment list.',
      'Anything that still works was kept with the same sets and reps.',
      'Anything that does not was replaced by the closest exercise that trains the same pattern and muscles.',
      ...(blocked > 0
        ? [
            'Where no genuine equivalent exists, the slot was dropped. GymOS does not claim every machine has a bodyweight equal.',
          ]
        : []),
      ...f.limitationNotes,
    ],
    warnings,
    exercises: out,
    estimatedMinutes: estimateSessionMinutes(out),
    noChangeNeeded: substituted === 0 && blocked === 0,
  };
}

/** Keeps the person's existing dose when the new exercise is logged the same way. */
function carryDose(
  item: GeneratedExercise,
  fresh: Prescription,
  replacement: ExerciseSeed,
): Prescription {
  const itemIsTimed = item.durationSeconds != null;
  const replacementIsTimed = replacement.timed === true;
  if (itemIsTimed === replacementIsTimed) {
    return {
      sets: item.sets,
      repsLow: replacementIsTimed ? undefined : item.repsLow,
      repsHigh: replacementIsTimed ? undefined : item.repsHigh,
      durationSeconds: replacementIsTimed ? item.durationSeconds : undefined,
      restSeconds: item.restSeconds,
      intensityNote: fresh.intensityNote,
    };
  }
  return fresh;
}

/* ------------------------------------------- Scenario B: shorter time available */

/**
 * Builds a genuinely shorter session: fewer exercises, same quality of work.
 * It never keeps the same volume and tells the user to go faster.
 */
export function adaptToTime(
  planned: GeneratedExercise[],
  availableMinutes: number,
  opts: { originalMinutes?: number } = {},
): AdaptationProposal {
  const changes: AdaptationChange[] = [];
  const warnings: string[] = [];
  const budget = availableMinutes * 60;
  const overhead = 300 + 180; // warm-up + cool-down
  const kept: GeneratedExercise[] = planned.map((e) => ({ ...e }));
  const removed: GeneratedExercise[] = [];

  const total = () => kept.reduce((s, e) => s + e.estimatedSeconds, 0) + overhead;
  const droppableFirst: SlotRole[] = ['mobility', 'accessory', 'conditioning', 'secondary'];

  for (const role of droppableFirst) {
    while (total() > budget && kept.length > 1) {
      const idx = findLastIndexByRole(kept, role);
      if (idx === -1) break;
      const [gone] = kept.splice(idx, 1);
      if (gone) removed.push(gone);
    }
    if (total() <= budget) break;
  }

  // Then shorten rest, then trim sets, keeping at least two sets of the main work.
  if (total() > budget) {
    for (const e of kept) {
      if (e.restSeconds > 60) {
        const newRest = Math.max(60, e.restSeconds - 30);
        e.estimatedSeconds -= e.sets * (e.restSeconds - newRest);
        e.restSeconds = newRest;
        changes.push({
          kind: 'reduce',
          exerciseId: e.exerciseId,
          exerciseName: e.name,
          from: `${e.restSeconds + 30}s rest`,
          to: `${e.restSeconds}s rest`,
          reason: 'Shorter rest to fit the time you have, without cutting the work itself.',
          equipmentSatisfied: true,
        });
      }
      if (total() <= budget) break;
    }
  }
  let guard = 0;
  while (total() > budget && guard < 20) {
    guard += 1;
    let trimmed = false;
    for (let idx = kept.length - 1; idx >= 0; idx -= 1) {
      const e = kept[idx];
      if (!e) continue;
      const floor = e.role === 'primary' ? 2 : 1;
      if (e.sets > floor) {
        const perSet = e.estimatedSeconds / e.sets;
        changes.push({
          kind: 'reduce',
          exerciseId: e.exerciseId,
          exerciseName: e.name,
          from: `${e.sets} sets`,
          to: `${e.sets - 1} sets`,
          reason: 'One less set so the session fits properly instead of being rushed.',
          equipmentSatisfied: true,
        });
        e.sets -= 1;
        e.estimatedSeconds = Math.round(perSet * e.sets);
        trimmed = true;
        break;
      }
    }
    if (!trimmed) break;
  }

  for (const gone of removed) {
    changes.push({
      kind: 'remove',
      exerciseId: gone.exerciseId,
      exerciseName: gone.name,
      reason: `Left out of today's shorter session (it was a ${gone.role} exercise). Nothing is lost — it stays in your plan for next time.`,
      equipmentSatisfied: true,
    });
  }

  if (total() > budget) {
    warnings.push(
      `Even trimmed down, this session is about ${Math.round(total() / 60)} minutes. Doing just the first exercise or two is a perfectly good session.`,
    );
  }

  return {
    trigger: 'time_reduced',
    version: REALITYSYNC_VERSION,
    summary:
      removed.length === 0 && changes.length === 0
        ? 'Your session already fits the time you have.'
        : `Shortened to about ${estimateSessionMinutes(kept)} minutes: ${removed.length} exercise(s) left out for today.`,
    changes,
    inputsConsidered: [
      `Time available today: ${availableMinutes} minutes`,
      `Originally planned: ${opts.originalMinutes ?? estimateSessionMinutes(planned)} minutes`,
      'Exercise roles (primary work is protected, accessories go first)',
      'Warm-up and cool-down time',
    ],
    explanation: [
      'The main lifts are kept and the accessory work is dropped, so you still train the pattern that matters most today.',
      'Rest periods are shortened only after exercises have already been removed.',
      'This is a shorter session, not the same session done faster.',
    ],
    warnings,
    exercises: kept,
    estimatedMinutes: estimateSessionMinutes(kept),
    noChangeNeeded: removed.length === 0 && changes.length === 0,
  };
}

function findLastIndexByRole(list: GeneratedExercise[], role: SlotRole): number {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === role) return i;
  }
  return -1;
}

/* ------------------------------------------- Scenario D: one item unavailable */

export function adaptUnavailableEquipment(
  planned: GeneratedExercise[],
  ctx: SessionContext,
  available: Set<string>,
  unavailableEquipmentId: string,
): AdaptationProposal {
  const reduced = new Set(available);
  reduced.delete(unavailableEquipmentId);
  const proposal = adaptToEquipment(planned, ctx, reduced, {
    fromProfileName: 'current location',
    toProfileName: `current location without the ${equipmentName(unavailableEquipmentId)}`,
  });
  return {
    ...proposal,
    trigger: 'equipment_unavailable',
    summary:
      proposal.noChangeNeeded
        ? `Nothing in today's session needs the ${equipmentName(unavailableEquipmentId)}.`
        : proposal.summary,
    inputsConsidered: [
      `Equipment reported unavailable: ${equipmentName(unavailableEquipmentId)}`,
      ...proposal.inputsConsidered.slice(1),
    ],
    explanation: [
      `Only the exercises that need the ${equipmentName(unavailableEquipmentId)} were touched.`,
      ...proposal.explanation.slice(1),
      'You can also just skip that exercise — nothing is logged as a failure.',
    ],
  };
}

/* -------------------------------------------- Scenario E: session was too hard */

export function adaptAfterDifficulty(
  planned: GeneratedExercise[],
  ctx: SessionContext,
  feedback: { difficulty?: Difficulty; recovery?: Recovery; discomfortReported?: boolean },
): AdaptationProposal {
  const changes: AdaptationChange[] = [];
  const warnings: string[] = [];
  const out: GeneratedExercise[] = [];
  const f = filtersFor(ctx, new Set());

  for (const item of planned) {
    const result = applyFeedback({
      previous: {
        sets: item.sets,
        repsLow: item.repsLow,
        repsHigh: item.repsHigh,
        durationSeconds: item.durationSeconds,
        restSeconds: item.restSeconds,
        intensityNote: item.intensityNote,
      },
      difficulty: feedback.difficulty,
      recovery: feedback.recovery,
      discomfortReported: feedback.discomfortReported,
      ageBand: ctx.ageBand,
    });
    const next: GeneratedExercise = {
      ...item,
      ...result.next,
      estimatedSeconds: Math.round(
        (item.estimatedSeconds / Math.max(1, item.sets)) * result.next.sets,
      ),
    };
    out.push(next);
    if (result.changed) {
      changes.push({
        kind: 'reduce',
        exerciseId: item.exerciseId,
        exerciseName: item.name,
        from: describeDose(item),
        to: describeDose(next),
        reason: reasonText(result.reason),
        equipmentSatisfied: true,
      });
    }
  }

  if (feedback.discomfortReported) {
    warnings.push(
      'You reported discomfort. GymOS has reduced the volume, but it cannot tell you what caused it. Please do not train through pain, and see a qualified professional if it continues.',
    );
  }
  void f;

  return {
    trigger: 'session_too_hard',
    version: REALITYSYNC_VERSION,
    summary:
      changes.length === 0
        ? 'No change — your plan already matches the feedback you gave.'
        : `Eased off on ${changes.length} exercise(s) for the next session.`,
    changes,
    inputsConsidered: [
      `Reported difficulty: ${feedback.difficulty ?? 'not given'}`,
      `Reported recovery: ${feedback.recovery ?? 'not given'}`,
      `Discomfort reported: ${feedback.discomfortReported ? 'yes' : 'no'}`,
      'Your previous prescription for each exercise',
      `Age band: ${ctx.ageBand}`,
    ],
    explanation: [
      'Volume comes down first: fewer sets and longer rest, before anything else changes.',
      'Nothing is escalated off the back of negative feedback.',
      'GymOS does not try to work out why a session felt hard — it just gives you less of it.',
    ],
    warnings,
    exercises: out,
    estimatedMinutes: estimateSessionMinutes(out),
    noChangeNeeded: changes.length === 0,
  };
}

function describeDose(e: GeneratedExercise): string {
  if (e.durationSeconds) return `${e.sets} x ${e.durationSeconds}s, ${e.restSeconds}s rest`;
  return `${e.sets} x ${e.repsLow ?? '?'}-${e.repsHigh ?? '?'}, ${e.restSeconds}s rest`;
}

function reasonText(reason: string): string {
  switch (reason) {
    case 'discomfort_reported':
      return 'Reduced because you reported discomfort.';
    case 'reported_too_hard':
      return 'Reduced because you reported the session was too hard or that you were very tired.';
    case 'small_rep_increase':
      return 'Small increase because you reported it felt easy and recovery was fine.';
    case 'small_duration_increase':
      return 'Ten extra seconds because you reported it felt easy.';
    case 'single_set_increase':
      return 'One extra set because you reported it felt easy.';
    default:
      return 'No change.';
  }
}

/* --------------------------------------------- Scenario C: missed session */

export interface ScheduledSession {
  id: string;
  scheduledDate: string;
  label: string;
  status: string;
}

export interface RescheduleProposal extends Omit<AdaptationProposal, 'exercises'> {
  moves: { sessionId: string; from: string; to: string | null; label: string }[];
}

/**
 * Handles a missed day. Volume is never doubled and nothing is framed as a debt:
 * the session either slides to the next free day in the week or is simply let go.
 */
export function adaptMissedSession(
  missed: ScheduledSession,
  weekSessions: ScheduledSession[],
  opts: { availableDates: string[]; today: string; flexibility: 'rigid' | 'some' | 'flexible' },
): RescheduleProposal {
  const taken = new Set(weekSessions.map((s) => s.scheduledDate));
  const future = opts.availableDates.filter((d) => d > opts.today && !taken.has(d)).sort();
  const moves: RescheduleProposal['moves'] = [];
  const changes: AdaptationChange[] = [];
  const warnings: string[] = [];

  const target = opts.flexibility === 'rigid' ? undefined : future[0];
  if (target) {
    moves.push({ sessionId: missed.id, from: missed.scheduledDate, to: target, label: missed.label });
    changes.push({
      kind: 'reschedule',
      from: formatDate(missed.scheduledDate),
      to: formatDate(target),
      reason: 'Moved to the next free day this week. Same session, same volume.',
      equipmentSatisfied: true,
    });
  } else {
    moves.push({ sessionId: missed.id, from: missed.scheduledDate, to: null, label: missed.label });
    changes.push({
      kind: 'remove',
      from: formatDate(missed.scheduledDate),
      reason:
        opts.flexibility === 'rigid'
          ? 'You told us your schedule is fixed, so this one is simply skipped.'
          : 'There is no free day left this week, so this one is simply skipped.',
      equipmentSatisfied: true,
    });
    warnings.push('Missing one session changes very little. Nothing is added to the other days.');
  }

  return {
    trigger: 'missed_session',
    version: REALITYSYNC_VERSION,
    summary: target
      ? `Moved ${missed.label} to ${formatDate(target)}.`
      : `Skipped ${missed.label}. The rest of the week is unchanged.`,
    changes,
    moves,
    inputsConsidered: [
      `Missed session: ${missed.label} on ${formatDate(missed.scheduledDate)}`,
      `Other sessions this week: ${weekSessions.length}`,
      `Free days remaining: ${future.length}`,
      `Your stated schedule flexibility: ${opts.flexibility}`,
    ],
    explanation: [
      'The missed session is moved if there is room, otherwise it is dropped.',
      'No session is made longer or harder to "make up" for a missed one.',
      'Your completed history is untouched.',
    ],
    warnings,
    estimatedMinutes: 0,
    noChangeNeeded: false,
  };
}

/* ------------------------------------------ Scenario G: training days changed */

export function adaptScheduleChange(
  currentDays: number[],
  newDays: number[],
  upcoming: ScheduledSession[],
): RescheduleProposal {
  const changes: AdaptationChange[] = [];
  const moves: RescheduleProposal['moves'] = [];
  const sortedNew = [...newDays].sort((a, b) => a - b);

  upcoming.forEach((session, idx) => {
    const date = new Date(`${session.scheduledDate}T00:00:00Z`);
    const currentDow = date.getUTCDay();
    const targetDow = sortedNew[idx % sortedNew.length];
    if (targetDow === undefined || targetDow === currentDow) {
      return;
    }
    const delta = ((targetDow - currentDow + 7) % 7) || 7;
    const moved = new Date(date.getTime() + delta * 86400000);
    const to = moved.toISOString().slice(0, 10);
    moves.push({ sessionId: session.id, from: session.scheduledDate, to, label: session.label });
    changes.push({
      kind: 'reschedule',
      from: `${DAY_NAMES[currentDow]} ${formatDate(session.scheduledDate)}`,
      to: `${DAY_NAMES[targetDow]} ${formatDate(to)}`,
      reason: 'Moved onto one of your new preferred training days.',
      equipmentSatisfied: true,
    });
  });

  return {
    trigger: 'schedule_changed',
    version: REALITYSYNC_VERSION,
    summary:
      moves.length === 0
        ? 'Your upcoming sessions already land on the days you picked.'
        : `${moves.length} upcoming session(s) moved onto your new training days.`,
    changes,
    moves,
    inputsConsidered: [
      `Previous training days: ${currentDays.map((d) => DAY_NAMES[d]).join(', ') || 'none'}`,
      `New training days: ${sortedNew.map((d) => DAY_NAMES[d]).join(', ')}`,
      `Upcoming scheduled sessions: ${upcoming.length}`,
    ],
    explanation: [
      'Only sessions that have not happened yet are moved.',
      'Completed sessions and their logs stay exactly where they are.',
    ],
    warnings: [],
    estimatedMinutes: 0,
    noChangeNeeded: moves.length === 0,
  };
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

export { restFor };
