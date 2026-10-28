'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import {
  createCommunicationGoal,
  setGoalActive,
  deleteCommunicationGoal,
  savePracticeSession,
  deletePracticeSession,
  attachRecording,
  deleteRecording,
  addFeedback,
  deleteFeedback,
  purgeAudioDerivedMetrics,
  voiceCapability,
  type PracticeMeasurements,
  type VoicePracticeKind,
} from '@/lib/services/voice';
import { VOICE_SCRIPT_BY_ID } from '@/lib/content/voice-scripts';
import { VOICE_PRACTICE_KINDS } from '@/lib/db/schema';
import { MediaPolicyError } from '@/lib/services/media';

export interface ActionState {
  error?: string;
  success?: string;
  /** Set when the practice itself saved but the audio did not. */
  warning?: string;
}

/** Wraps an action so a thrown service error becomes a readable message. */
async function run(fn: () => void | Promise<void>, success: string): Promise<ActionState> {
  try {
    await fn();
    return { success };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

function revalidateVoice(): void {
  revalidatePath('/voice');
  revalidatePath('/voice/practice');
  revalidatePath('/voice/history');
}

/* -------------------------------------------------------------------- goals */

export async function createGoalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => {
    createCommunicationGoal(user.id, String(formData.get('label') ?? ''));
  }, 'Goal added.');
  revalidateVoice();
  return result;
}

export async function setGoalActiveAction(goalId: string, active: boolean): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => setGoalActive(user.id, goalId, active),
    active ? 'Goal reopened.' : 'Goal archived.',
  );
  revalidateVoice();
  return result;
}

export async function deleteGoalAction(goalId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteCommunicationGoal(user.id, goalId), 'Goal deleted.');
  revalidateVoice();
  return result;
}

/* ----------------------------------------------------------------- practice */

/**
 * Reads the browser analysis out of the form, or null.
 *
 * Shape only: that the JSON parsed, that `pauses` is an array and that the two
 * numbers are numbers. It deliberately checks no range, because the service decides
 * that — and `sanitiseMeasurements` there accepts the payload whole or rejects it
 * whole. It clamps and repairs nothing, so a value this function waves through
 * unexamined costs the take its pauses and speaking ratio (stored NULL, duration
 * falling back to the practice timer) rather than being quietly corrected into one.
 */
function parseMeasurements(raw: FormDataEntryValue | null): PracticeMeasurements | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<PracticeMeasurements>;
    if (!Array.isArray(candidate.pauses)) return null;
    if (typeof candidate.speakingRatio !== 'number') return null;
    if (typeof candidate.durationSeconds !== 'number') return null;
    return {
      pauses: candidate.pauses,
      speakingRatio: candidate.speakingRatio,
      durationSeconds: candidate.durationSeconds,
    };
  } catch {
    return null;
  }
}

function optionalNumber(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Saves one practice take.
 *
 * Order of business, and it matters:
 *  1. Work out whether this account may hold audio at all.
 *  2. If it may not, drop the audio AND the audio-derived measurements. It would be
 *     incoherent to refuse to store someone's recording and then keep the pause
 *     analysis taken from it.
 *  3. Save the session. Duration is always measured — from the audio when there is
 *     audio, from the practice timer otherwise.
 *  4. Only then try to store the file, and if the media service refuses, drop the
 *     audio-derived analysis as well and say so plainly, instead of pretending the
 *     take was lost or that the audio was kept. Same reason as step 2: an analysis
 *     of audio GymOS does not hold is a description of a recording that does not
 *     exist, and the user has no way to delete it.
 */
export async function savePracticeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const rawKind = String(formData.get('kind') ?? 'free_speaking');
  if (!(VOICE_PRACTICE_KINDS as readonly string[]).includes(rawKind)) {
    return { error: 'Pick a practice kind GymOS knows about.' };
  }
  const kind = rawKind as VoicePracticeKind;

  const scriptId = String(formData.get('scriptId') ?? '').trim() || null;
  if (scriptId && !VOICE_SCRIPT_BY_ID.has(scriptId)) {
    return { error: 'That practice script does not exist.' };
  }
  const goalId = String(formData.get('goalId') ?? '').trim() || null;

  const audio = formData.get('audio');
  const hasAudioFile = audio instanceof File && audio.size > 0;
  const submittedMeasurements = parseMeasurements(formData.get('measurements'));

  const capability = voiceCapability(user.id);
  const allowAudio = capability.canRecord;
  const measurements = allowAudio ? submittedMeasurements : null;
  const droppedAudio = (hasAudioFile || submittedMeasurements !== null) && !allowAudio;

  let sessionId: string;
  /** Whether the service actually accepted the browser analysis, not whether one was sent. */
  let analysisStored: boolean;
  /** The duration the service accepted, which is the only one worth storing again. */
  let storedDurationSeconds: number;
  try {
    const saved = savePracticeSession(user.id, {
      kind,
      scriptId,
      goalId,
      durationSeconds: optionalNumber(formData.get('durationSeconds')) ?? 0,
      measurements,
      readWholeScript: formData.get('readWholeScript') === 'on',
      fillerTally: optionalNumber(formData.get('fillerTally')),
      selfRatedClarity: optionalNumber(formData.get('selfRatedClarity')),
      reflection: String(formData.get('reflection') ?? ''),
    });
    sessionId = saved.sessionId;
    analysisStored = saved.metrics.pauses !== null;
    storedDurationSeconds = saved.metrics.durationSeconds;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'That take could not be saved.' };
  }

  let warning: string | undefined;
  if (droppedAudio) {
    warning =
      `Your practice was saved without audio, and the pause analysis taken from it was discarded too. ${capability.reason ?? ''}`.trim();
  } else if (hasAudioFile && audio instanceof File) {
    const mimeType = String(formData.get('audioMimeType') ?? audio.type ?? '').trim();
    try {
      attachRecording(user.id, user.plan, sessionId, {
        bytes: Buffer.from(await audio.arrayBuffer()),
        mimeType,
        // Not the client's raw number: the one the service accepted for the take.
        durationSeconds: storedDurationSeconds,
        originalFilename: audio.name,
      });
    } catch (err) {
      // No stored audio, so no stored analysis of it. Pauses and speaking ratio go.
      purgeAudioDerivedMetrics(user.id, { sessionId });
      analysisStored = false;
      const because =
        err instanceof MediaPolicyError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'unknown error';
      warning =
        `Your practice was saved, but the audio file was not: ${because} The pause and speaking-ratio analysis taken from that audio was discarded with it; the measured duration, your notes and anything you reported yourself were kept.`.trim();
    }
  }

  revalidateVoice();
  return {
    success: analysisStored
      ? 'Take saved, with the pause and speaking-ratio measurements your browser took from the recording.'
      : 'Take saved. Duration was measured; pauses and speaking ratio were not, so they are stored as unmeasured rather than as zero.',
    warning,
  };
}

