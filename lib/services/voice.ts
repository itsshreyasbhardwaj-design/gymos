import 'server-only';
import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  communicationGoals,
  voicePracticeSessions,
  voiceRecordings,
  communicationFeedback,
  privateMediaAssets,
  userProfiles,
  consents,
  VOICE_PRACTICE_KINDS,
} from '@/lib/db/schema';
import { newId } from '@/lib/auth/ids';
import {
  AUDIO_DERIVED_FEEDBACK_METRICS,
  ENGINE_FEEDBACK_METRICS,
  FRAME_MS,
  buildFeedbackEntries,
  computeVoiceMetrics,
  wordsPerMinute as computeWpm,
  type FeedbackSource,
  type Pause,
  type VoiceMetricsResult,
} from '@/lib/engines/voice-metrics';
import { VOICE_SCRIPT_BY_ID } from '@/lib/content/voice-scripts';
import { NotFoundError } from './equipment';
import { ValidationError } from './errors';
import { storeMedia, deleteMedia, MediaPolicyError } from './media';
import type { Plan } from '@/lib/engines/entitlements';

/**
 * Voice & Communication OS.
 *
 * The honesty contract this module exists to keep: there is no speech-recognition
 * model in GymOS, so nothing is transcribed and no transcript is stored, derived or
 * implied. Every stored number is either measured (from the recorded audio, the
 * practice timer, or a script of known length) or self-reported by the user, and
 * `communication_feedback.source` records which — set here from where the number
 * came from, never passed through from a caller's say-so.
 *
 * Recordings are optional throughout. A session with no audio is a first-class
 * session: it keeps its measured duration, its script and the user's own notes, and
 * simply leaves the audio-derived columns null. That is what keeps the feature
 * working for under-18 accounts and for anyone who leaves voice consent off.
 *
 * WHERE THE AUDIO-DERIVED NUMBERS COME FROM, AND WHAT THAT COSTS
 *
 * Pause count, longest pause, speaking ratio and the audio duration are measured by
 * real DSP over real samples — `analyseAudioEnergy` in lib/engines/voice-metrics.ts,
 * running in the user's own browser on the buffer decoded from their recording.
 * GymOS has no server-side audio decoder, so the server cannot reproduce or verify
 * those numbers. That is a genuine limitation and it is stated here rather than
 * papered over, because it decides what the server is allowed to do with them:
 *
 *  - It accepts an analysis only when every field is inside the range
 *    `analyseAudioEnergy` can actually produce (`sanitiseMeasurements`).
 *  - It never substitutes a value for a missing or impossible one. A field that was
 *    not measured is stored as NULL, never as 0, and the UI prints a dash.
 *  - Nothing is labelled `source: 'measured'` unless an accepted analysis produced
 *    it, and every such observation says the analysis ran in the browser.
 *
 * And because the analysis is derived from the audio, it does not outlive the audio:
 * `purgeAudioDerivedMetrics` clears those columns, and the feedback rows that quote
 * them, for any session whose recording is gone.
 */

export type VoicePracticeKind = (typeof VOICE_PRACTICE_KINDS)[number];

const MAX_DURATION_SECONDS = 2 * 60 * 60;
/** The top of the range the filler counter can report. Above it, nothing was counted. */
const MAX_FILLER_TALLY = 2000;
/** More pauses than this in one take is not an analysis of speech. */
const MAX_PAUSES = 5000;

/**
 * Metric names that may never become a stored dimension.
 *
 * GymOS does not rate voices or appearances, so there is no column, chart or series
 * for it — and the free-text metric field is the one place a well-meaning caller
 * could smuggle one in. Rejected outright rather than stored and hidden later.
 * Deliberately applies to the metric NAME only: a user's own written reflection is
 * their own words and is not policed.
 */
const FORBIDDEN_METRIC_PATTERN =
  /attract|beaut|handsome|pretty|\blooks\b|looksmax|sexy|appearance|physique|body[\s_-]*fat|facial|face[\s_-]*shape|timbre|voice[\s_-]*quality|pleasant|\bscore\b|\bgrade\b|masculin|feminin|accent[\s_-]*correct/i;

/**
 * One metric name, reduced to the form two names are compared in.
 *
 * `finishPracticeSession` writes `words_per_minute`; the history page prints it as
 * "words per minute". Both spellings name the same row, so both have to collide with
 * the engine's name — otherwise a note called "words per minute" sits next to the
 * engine's row looking identical to it.
 */
