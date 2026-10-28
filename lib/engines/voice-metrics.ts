/**
 * Voice practice metrics. PURE: no I/O, no database, no services, no imports.
 *
 * WHAT THIS BUILD CAN AND CANNOT DO
 *
 * There is no speech-recognition model in GymOS. Nothing you say is transcribed,
 * and no transcript exists anywhere in this module, this database or this app. So
 * every number below falls into exactly one of two buckets:
 *
 *  - MEASURED — derived from the actual recorded samples (duration, frame energy,
 *    speaking and silence spans, pauses) or from a script whose length we know.
 *    The sample-derived ones are computed by `analyseAudioEnergy` below, running in
 *    the user's own browser over the decoded recording. The server never decodes
 *    audio, so it cannot re-derive them and cannot check them: it stores them only
 *    when the submitted analysis is in the range this function can actually produce,
 *    and otherwise stores nothing. See `sanitiseMeasurements` in services/voice.ts.
 *  - SELF-REPORTED — supplied by you. Filler words are the main one: you tap a
 *    counter during playback. GymOS cannot hear an "um".
 *
 * Nothing is inferred, modelled, estimated from a proxy, or invented to fill a gap.
 * When a number is not available it is `null` and the UI says why.
 *
 * WHAT THIS MODULE REFUSES TO DO
 *
 * It does not rate a voice. There is no score, no grade, no "good" or "bad", no
 * judgement of timbre, pitch, accent, warmth or authority, and no comparison with
 * any ideal, gendered or otherwise. A pace that sits outside the reference range
 * below is a fact about a take, not a fact about a person.
 */

/* ------------------------------------------------------------ energy analysis */

/**
 * Frame length for the energy analysis, in milliseconds.
 *
 * 20 ms is the usual window for short-term speech energy: long enough for a stable
 * RMS, short enough that a pause boundary lands within one frame of the truth.
 */
export const FRAME_MS = 20;

/**
 * Absolute silence gate, as linear RMS (about -40 dBFS).
 *
 * Anything quieter than this is treated as silence no matter what the rest of the
 * recording looks like. It stops a recording made in a dead-quiet room from having
 * its own noise floor stretched up into "speech".
 */
export const ABSOLUTE_SILENCE_RMS = 0.01;

/** A silent stretch counts as a pause only once it reaches this long. */
export const MIN_PAUSE_MS = 400;

export interface Pause {
  /** Milliseconds from the start of the recording. */
  startMs: number;
  durationMs: number;
}

export interface AudioEnergyAnalysis {
  /** Measured from sample count and sample rate. */
  durationSeconds: number;
  frameCount: number;
  /** 10th-percentile frame RMS: the recording's own noise floor. */
  noiseFloorRms: number;
  /** 95th-percentile frame RMS. */
  loudRms: number;
  /** The RMS above which a frame was counted as speech. */
  thresholdRms: number;
  speakingSeconds: number;
  silenceSeconds: number;
  /**
   * Speaking seconds divided by the span from the first to the last speech frame.
   * Dead air before your first word and after your last is recording handling, not
   * speaking behaviour, so it is excluded here and reported separately.
   */
  speakingRatio: number;
  leadingSilenceMs: number;
  trailingSilenceMs: number;
  /** Silent stretches of at least MIN_PAUSE_MS, between the first and last speech. */
  pauses: Pause[];
  pauseCount: number;
  longestPauseMs: number;
  totalPauseMs: number;
  /** True when no frame cleared the silence gate: nothing was measurable. */
  silent: boolean;
}

/** Anything indexable and length-bearing: Float32Array, number[], a test fixture. */
export interface SampleSource {
  readonly length: number;
  readonly [index: number]: number | undefined;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * fraction)),
  );
  return sorted[index] ?? 0;
}