export async function deleteSessionAction(sessionId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => deletePracticeSession(user.id, sessionId),
    'Practice session deleted, along with any recording attached to it.',
  );
  revalidateVoice();
  return result;
}

export async function deleteRecordingAction(recordingId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => deleteRecording(user.id, recordingId),
    'Recording deleted. The encrypted file was removed from disk.',
  );
  revalidateVoice();
  return result;
}

/**
 * A self-reported observation the user writes themselves, against one take.
 *
 * Reachable from the "Add your own observation" form on each take in
 * /voice/history. The service refuses a metric name that would turn this into an
 * appearance or voice-quality rating, and stamps it `self_reported` regardless of
 * what the form says, because a person's note about their own take is self-reported
 * by definition.
 */
export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => {
    addFeedback(user.id, String(formData.get('sessionId') ?? ''), {
      metric: String(formData.get('metric') ?? ''),
      value: optionalNumber(formData.get('value')),
      unit: String(formData.get('unit') ?? ''),
      // Anything a person types about their own take is self-reported by definition.
      source: 'self_reported',
      observation: String(formData.get('observation') ?? ''),
    });
  }, 'Note added, recorded as self-reported.');
  revalidateVoice();
  return result;
}

/** Removes one observation. Reachable from the Remove button on your own notes. */
export async function deleteNoteAction(feedbackId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteFeedback(user.id, feedbackId), 'Note removed.');
  revalidateVoice();
  return result;
}

/* --------------------------------------------- void variants for plain <form> use */

export async function createGoalFormAction(formData: FormData): Promise<void> {
  await createGoalAction({}, formData);
}

export async function archiveGoalFormAction(formData: FormData): Promise<void> {
  await setGoalActiveAction(String(formData.get('goalId') ?? ''), formData.get('active') === 'on');
}

export async function deleteGoalFormAction(formData: FormData): Promise<void> {
  await deleteGoalAction(String(formData.get('goalId') ?? ''));
}

export async function deleteSessionFormAction(formData: FormData): Promise<void> {
  await deleteSessionAction(String(formData.get('sessionId') ?? ''));
}

export async function deleteRecordingFormAction(formData: FormData): Promise<void> {
  await deleteRecordingAction(String(formData.get('recordingId') ?? ''));
}

/**
 * A void form action has no state to hand back, so the outcome travels as one of a
 * few fixed codes and /voice/history turns it into a message. Deliberately a code
 * and not the message itself: a note is the user's own words about their own take,
 * and nothing they typed goes into a URL.
 *
 * It matters here more than for the other forms on the page, because the refusal
 * this can report is a safety rule — GymOS will not store a metric that rates
 * appearance, physique or voice quality — and a rule that fails silently looks like
 * a broken button.
 */
export async function addNoteFormAction(formData: FormData): Promise<void> {
  const result = await addNoteAction({}, formData);
  redirect(result.error ? '/voice/history?note=refused' : '/voice/history?note=added');
}

export async function deleteNoteFormAction(formData: FormData): Promise<void> {
  const result = await deleteNoteAction(String(formData.get('feedbackId') ?? ''));
  redirect(result.error ? '/voice/history?note=refused' : '/voice/history?note=removed');
}