function normaliseMetricName(metric: string): string {
  return metric
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Metric names the metrics engine writes itself, so a user's note may not take one.
 *
 * `finishPracticeSession` deletes and rewrites every engine row from the measurements
 * each time a take is saved, and /voice/history offers a Remove button only on rows
 * whose metric is NOT one of these — that is how it tells a note from a measurement.
 * A note that borrowed one of these names would therefore be silently overwritten by
 * the next save and, until then, have no Remove button: a row the user owns and
 * cannot reach. Refused at the point of entry instead, which is also what makes the
 * page's name comparison exhaustive rather than a guess.
 */
const RESERVED_METRIC_NAMES = new Set<string>(ENGINE_FEEDBACK_METRICS.map(normaliseMetricName));

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A self-reported number, or null when what arrived is not one.
 *
 * THE RULE, and it is the same rule for every self-reported field: the stored value
 * is either what the user actually reported, or nothing at all. A value outside the
 * range its control can produce did not come from that control, so it was not
 * reported — and `null` is how this module says "not reported".
 *
 * So no clamping, for the same reason `sanitiseMeasurements` does not clamp. A filler
 * tally of -5 pulled up to 0 is stored as a self-reported 0 and shown to the user as
 * "0 — you tapped this during playback", which they did not; a clarity of 99 pushed
 * down to 5 is stored as the user rating their own take top marks, which they did
 * not. Both are inventions, and the one thing this module promises is that a number
 * on the page is either measured or something the user really said.
 *
 * The rounding only tidies a float into the integer the control emits. It never moves
 * a value into range: the range is checked first, on the number as it arrived.
 */
function selfReported(raw: number | null | undefined, min: number, max: number): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < min || raw > max) return null;
  return Math.round(raw);
}

/* --------------------------------------------------------------- capability */

export interface VoiceCapability {
  ageBand: 'under_13' | 'teen_13_17' | 'adult_18_plus' | null;
  ageEligible: boolean;
  consentGranted: boolean;
  canRecord: boolean;
  /** Honest explanation to show the user. Null when recording is available. */
  reason: string | null;
}

/**
 * Whether this account can attach audio, and why not when it cannot.
 *
 * Advisory only — the media service is the enforcement point. This exists so a page
 * can explain the situation instead of rendering a recorder that will throw, and so
 * the explanation is the same one the service would give.
 */
export function voiceCapability(userId: string): VoiceCapability {
  const profile = db
    .select({ ageBand: userProfiles.ageBand })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .get();
  const consent = db
    .select({ granted: consents.granted })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.kind, 'voice_recording')))
    .get();

  const ageBand = profile?.ageBand ?? null;
  const ageEligible = ageBand === 'adult_18_plus';
  const consentGranted = Boolean(consent?.granted);

  let reason: string | null = null;
  if (!ageEligible) {
    reason =
      "Saving a recording is only available on 18+ accounts, because GymOS has no verified parental-consent mechanism for storing a minor's voice. Timed practice, scripts, your own notes and the whole history are still yours — only the audio file is withheld.";
  } else if (!consentGranted) {
    reason =
      'Turn on voice recording in Settings → Media privacy to save audio. Until then, practice runs on the timer: duration is measured, and pauses and speaking ratio are not, because there is no audio to measure.';
  }

  return { ageBand, ageEligible, consentGranted, canRecord: ageEligible && consentGranted, reason };
}

/* -------------------------------------------------------------------- goals */

export function listCommunicationGoals(userId: string, opts: { includeInactive?: boolean } = {}) {
  const clauses = [eq(communicationGoals.userId, userId)];
  if (!opts.includeInactive) clauses.push(eq(communicationGoals.active, true));
  return db
    .select()
    .from(communicationGoals)
    .where(and(...clauses))
    .orderBy(desc(communicationGoals.createdAt))
    .all();
}

export function createCommunicationGoal(userId: string, label: string): string {
  const trimmed = label.trim();
  if (trimmed.length < 3) {
    throw new ValidationError('Give the goal a label of at least three characters.', 'label');
  }
  const id = newId();
  db.insert(communicationGoals)
    .values({ id, userId, label: trimmed.slice(0, 160), active: true })
    .run();
  return id;
}

export function setGoalActive(userId: string, goalId: string, active: boolean): void {
  const goal = db
    .select({ id: communicationGoals.id })
    .from(communicationGoals)
    .where(and(eq(communicationGoals.id, goalId), eq(communicationGoals.userId, userId)))
    .get();
  if (!goal) throw new NotFoundError('That communication goal does not exist.');
  db.update(communicationGoals)
    .set({ active })
    .where(and(eq(communicationGoals.id, goalId), eq(communicationGoals.userId, userId)))
    .run();
}