/**
 * Short-term energy analysis over raw mono samples.
 *
 * Deliberately a pure function over an indexable sample source, so the same code
 * that runs on a real decoded AudioBuffer in the browser can be driven from
 * synthetic arrays in a test.
 *
 * Thresholding, stated plainly because it decides every pause number downstream:
 *   1. Frame the samples into FRAME_MS windows and take each frame's RMS.
 *   2. Noise floor = 10th percentile, loud = 95th percentile.
 *   3. If the loud level is under the absolute gate, the recording is silence.
 *   4. If loud is less than three times the floor there is no usable dynamic range
 *      (a flat tone, or steady noise), so fall back to the absolute gate alone
 *      rather than inventing a split that the signal does not contain.
 *   5. Otherwise the threshold sits 20% of the way from the floor up to the loud
 *      level, never below the absolute gate.
 */
export function analyseAudioEnergy(
  samples: SampleSource,
  sampleRate: number,
  opts: { minPauseMs?: number } = {},
): AudioEnergyAnalysis {
  const minPauseMs = opts.minPauseMs ?? MIN_PAUSE_MS;
  const safeRate = sampleRate > 0 ? sampleRate : 1;
  const durationSeconds = samples.length / safeRate;
  const frameSize = Math.max(1, Math.round((FRAME_MS / 1000) * safeRate));
  const frameCount = Math.floor(samples.length / frameSize);
  const frameSeconds = frameSize / safeRate;

  const empty: AudioEnergyAnalysis = {
    durationSeconds,
    frameCount: 0,
    noiseFloorRms: 0,
    loudRms: 0,
    thresholdRms: ABSOLUTE_SILENCE_RMS,
    speakingSeconds: 0,
    silenceSeconds: durationSeconds,
    speakingRatio: 0,
    leadingSilenceMs: Math.round(durationSeconds * 1000),
    trailingSilenceMs: 0,
    pauses: [],
    pauseCount: 0,
    longestPauseMs: 0,
    totalPauseMs: 0,
    silent: true,
  };
  if (frameCount === 0) return empty;

  const rms: number[] = [];
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * frameSize;
    let sum = 0;
    for (let i = 0; i < frameSize; i += 1) {
      const value = samples[start + i] ?? 0;
      sum += value * value;
    }
    rms.push(Math.sqrt(sum / frameSize));
  }

  const sorted = [...rms].sort((a, b) => a - b);
  const noiseFloorRms = percentile(sorted, 0.1);
  const loudRms = percentile(sorted, 0.95);

  let thresholdRms: number;
  if (loudRms < ABSOLUTE_SILENCE_RMS) {
    thresholdRms = ABSOLUTE_SILENCE_RMS;
  } else if (loudRms < noiseFloorRms * 3) {
    thresholdRms = ABSOLUTE_SILENCE_RMS;
  } else {
    thresholdRms = Math.max(ABSOLUTE_SILENCE_RMS, noiseFloorRms + (loudRms - noiseFloorRms) * 0.2);
  }

  const voiced = rms.map((value) => value >= thresholdRms);
  const firstVoiced = voiced.indexOf(true);
  if (firstVoiced === -1) return { ...empty, frameCount, noiseFloorRms, loudRms, thresholdRms };
  const lastVoiced = voiced.lastIndexOf(true);

  let speakingFrames = 0;
  for (let frame = firstVoiced; frame <= lastVoiced; frame += 1) {
    if (voiced[frame]) speakingFrames += 1;
  }
  const spanFrames = lastVoiced - firstVoiced + 1;

  const pauses: Pause[] = [];
  let runStart = -1;
  for (let frame = firstVoiced; frame <= lastVoiced + 1; frame += 1) {
    const isSilent = frame <= lastVoiced && !voiced[frame];
    if (isSilent && runStart === -1) runStart = frame;
    if (!isSilent && runStart !== -1) {
      const durationMs = Math.round((frame - runStart) * frameSeconds * 1000);
      if (durationMs >= minPauseMs) {
        pauses.push({ startMs: Math.round(runStart * frameSeconds * 1000), durationMs });
      }
      runStart = -1;
    }
  }

  const totalPauseMs = pauses.reduce((sum, pause) => sum + pause.durationMs, 0);
  const speakingSeconds = speakingFrames * frameSeconds;
  const analysedSeconds = spanFrames * frameSeconds;

  return {
    durationSeconds,
    frameCount,
    noiseFloorRms,
    loudRms,
    thresholdRms,
    speakingSeconds,
    silenceSeconds: Math.max(0, durationSeconds - speakingSeconds),
    speakingRatio: analysedSeconds > 0 ? speakingSeconds / analysedSeconds : 0,
    leadingSilenceMs: Math.round(firstVoiced * frameSeconds * 1000),
    trailingSilenceMs: Math.round((frameCount - 1 - lastVoiced) * frameSeconds * 1000),
    pauses,
    pauseCount: pauses.length,
    longestPauseMs: pauses.reduce((max, pause) => Math.max(max, pause.durationMs), 0),
    totalPauseMs,
    silent: false,
  };
}

/* ----------------------------------------------------------------- pace bands */

/**
 * The reference range used for pace, and what it is not.
 *
 * Guidance for public speaking and for audiobook narration in English commonly puts
 * comfortable, intelligible delivery somewhere around 120 to 160 words a minute.
 * That is a rule of thumb about a listener's comfort, collected from general
 * practice rather than measured in this app, and it varies by language, by material
 * and by audience. Reading dense figures aloud below the range is sensible;
 * an energetic pitch above it is not a defect.
 *
 * It is a reference, not a target, and never a verdict on the speaker.
 */
export const PACE_REFERENCE_LOW_WPM = 120;
export const PACE_REFERENCE_HIGH_WPM = 160;
export const PACE_REFERENCE_NOTE =
  'Public-speaking and narration guidance for English commonly describes comfortable delivery as roughly 120–160 words a minute. It is a general guideline about listener comfort, it varies by language and material, and it is not a judgement of you or your voice.';

export type PaceBand = 'unknown' | 'below_reference' | 'within_reference' | 'above_reference';

export const PACE_BAND_LABELS: Record<PaceBand, string> = {
  unknown: 'Not measured',
  below_reference: 'Below the 120–160 wpm reference range',
  within_reference: 'Inside the 120–160 wpm reference range',
  above_reference: 'Above the 120–160 wpm reference range',
};

export function paceBand(wordsPerMinute: number | null): PaceBand {
  if (wordsPerMinute === null || !Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) {
    return 'unknown';
  }
  if (wordsPerMinute < PACE_REFERENCE_LOW_WPM) return 'below_reference';
  if (wordsPerMinute > PACE_REFERENCE_HIGH_WPM) return 'above_reference';
  return 'within_reference';
}

/**
 * Words per minute, or null.
 *
 * Null whenever the word count is unknown, which is every take that was not read
 * from a script of known length. GymOS does not transcribe, so there is no second
 * route to a word count and no guess is attempted.
 */
export function wordsPerMinute(
  scriptWordCount: number | null | undefined,
  durationSeconds: number,
): number | null {
  if (scriptWordCount === null || scriptWordCount === undefined) return null;
  if (!Number.isFinite(scriptWordCount) || scriptWordCount <= 0) return null;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return (scriptWordCount / durationSeconds) * 60;
}

/* ------------------------------------------------------------------- metrics */

export interface VoiceMetricsInput {
  /** Measured: from the audio when there is a recording, otherwise the practice timer. */
  durationSeconds: number;
  /**
   * Known script length, and only when the whole script was read. Null for free
   * speaking, for prompt-style scripts, and whenever completion was not confirmed.
   */
  scriptWordCount?: number | null;
  /**
   * Measured from the audio. Absent whenever no analysis arrived — which covers a
   * take with no recording AND a take whose recording the browser could not decode,
   * two situations this module cannot and does not tell apart.
   */
  pauses?: Pause[];
  speakingRatio?: number | null;
  /** Self-reported: tapped by the user during playback. GymOS cannot hear fillers. */
  fillerTally?: number | null;
  /** Self-reported: the user's own 1-5 rating of how clear the take felt to them. */
  selfRatedClarity?: number | null;
}