export function deleteCommunicationGoal(userId: string, goalId: string): void {
  const goal = db
    .select({ id: communicationGoals.id })
    .from(communicationGoals)
    .where(and(eq(communicationGoals.id, goalId), eq(communicationGoals.userId, userId)))
    .get();
  if (!goal) throw new NotFoundError('That communication goal does not exist.');
  db.delete(communicationGoals)
    .where(and(eq(communicationGoals.id, goalId), eq(communicationGoals.userId, userId)))
    .run();
}

/* ------------------------------------------------------------------ sessions */

export interface StartPracticeInput {
  kind: VoicePracticeKind;
  scriptId?: string | null;
  goalId?: string | null;
  date?: string;
}

/** Ownership of the referenced goal is checked in SQL before it is stored. */
function resolveGoalId(userId: string, goalId: string | null | undefined): string | null {
  if (!goalId) return null;
  const goal = db
    .select({ id: communicationGoals.id })
    .from(communicationGoals)
    .where(and(eq(communicationGoals.id, goalId), eq(communicationGoals.userId, userId)))
    .get();
  if (!goal) throw new NotFoundError('That communication goal does not exist.');
  return goal.id;
}

export function startPracticeSession(userId: string, input: StartPracticeInput): string {
  if (!(VOICE_PRACTICE_KINDS as readonly string[]).includes(input.kind)) {
    throw new ValidationError('Pick a practice kind GymOS knows about.', 'kind');
  }
  const script = input.scriptId ? VOICE_SCRIPT_BY_ID.get(input.scriptId) : undefined;
  if (input.scriptId && !script) throw new NotFoundError('That practice script does not exist.');

  const id = newId();
  db.insert(voicePracticeSessions)
    .values({
      id,
      userId,
      kind: input.kind,
      scriptId: script?.id ?? null,
      goalId: resolveGoalId(userId, input.goalId),
      date: input.date ?? nowDate(),
      durationSeconds: 0,
    })
    .run();
  return id;
}

export interface PracticeMeasurements {
  /**
   * One `analyseAudioEnergy` result, measured in the user's browser from the samples
   * decoded out of their recording. The server cannot re-derive any of it, so it is
   * taken as a whole or not at all — see `sanitiseMeasurements`.
   */
  pauses: Pause[];
  speakingRatio: number;
  durationSeconds: number;
}

export interface FinishPracticeInput {
  /** Measured by the practice timer. Always send it: it is the fallback duration. */
  durationSeconds: number;
  /** Present only when a recording was actually analysed in the browser. */
  measurements?: PracticeMeasurements | null;
  /**
   * Whether the whole script was read. Words per minute needs this: a known word
   * count only tells you the rate if all of those words were spoken, and with no
   * transcription GymOS cannot check it. Unconfirmed means wordsPerMinute stays null.
   */
  readWholeScript?: boolean;
  /** Self-reported, tapped during playback. */
  fillerTally?: number | null;
  /** Self-reported 1-5. */
  selfRatedClarity?: number | null;
  reflection?: string;
}

/**
 * Accepts or rejects a browser-side analysis. It is a gate, not a reshaper.
 *
 * The server has no audio decoder, so it cannot recompute any of these numbers. The
 * only honest check available to it is whether the payload is inside the range
 * `analyseAudioEnergy` can actually produce: a duration above zero, a speaking ratio
 * that is a fraction of one, and pauses that are positive and fit inside the take.
 *
 * Anything else — non-finite, negative, out of range, malformed, or more pauses than
 * a take can hold — means this is not the output of that function over real samples,
 * and the WHOLE payload is rejected. The audio-derived columns then stay null and
 * the duration falls back to the practice timer.
 *
 * Deliberately no clamping and no defaulting. A non-finite ratio turned into 0 would
 * be stored as `source: 'measured'` and shown to the user as "0% speaking, measured
 * from your recording"; a ratio of 42 clamped to 1 would be shown as "100%". Both
 * are inventions. The module's promise is null for anything unmeasured, so an
 * unusable field means an unmeasured field, not a repaired one.
 */
function sanitiseMeasurements(
  raw: PracticeMeasurements | null | undefined,
): PracticeMeasurements | null {
  if (!raw) return null;
  if (!Array.isArray(raw.pauses) || raw.pauses.length > MAX_PAUSES) return null;

  const durationSeconds = raw.durationSeconds;
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > MAX_DURATION_SECONDS
  ) {
    return null;
  }

  const speakingRatio = raw.speakingRatio;
  if (!Number.isFinite(speakingRatio) || speakingRatio < 0 || speakingRatio > 1) return null;

  // A pause has to fall inside the take. One frame of slack, because the engine
  // reports pause edges on FRAME_MS boundaries and both ends get rounded.
  const takeMs = Math.round(durationSeconds * 1000) + FRAME_MS;
  const pauses: Pause[] = [];
  for (const pause of raw.pauses) {
    if (!pause || !Number.isFinite(pause.startMs) || !Number.isFinite(pause.durationMs)) {
      return null;
    }
    if (pause.startMs < 0 || pause.durationMs <= 0) return null;
    if (pause.startMs + pause.durationMs > takeMs) return null;
    pauses.push({ startMs: Math.round(pause.startMs), durationMs: Math.round(pause.durationMs) });
  }

  return { pauses, speakingRatio, durationSeconds };
}

/**
 * Writes the measurements for a session, then the feedback rows that explain them.
 *
 * `wordsPerMinute` is computed here from the script's own word count and the
 * measured duration. It is never accepted from a caller, so a client cannot assert
 * a rate GymOS did not work out, and it is null unless the user confirmed they read
 * the whole script.
 *
 * The audio-derived columns are written only from an analysis that cleared
 * `sanitiseMeasurements`. When no analysis was supplied, or the one supplied was not
 * credible, they are written as NULL and the duration comes from the practice timer.
 */
export function finishPracticeSession(
  userId: string,
  sessionId: string,
  input: FinishPracticeInput,
): VoiceMetricsResult {
  const session = db
    .select()
    .from(voicePracticeSessions)
    .where(and(eq(voicePracticeSessions.id, sessionId), eq(voicePracticeSessions.userId, userId)))
    .get();
  if (!session) throw new NotFoundError('That practice session does not exist.');

  const measurements = sanitiseMeasurements(input.measurements);
  const durationSeconds = measurements
    ? measurements.durationSeconds
    : clamp(
        Number.isFinite(input.durationSeconds) ? Math.round(input.durationSeconds) : 0,
        0,
        MAX_DURATION_SECONDS,
      );
  if (durationSeconds <= 0) {
    throw new ValidationError(
      'A practice take needs a measured duration above zero.',
      'durationSeconds',
    );
  }

  const script = session.scriptId ? VOICE_SCRIPT_BY_ID.get(session.scriptId) : undefined;
  const scriptWordCount =
    input.readWholeScript && script && script.spokenWordCount !== null
      ? script.spokenWordCount
      : null;

  // Out of range means not counted, not nudged into range. See `selfReported`.
  const fillerTally = selfReported(input.fillerTally, 0, MAX_FILLER_TALLY);
  const selfRatedClarity = selfReported(input.selfRatedClarity, 1, 5);

  const metricsInput = {
    durationSeconds,
    scriptWordCount,
    ...(measurements
      ? { pauses: measurements.pauses, speakingRatio: measurements.speakingRatio }
      : {}),
    fillerTally,
    selfRatedClarity,
  };
  const metrics = computeVoiceMetrics(metricsInput);
  const wpm = computeWpm(scriptWordCount, durationSeconds);

  db.transaction((tx) => {
    tx.update(voicePracticeSessions)
      .set({
        durationSeconds: Math.round(durationSeconds),
        scriptWordCount,
        wordsPerMinute: wpm === null ? null : Math.round(wpm),
        pauseCount: metrics.pauses ? metrics.pauses.count : null,
        longestPauseMs: metrics.pauses ? metrics.pauses.longestMs : null,
        speakingRatio: measurements ? measurements.speakingRatio : null,
        fillerTally,
        selfRatedClarity,
        reflection: (input.reflection ?? '').slice(0, 2000),
      })
      .where(and(eq(voicePracticeSessions.id, sessionId), eq(voicePracticeSessions.userId, userId)))
      .run();

    tx.delete(communicationFeedback).where(eq(communicationFeedback.sessionId, sessionId)).run();
    for (const entry of buildFeedbackEntries(metricsInput)) {
      tx.insert(communicationFeedback)
        .values({
          id: newId(),
          sessionId,
          metric: entry.metric,
          value: entry.value,
          unit: entry.unit,
          source: entry.source,
          observation: entry.observation,
        })
        .run();
    }
  });

  return metrics;
}