export interface PauseStatistics {
  count: number;
  longestMs: number;
  totalMs: number;
  medianMs: number;
  perMinute: number;
}

export interface VoiceMetricsResult {
  durationSeconds: number;
  wordsPerMinute: number | null;
  paceBand: PaceBand;
  paceLabel: string;
  paceNote: string;
  /** Null when no analysis of recorded audio arrived. */
  speakingRatio: number | null;
  pauses: PauseStatistics | null;
  fillerTally: number | null;
  fillersPerMinute: number | null;
  selfRatedClarity: number | null;
  /** Neutral, specific, non-judgemental. Never a rating. */
  suggestions: string[];
  /** Plain-language account of where each number came from. */
  provenance: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function pauseStatistics(pauses: Pause[], durationSeconds: number): PauseStatistics {
  const durations = pauses.map((pause) => pause.durationMs);
  const minutes = durationSeconds > 0 ? durationSeconds / 60 : 0;
  return {
    count: pauses.length,
    longestMs: durations.reduce((max, value) => Math.max(max, value), 0),
    totalMs: durations.reduce((sum, value) => sum + value, 0),
    medianMs: Math.round(median(durations)),
    perMinute: minutes > 0 ? pauses.length / minutes : 0,
  };
}

const ROUND_1 = (value: number): string => value.toFixed(1);

/**
 * Turns measurements into practice suggestions.
 *
 * Every line names the number it came from and proposes a concrete thing to try.
 * None of them praises, criticises or ranks: an observation plus an action, or
 * nothing at all. Where a number is missing, the suggestion says so rather than
 * filling the space.
 */
function buildSuggestions(
  input: VoiceMetricsInput,
  result: {
    wpm: number | null;
    band: PaceBand;
    pauses: PauseStatistics | null;
    durationSeconds: number;
  },
): string[] {
  const out: string[] = [];
  const seconds = Math.round(result.durationSeconds);

  if (result.wpm === null) {
    out.push(
      'Words per minute was not measured for this take. GymOS does not transcribe speech, so it can only work out a rate when you read a script whose length it knows and confirm you read all of it.',
    );
  } else if (result.band === 'above_reference') {
    out.push(
      `This take worked out at ${Math.round(result.wpm)} words a minute, above the 120–160 wpm reference range. If a listener needs to follow detail, try taking a full stop at every full stop and reading the next sentence from a standstill.`,
    );
  } else if (result.band === 'below_reference') {
    out.push(
      `This take worked out at ${Math.round(result.wpm)} words a minute, below the 120–160 wpm reference range. If you want more momentum, try reading in whole phrases rather than word by word, and mark the phrase breaks on the script first.`,
    );
  } else {
    out.push(
      `This take worked out at ${Math.round(result.wpm)} words a minute, inside the 120–160 wpm reference range.`,
    );
  }

  if (result.pauses === null) {
    out.push(
      'Pauses and silence were not measured for this take, because no analysis of recorded audio reached GymOS — either there was no recording, or this browser could not decode the one there was. The timed duration above is still measured.',
    );
  } else {
    const { count, longestMs, perMinute } = result.pauses;
    if (count === 0) {
      out.push(
        `No silence of 0.4 seconds or longer was detected in ${seconds} seconds. If you want breathing room for a listener, try marking two or three deliberate stops on the script and taking them.`,
      );
    } else {
      out.push(
        `You paused ${count} ${count === 1 ? 'time' : 'times'} in ${seconds} seconds, about ${ROUND_1(perMinute)} a minute. If any of those were places you lost the thread, mark breath points on the script before the next take and see whether they move.`,
      );
    }
    if (longestMs >= 3000) {
      out.push(
        `The longest silence was ${ROUND_1(longestMs / 1000)} seconds. If it was deliberate, leave it in; if it was a gap while you looked for the next point, a three-word written cue at that spot usually bridges it.`,
      );
    }
    const ratio = input.speakingRatio;
    if (typeof ratio === 'number' && Number.isFinite(ratio) && ratio < 0.6) {
      out.push(
        `You were speaking for ${Math.round(ratio * 100)}% of the time between your first and last word. That is a measurement of this take, not a problem in itself — rehearsing the opening line until it is automatic is the usual way to raise it.`,
      );
    }
  }

  const fillers = input.fillerTally;
  if (typeof fillers === 'number' && Number.isFinite(fillers) && fillers > 0) {
    out.push(
      `You tapped ${fillers} filler ${fillers === 1 ? 'word' : 'words'} while listening back. That count is yours, not GymOS's — there is no speech recognition here. Replaying one minute at a time and tapping again is the cheapest way to see whether it moves.`,
    );
  }

  return out;
}

/**
 * Where every number on the page came from, in plain language.
 *
 * `hasAnalysis` is exactly that: whether an analysis of recorded audio arrived. It is
 * not a claim about whether a recording exists, which this pure function cannot know
 * and must not imply — a take whose audio the browser failed to decode has a
 * recording and no analysis.
 */
function buildProvenance(input: VoiceMetricsInput, hasAnalysis: boolean): string[] {
  const lines: string[] = [];
  lines.push(
    hasAnalysis
      ? 'Duration, silence and pauses: measured in your browser from the actual samples of your recording. GymOS does not decode audio on the server, so these numbers are the ones your own browser worked out.'
      : 'Duration: measured by the practice timer. No analysis of recorded audio reached GymOS for this take, so silence and pauses were not measured.',
  );
  lines.push(
    input.scriptWordCount
      ? "Words per minute: the script's known word count divided by the measured duration. It assumes you read the whole script, which you confirmed — GymOS does not transcribe, so it cannot check that for you."
      : 'Words per minute: not available. It needs a script of known length that you confirm you read in full.',
  );
  if (typeof input.fillerTally === 'number') {
    lines.push('Filler count: self-reported. You tapped it during playback.');
  }
  if (typeof input.selfRatedClarity === 'number') {
    lines.push('Clarity: self-reported. It is your own rating of your own take.');
  }
  lines.push('Nothing was transcribed. No voice was scored, rated or compared to an ideal.');
  return lines;
}

export function computeVoiceMetrics(input: VoiceMetricsInput): VoiceMetricsResult {
  const durationSeconds = Number.isFinite(input.durationSeconds)
    ? Math.max(0, input.durationSeconds)
    : 0;
  const wpm = wordsPerMinute(input.scriptWordCount ?? null, durationSeconds);
  const band = paceBand(wpm);
  // Whether an analysis arrived, which is all this pure function can know. Audio may
  // exist without one (a decode failure in the browser), so nothing downstream may
  // read this as "there is no recording".
  const hasAnalysis = Array.isArray(input.pauses);
  const pauses = hasAnalysis ? pauseStatistics(input.pauses ?? [], durationSeconds) : null;
  const fillerTally =
    typeof input.fillerTally === 'number' && Number.isFinite(input.fillerTally)
      ? Math.max(0, Math.round(input.fillerTally))
      : null;
  const minutes = durationSeconds / 60;

  return {
    durationSeconds,
    wordsPerMinute: wpm === null ? null : Math.round(wpm),
    paceBand: band,
    paceLabel: PACE_BAND_LABELS[band],
    paceNote: PACE_REFERENCE_NOTE,
    speakingRatio:
      typeof input.speakingRatio === 'number' && Number.isFinite(input.speakingRatio)
        ? input.speakingRatio
        : null,
    pauses,
    fillerTally,
    fillersPerMinute: fillerTally !== null && minutes > 0 ? fillerTally / minutes : null,
    selfRatedClarity:
      typeof input.selfRatedClarity === 'number' && Number.isFinite(input.selfRatedClarity)
        ? input.selfRatedClarity
        : null,
    suggestions: buildSuggestions(input, { wpm, band, pauses, durationSeconds }),
    provenance: buildProvenance(input, hasAnalysis),
  };
}

/* ------------------------------------------------------------ feedback drafts */

export type FeedbackSource = 'measured' | 'self_reported';

/**
 * The metric names `buildFeedbackEntries` writes.
 *
 * Exported so a caller can tell an engine-written row from an observation the user
 * typed themselves, without having to guess from the text.
 */
export const ENGINE_FEEDBACK_METRICS = [
  'duration',
  'words_per_minute',
  'pause_count',
  'longest_pause',
  'speaking_ratio',
  'filler_tally',
  'self_rated_clarity',
] as const;

/** The subset of ENGINE_FEEDBACK_METRICS that can only come from recorded audio. */
export const AUDIO_DERIVED_FEEDBACK_METRICS = [
  'pause_count',
  'longest_pause',
  'speaking_ratio',
] as const;

export interface FeedbackEntryDraft {
  metric: string;
  value: number | null;
  unit: string;
  source: FeedbackSource;
  observation: string;
}

/**
 * The rows that get written to communication_feedback.
 *
 * The whole point of this function is that `source` is decided here, once, from
 * where the number actually came from — not chosen later by a caller who might get
 * it wrong. Measured means the audio, the timer or the script. Self-reported means
 * the user typed or tapped it.
 */
export function buildFeedbackEntries(input: VoiceMetricsInput): FeedbackEntryDraft[] {
  const metrics = computeVoiceMetrics(input);
  const entries: FeedbackEntryDraft[] = [
    {
      metric: 'duration',
      value: Math.round(metrics.durationSeconds),
      unit: 'seconds',
      source: 'measured',
      // What this function knows is whether an analysis arrived — NOT whether audio
      // exists. A recording whose decode failed in the browser is saved with no
      // analysis, so "this session has no recording" would be a false statement
      // stored against a take that has one. Name the actual reason instead.
      observation: Array.isArray(input.pauses)
        ? 'Measured in your browser from the recorded audio.'
        : 'Measured by the practice timer, because no browser analysis of recorded audio was accepted for this take. That is not a statement about whether a recording is attached.',
    },
  ];

  if (metrics.wordsPerMinute !== null) {
    entries.push({
      metric: 'words_per_minute',
      value: metrics.wordsPerMinute,
      unit: 'wpm',
      source: 'measured',
      observation: `Known script length divided by measured duration. ${metrics.paceLabel}. Assumes the whole script was read, as you confirmed; nothing was transcribed.`,
    });
  }

  if (metrics.pauses) {
    entries.push({
      metric: 'pause_count',
      value: metrics.pauses.count,
      unit: 'pauses',
      source: 'measured',
      observation: `Silences of at least ${MIN_PAUSE_MS} ms, detected in your browser from frame energy in the recording.`,
    });
    entries.push({
      metric: 'longest_pause',
      value: metrics.pauses.longestMs,
      unit: 'ms',
      source: 'measured',
      observation:
        'Longest silence between your first and last word, from the same browser-side analysis.',
    });
  }

  if (metrics.speakingRatio !== null) {
    entries.push({
      metric: 'speaking_ratio',
      value: metrics.speakingRatio,
      unit: 'ratio',
      source: 'measured',
      observation:
        'Speaking time divided by the span from first to last word, computed in your browser from frame energy in the recording.',
    });
  }

  if (metrics.fillerTally !== null) {
    entries.push({
      metric: 'filler_tally',
      value: metrics.fillerTally,
      unit: 'taps',
      source: 'self_reported',
      observation:
        'You tapped this during playback. GymOS has no speech recognition and cannot count fillers.',
    });
  }

  if (metrics.selfRatedClarity !== null) {
    entries.push({
      metric: 'self_rated_clarity',
      value: metrics.selfRatedClarity,
      unit: '1-5',
      source: 'self_reported',
      observation: 'Your own rating of how clear this take felt to you.',
    });
  }

  return entries;
}