/** start + finish in one call, for the recorder, which only saves once. */
export function savePracticeSession(
  userId: string,
  input: StartPracticeInput & FinishPracticeInput,
): { sessionId: string; metrics: VoiceMetricsResult } {
  const sessionId = startPracticeSession(userId, input);
  try {
    const metrics = finishPracticeSession(userId, sessionId, input);
    return { sessionId, metrics };
  } catch (err) {
    // Don't leave an empty, duration-zero shell behind if the measurements are rejected.
    db.delete(voicePracticeSessions)
      .where(and(eq(voicePracticeSessions.id, sessionId), eq(voicePracticeSessions.userId, userId)))
      .run();
    throw err;
  }
}

export interface PracticeSessionRow {
  id: string;
  kind: VoicePracticeKind;
  scriptId: string | null;
  scriptTitle: string | null;
  goalId: string | null;
  goalLabel: string | null;
  date: string;
  durationSeconds: number;
  scriptWordCount: number | null;
  wordsPerMinute: number | null;
  pauseCount: number | null;
  longestPauseMs: number | null;
  speakingRatio: number | null;
  fillerTally: number | null;
  selfRatedClarity: number | null;
  reflection: string;
  hasRecording: boolean;
  createdAt: string;
}

export function listPracticeSessions(
  userId: string,
  opts: { limit?: number; kind?: VoicePracticeKind } = {},
): PracticeSessionRow[] {
  const clauses = [eq(voicePracticeSessions.userId, userId)];
  if (opts.kind) clauses.push(eq(voicePracticeSessions.kind, opts.kind));
  const rows = db
    .select({
      session: voicePracticeSessions,
      goalLabel: communicationGoals.label,
    })
    .from(voicePracticeSessions)
    .leftJoin(communicationGoals, eq(communicationGoals.id, voicePracticeSessions.goalId))
    .where(and(...clauses))
    .orderBy(desc(voicePracticeSessions.date), desc(voicePracticeSessions.createdAt))
    .limit(opts.limit ?? 100)
    .all();

  const ids = rows.map((r) => r.session.id);
  const withAudio = new Set<string>();
  if (ids.length > 0) {
    for (const row of db
      .select({ sessionId: voiceRecordings.sessionId })
      .from(voiceRecordings)
      .where(inArray(voiceRecordings.sessionId, ids))
      .all()) {
      withAudio.add(row.sessionId);
    }
  }

  return rows.map(({ session, goalLabel }) => ({
    id: session.id,
    kind: session.kind,
    scriptId: session.scriptId,
    scriptTitle: session.scriptId
      ? (VOICE_SCRIPT_BY_ID.get(session.scriptId)?.title ?? null)
      : null,
    goalId: session.goalId,
    goalLabel: goalLabel ?? null,
    date: session.date,
    durationSeconds: session.durationSeconds,
    scriptWordCount: session.scriptWordCount,
    wordsPerMinute: session.wordsPerMinute,
    pauseCount: session.pauseCount,
    longestPauseMs: session.longestPauseMs,
    speakingRatio: session.speakingRatio,
    fillerTally: session.fillerTally,
    selfRatedClarity: session.selfRatedClarity,
    reflection: session.reflection,
    hasRecording: withAudio.has(session.id),
    createdAt: session.createdAt,
  }));
}

export function getPracticeSession(userId: string, sessionId: string) {
  const session = db
    .select()
    .from(voicePracticeSessions)
    .where(and(eq(voicePracticeSessions.id, sessionId), eq(voicePracticeSessions.userId, userId)))
    .get();
  if (!session) throw new NotFoundError('That practice session does not exist.');

  // Child rows are reachable only through the parent row that was just
  // ownership-checked in SQL, and the ownership predicate is repeated in the join.
  const recordings = db
    .select({
      id: voiceRecordings.id,
      assetId: voiceRecordings.assetId,
      durationSeconds: voiceRecordings.durationSeconds,
      mimeType: privateMediaAssets.mimeType,
      createdAt: voiceRecordings.createdAt,
    })
    .from(voiceRecordings)
    .innerJoin(voicePracticeSessions, eq(voicePracticeSessions.id, voiceRecordings.sessionId))
    .innerJoin(privateMediaAssets, eq(privateMediaAssets.id, voiceRecordings.assetId))
    .where(
      and(
        eq(voiceRecordings.sessionId, sessionId),
        eq(voicePracticeSessions.userId, userId),
        eq(privateMediaAssets.userId, userId),
      ),
    )
    .all();

  const feedback = db
    .select({
      id: communicationFeedback.id,
      metric: communicationFeedback.metric,
      value: communicationFeedback.value,
      unit: communicationFeedback.unit,
      source: communicationFeedback.source,
      observation: communicationFeedback.observation,
      createdAt: communicationFeedback.createdAt,
    })
    .from(communicationFeedback)
    .innerJoin(voicePracticeSessions, eq(voicePracticeSessions.id, communicationFeedback.sessionId))
    .where(
      and(eq(communicationFeedback.sessionId, sessionId), eq(voicePracticeSessions.userId, userId)),
    )
    .orderBy(communicationFeedback.createdAt)
    .all();

  const script = session.scriptId ? (VOICE_SCRIPT_BY_ID.get(session.scriptId) ?? null) : null;
  return { session, script, recordings, feedback };
}

export function deletePracticeSession(userId: string, sessionId: string): void {
  const session = db
    .select({ id: voicePracticeSessions.id })
    .from(voicePracticeSessions)
    .where(and(eq(voicePracticeSessions.id, sessionId), eq(voicePracticeSessions.userId, userId)))
    .get();
  if (!session) throw new NotFoundError('That practice session does not exist.');

  // Delete the encrypted audio for real before dropping the rows that point at it,
  // otherwise the cascade would orphan files on disk.
  for (const recording of db
    .select({ assetId: voiceRecordings.assetId })
    .from(voiceRecordings)
    .where(eq(voiceRecordings.sessionId, sessionId))
    .all()) {
    try {
      deleteMedia(userId, recording.assetId, 'user_request');
    } catch {
      // Already gone, or never ours: the row goes either way.
    }
  }
  db.delete(voicePracticeSessions)
    .where(and(eq(voicePracticeSessions.id, sessionId), eq(voicePracticeSessions.userId, userId)))
    .run();
}

/* --------------------------------------------------------------- recordings */

export interface AttachRecordingInput {
  bytes: Buffer;
  mimeType: string;
  durationSeconds: number;
  originalFilename?: string;
}

/**
 * Attaches audio to a session.
 *
 * The media service is the only gate: it checks the 18+ rule, the voice_recording
 * consent and the storage entitlement, strips what it can, encrypts the bytes and
 * keeps them outside the served tree. Its MediaPolicyError message is surfaced
 * unchanged rather than replaced with a vaguer one, because it is the message that
 * tells the user what to do about it.
 */
export function attachRecording(
  userId: string,
  plan: Plan,
  sessionId: string,
  input: AttachRecordingInput,
): { recordingId: string; assetId: string } {
  const session = db
    .select({ id: voicePracticeSessions.id })
    .from(voicePracticeSessions)
    .where(and(eq(voicePracticeSessions.id, sessionId), eq(voicePracticeSessions.userId, userId)))
    .get();
  if (!session) throw new NotFoundError('That practice session does not exist.');

  const durationSeconds = clamp(
    Number.isFinite(input.durationSeconds) ? Math.round(input.durationSeconds) : 0,
    0,
    MAX_DURATION_SECONDS,
  );

  const stored = storeMedia(userId, plan, {
    kind: 'audio',
    mimeType: input.mimeType,
    bytes: input.bytes,
    originalFilename: input.originalFilename,
    durationSeconds,
    consent: 'voice_recording',
  });

  const recordingId = newId();
  db.insert(voiceRecordings)
    .values({ id: recordingId, sessionId, assetId: stored.id, durationSeconds })
    .run();
  return { recordingId, assetId: stored.id };
}

export function deleteRecording(userId: string, recordingId: string): void {
  const row = db
    .select({
      id: voiceRecordings.id,
      assetId: voiceRecordings.assetId,
      sessionId: voiceRecordings.sessionId,
    })
    .from(voiceRecordings)
    .innerJoin(voicePracticeSessions, eq(voicePracticeSessions.id, voiceRecordings.sessionId))
    .where(and(eq(voiceRecordings.id, recordingId), eq(voicePracticeSessions.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That recording does not exist.');
  deleteMedia(userId, row.assetId, 'user_request');
  db.delete(voiceRecordings).where(eq(voiceRecordings.id, row.id)).run();
  // The analysis was derived from those bytes, so it goes with them.
  purgeAudioDerivedMetrics(userId, { sessionId: row.sessionId });
}

/**
 * Clears the audio-derived analysis for sessions whose recording is gone.
 *
 * Destroying someone's audio and keeping the pause count, longest pause and
 * speaking ratio taken from it is not a deletion — it keeps a derived description of
 * the recording the user asked to be rid of. So this nulls those three columns and
 * deletes the `communication_feedback` rows that quote them, for every session of
 * this user that no longer has a recording row.
 *
 * What it deliberately leaves alone: the session itself, its measured duration (the
 * practice timer measures that too, and it is the record that the practice happened),
 * its script, the user's own reflection, and everything self-reported. Only the
 * numbers that could only have come from the audio go.
 *
 * AND WHAT IT IS NOT: it is not "no recording, therefore no audio-derived numbers".
 * Computing those numbers required audio; keeping the audio FILE is a separate
 * choice, and a user who measured a take and chose not to store its audio keeps the
 * measurement — it is their own record of their own practice, and nothing about it is
 * less true for the file being absent. So this function is only ever called when the
 * user asks for the audio material itself to go, never merely because a session has
 * no recording row. The guard for that is this function's own precondition: it fires
 * only against sessions whose recording is already gone, and only from a path that
 * just destroyed one.
 *
 * The paths that destroy audio, all of which call it:
 *  - `deleteRecording` (and `deletePracticeSession`, which removes the whole take);
 *  - withdrawing `voice_recording` consent — `setConsent` in lib/services/account.ts
 *    calls `purgeAudioDerivedMetrics(userId)` after `deleteMediaForConsent`.
 *
 * Returns the number of sessions it changed, so a caller can log or assert it.
 */
export function purgeAudioDerivedMetrics(
  userId: string,
  opts: { sessionId?: string } = {},
): number {
  const clauses = [
    eq(voicePracticeSessions.userId, userId),
    isNull(voiceRecordings.id),
    or(
      isNotNull(voicePracticeSessions.pauseCount),
      isNotNull(voicePracticeSessions.longestPauseMs),
      isNotNull(voicePracticeSessions.speakingRatio),
    ),
  ];
  if (opts.sessionId) clauses.push(eq(voicePracticeSessions.id, opts.sessionId));

  const stale = db
    .select({ id: voicePracticeSessions.id })
    .from(voicePracticeSessions)
    .leftJoin(voiceRecordings, eq(voiceRecordings.sessionId, voicePracticeSessions.id))
    .where(and(...clauses))
    .all()
    .map((row) => row.id);
  if (stale.length === 0) return 0;

  db.transaction((tx) => {
    tx.update(voicePracticeSessions)
      .set({ pauseCount: null, longestPauseMs: null, speakingRatio: null })
      // The ownership predicate is repeated here, not inherited from the read above.
      .where(
        and(eq(voicePracticeSessions.userId, userId), inArray(voicePracticeSessions.id, stale)),
      )
      .run();
    tx.delete(communicationFeedback)
      .where(
        and(
          inArray(communicationFeedback.sessionId, stale),
          inArray(communicationFeedback.metric, [...AUDIO_DERIVED_FEEDBACK_METRICS]),
        ),
      )
      .run();
  });
  return stale.length;
}

/* ----------------------------------------------------------------- feedback */

export interface AddFeedbackInput {
  metric: string;
  value?: number | null;
  unit?: string;
  source: FeedbackSource;
  observation?: string;
}

/**
 * Adds one observation to a session.
 *
 * `source` is mandatory and must be one of the two honest values. There is no
 * default, because a default would be a guess about where a number came from.
 *
 * Two kinds of name are refused: one that would make this an appearance or
 * voice-quality rating, and one that collides with a name the metrics engine writes
 * itself (see `RESERVED_METRIC_NAMES`).
 */
export function addFeedback(userId: string, sessionId: string, input: AddFeedbackInput): string {
  const session = db
    .select({ id: voicePracticeSessions.id })
    .from(voicePracticeSessions)
    .where(and(eq(voicePracticeSessions.id, sessionId), eq(voicePracticeSessions.userId, userId)))
    .get();
  if (!session) throw new NotFoundError('That practice session does not exist.');

  if (input.source !== 'measured' && input.source !== 'self_reported') {
    throw new ValidationError(
      'Every observation has to say where it came from: measured, or self-reported.',
      'source',
    );
  }
  const metric = input.metric.trim();
  if (metric.length < 2) throw new ValidationError('Name the metric.', 'metric');
  if (FORBIDDEN_METRIC_PATTERN.test(metric)) {
    throw new ValidationError(
      'GymOS does not track appearance or voice-quality ratings, so it will not store a metric by that name. Practice metrics here are duration, pace, pauses, speaking ratio and your own notes.',
      'metric',
    );
  }
  if (RESERVED_METRIC_NAMES.has(normaliseMetricName(metric))) {
    throw new ValidationError(
      `"${metric}" is one of the names the metrics engine writes for itself (${ENGINE_FEEDBACK_METRICS.join(
        ', ',
      )}), so a note cannot use it. Those rows are deleted and rewritten from the measurements every time the take is saved, which would wipe your note — and until it did, the note would have no Remove button, because that button is what tells your rows from the engine's. Name it something of your own instead: "rushed the last line" rather than "duration".`,
      'metric',
    );
  }

  const id = newId();
  db.insert(communicationFeedback)
    .values({
      id,
      sessionId,
      metric: metric.slice(0, 80),
      value: typeof input.value === 'number' && Number.isFinite(input.value) ? input.value : null,
      unit: (input.unit ?? '').slice(0, 24),
      source: input.source,
      observation: (input.observation ?? '').slice(0, 1000),
    })
    .run();
  return id;
}

export function deleteFeedback(userId: string, feedbackId: string): void {
  const row = db
    .select({ id: communicationFeedback.id })
    .from(communicationFeedback)
    .innerJoin(voicePracticeSessions, eq(voicePracticeSessions.id, communicationFeedback.sessionId))
    .where(and(eq(communicationFeedback.id, feedbackId), eq(voicePracticeSessions.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That observation does not exist.');
  db.delete(communicationFeedback).where(eq(communicationFeedback.id, row.id)).run();
}

/* ----------------------------------------------------------------- progress */

export interface ProgressPoint {
  sessionId: string;
  date: string;
  kind: VoicePracticeKind;
  scriptTitle: string | null;
  /** Measured. */
  durationSeconds: number;
  /** Measured, or null when no script of known length was read in full. */
  wordsPerMinute: number | null;
  /**
   * Measured in the browser, or null — when no analysis was supplied for the take,
   * when the one supplied was not credible, or once the recording it came from has
   * been deleted. These three travel together: they come from one analysis.
   */
  speakingRatio: number | null;
  pauseCount: number | null;
  longestPauseMs: number | null;
  /** Self-reported. */
  fillerTally: number | null;
  selfRatedClarity: number | null;
  hasRecording: boolean;
}

export interface VoiceProgress {
  points: ProgressPoint[];
  measuredMetrics: string[];
  selfReportedMetrics: string[];
  /** Totals that are safe to state, because they are counts of real rows. */
  totals: {
    sessions: number;
    totalDurationSeconds: number;
    sessionsWithRecording: number;
    sessionsWithMeasuredPace: number;
  };
  note: string;
}

/**
 * The measured series, oldest first, with nothing filled in.
 *
 * Gaps stay gaps: a session with no browser analysis — or one whose recording has
 * since been deleted — contributes a null for every audio-derived metric rather than
 * a carried-forward, interpolated or zeroed value, because a line that looks
 * continuous would be claiming measurements that were never made.
 */
export function progressSeries(userId: string, opts: { limit?: number } = {}): VoiceProgress {
  const rows = listPracticeSessions(userId, { limit: opts.limit ?? 200 });
  const points: ProgressPoint[] = rows
    .map((row) => ({
      sessionId: row.id,
      date: row.date,
      kind: row.kind,
      scriptTitle: row.scriptTitle,
      durationSeconds: row.durationSeconds,
      wordsPerMinute: row.wordsPerMinute,
      speakingRatio: row.speakingRatio,
      pauseCount: row.pauseCount,
      longestPauseMs: row.longestPauseMs,
      fillerTally: row.fillerTally,
      selfRatedClarity: row.selfRatedClarity,
      hasRecording: row.hasRecording,
    }))
    .reverse();

  return {
    points,
    measuredMetrics: [
      'duration',
      'words_per_minute',
      'pause_count',
      'longest_pause',
      'speaking_ratio',
    ],
    selfReportedMetrics: ['filler_tally', 'self_rated_clarity'],
    totals: {
      sessions: points.length,
      totalDurationSeconds: points.reduce((sum, p) => sum + p.durationSeconds, 0),
      sessionsWithRecording: points.filter((p) => p.hasRecording).length,
      sessionsWithMeasuredPace: points.filter((p) => p.wordsPerMinute !== null).length,
    },
    note: 'Gaps in this series are real. Pauses and speaking ratio are measured in your browser from a recording, so a take with no recording — or one whose recording you have since deleted — has neither, and a take without a known script read in full has no words-per-minute. Those points are left out rather than estimated.',
  };
}

export { MediaPolicyError };
