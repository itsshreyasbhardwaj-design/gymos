/**
 * Voice & Communication OS — the pure layer.
 *
 * These tests exist to keep the honesty contract from eroding: that nothing is
 * transcribed, that words per minute is absent rather than guessed when there is no
 * script, that pause detection is real signal processing rather than a plausible
 * number, and that no output ever rates a voice or an appearance.
 */
import { describe, it, expect } from 'vitest';
import {
  analyseAudioEnergy,
  buildFeedbackEntries,
  computeVoiceMetrics,
  paceBand,
  wordsPerMinute,
  ABSOLUTE_SILENCE_RMS,
  FRAME_MS,
  MIN_PAUSE_MS,
  PACE_REFERENCE_HIGH_WPM,
  PACE_REFERENCE_LOW_WPM,
  PACE_REFERENCE_NOTE,
  type Pause,
} from '@/lib/engines/voice-metrics';
import {
  VOICE_SCRIPTS,
  VOICE_SCRIPT_BY_ID,
  VOICE_SCRIPT_KINDS,
  VOICE_SCRIPT_KIND_LABELS,
  VOICE_SCRIPT_PROVENANCES,
  countWords,
  scriptsForKind,
} from '@/lib/content/voice-scripts';
import { getTableColumns } from 'drizzle-orm';
import {
  VOICE_PRACTICE_KINDS,
  communicationGoals,
  voicePracticeSessions,
  voiceRecordings,
  communicationFeedback,
} from '@/lib/db/schema';

const SAMPLE_RATE = 48000;

/** Independent word count, written to the documented rule rather than reusing it. */
function recountWords(text: string): number {
  let count = 0;
  for (const token of text.split(/[\s ]+/)) {
    if (token === '') continue;
    let hasAlphanumeric = false;
    for (const ch of token) {
      if (/[a-zA-Z0-9]/.test(ch)) {
        hasAlphanumeric = true;
        break;
      }
    }
    if (hasAlphanumeric) count += 1;
  }
  return count;
}

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE));
}

function tone(seconds: number, amplitude = 0.4, frequency = 220): Float32Array {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE);
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/* ------------------------------------------------------------ script library */

describe('voice script library', () => {
  it('ships a usable library across several kinds', () => {
    expect(VOICE_SCRIPTS.length).toBeGreaterThanOrEqual(12);
    const kinds = new Set(VOICE_SCRIPTS.map((s) => s.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    for (const kind of kinds) expect(scriptsForKind(kind).length).toBeGreaterThan(0);
  });

  it('declares only kinds the schema accepts, with a label for each', () => {
    for (const kind of VOICE_SCRIPT_KINDS) {
      expect(VOICE_PRACTICE_KINDS as readonly string[]).toContain(kind);
      expect(VOICE_SCRIPT_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
    for (const script of VOICE_SCRIPTS) {
      expect(VOICE_PRACTICE_KINDS as readonly string[]).toContain(script.kind);
    }
  });

  it('has unique ids, all reachable through the index', () => {
    const ids = VOICE_SCRIPTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(VOICE_SCRIPT_BY_ID.get(id)?.id).toBe(id);
  });

  it('declares every word count correctly, checked against an independent recount', () => {
    for (const script of VOICE_SCRIPTS) {
      expect(script.text.trim().length, script.id).toBeGreaterThan(0);
      expect(script.wordCount, `${script.id} word count`).toBe(recountWords(script.text));
      expect(script.wordCount, script.id).toBeGreaterThan(10);
      expect(script.focus.length, script.id).toBeGreaterThan(10);
      expect(script.estimatedSeconds, script.id).toBeGreaterThan(0);
      // Every passage currently shipped really was written for GymOS.
      expect(script.provenance, script.id).toBe('original');
    }
  });

  it('pairs every provenance with a source, so nothing borrowed can pass as original', () => {
    expect(VOICE_SCRIPT_PROVENANCES).toContain('public_domain');
    expect(VOICE_SCRIPT_PROVENANCES).toContain('adapted_public_domain');
    for (const script of VOICE_SCRIPTS) {
      expect(VOICE_SCRIPT_PROVENANCES, script.id).toContain(script.provenance);
      if (script.provenance === 'original') {
        // Original writing has no source to cite, and claiming one would be odd.
        expect(script.provenanceSource, script.id).toBeNull();
      } else {
        // Anything not written here must name the work it came from.
        expect(script.provenanceSource, script.id).toBeTruthy();
      }
    }
  });

  it('only claims a spoken word count for scripts that are read aloud verbatim', () => {
    for (const script of VOICE_SCRIPTS) {
      if (script.mode === 'read_aloud') {
        expect(script.spokenWordCount, script.id).toBe(script.wordCount);
      } else {
        // A brief in your own words: GymOS cannot know how many words you said.
        expect(script.spokenWordCount, script.id).toBeNull();
      }
    }
    expect(VOICE_SCRIPTS.some((s) => s.mode === 'read_aloud')).toBe(true);
    expect(VOICE_SCRIPTS.some((s) => s.mode === 'prompt')).toBe(true);
  });

  it('counts words to the documented rule', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('  padded   out  ')).toBe(2);
    expect(countWords('a word — and another')).toBe(4);
    expect(countWords('well-known isn’t two')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('— … -')).toBe(0);
  });
});

/* ----------------------------------------------------------- words per minute */

describe('words per minute', () => {
  it('is word count over duration, in minutes', () => {
    expect(wordsPerMinute(150, 60)).toBe(150);
    expect(wordsPerMinute(75, 30)).toBe(150);
    expect(wordsPerMinute(300, 120)).toBe(150);
    expect(wordsPerMinute(100, 50)).toBeCloseTo(120, 6);
  });

  it('is null whenever the word count is unknown, and never guessed', () => {
    expect(wordsPerMinute(null, 60)).toBeNull();
    expect(wordsPerMinute(undefined, 60)).toBeNull();
    expect(wordsPerMinute(0, 60)).toBeNull();
    expect(wordsPerMinute(-10, 60)).toBeNull();
    expect(wordsPerMinute(Number.NaN, 60)).toBeNull();
  });

  it('is null when there is no usable duration', () => {
    expect(wordsPerMinute(150, 0)).toBeNull();
    expect(wordsPerMinute(150, -1)).toBeNull();
    expect(wordsPerMinute(150, Number.NaN)).toBeNull();
  });

  it('leaves the stored rate null for a take with no script', () => {
    const metrics = computeVoiceMetrics({ durationSeconds: 90, scriptWordCount: null });
    expect(metrics.wordsPerMinute).toBeNull();
    expect(metrics.paceBand).toBe('unknown');
    expect(metrics.suggestions.join(' ')).toMatch(/not measured/i);
    expect(metrics.suggestions.join(' ')).toMatch(/does not transcribe/i);
  });
});

describe('pace bands', () => {
  it('describes the reference range without passing judgement', () => {
    expect(paceBand(null)).toBe('unknown');
    expect(paceBand(PACE_REFERENCE_LOW_WPM - 1)).toBe('below_reference');
    expect(paceBand(PACE_REFERENCE_LOW_WPM)).toBe('within_reference');
    expect(paceBand(140)).toBe('within_reference');
    expect(paceBand(PACE_REFERENCE_HIGH_WPM)).toBe('within_reference');
    expect(paceBand(PACE_REFERENCE_HIGH_WPM + 1)).toBe('above_reference');
  });

  it('states that the range is a general guideline, not a verdict', () => {
    expect(PACE_REFERENCE_NOTE).toMatch(/guideline/i);
    expect(PACE_REFERENCE_NOTE).toMatch(/not a judgement/i);
  });
});

/* --------------------------------------------------------- energy + pauses */

describe('audio energy analysis over synthetic buffers', () => {
  it('reports pure silence as silence, with no pauses invented inside it', () => {
    const analysis = analyseAudioEnergy(silence(5), SAMPLE_RATE);
    expect(analysis.silent).toBe(true);
    expect(analysis.durationSeconds).toBeCloseTo(5, 3);
    expect(analysis.speakingSeconds).toBe(0);
    expect(analysis.speakingRatio).toBe(0);
    expect(analysis.pauseCount).toBe(0);
    expect(analysis.pauses).toEqual([]);
    expect(analysis.longestPauseMs).toBe(0);
  });

  it('reports a continuous tone as continuous speech with no pauses', () => {
    const analysis = analyseAudioEnergy(tone(4), SAMPLE_RATE);
    expect(analysis.silent).toBe(false);
    expect(analysis.speakingRatio).toBeCloseTo(1, 2);
    expect(analysis.pauseCount).toBe(0);
    expect(analysis.longestPauseMs).toBe(0);
    expect(analysis.speakingSeconds).toBeGreaterThan(3.9);
  });

  it('finds every gap in an alternating tone-and-silence buffer', () => {
    // 1s tone, 1s gap, 1s tone, 1s gap, 1s tone: two internal pauses.
    const analysis = analyseAudioEnergy(
      concat(tone(1), silence(1), tone(1), silence(1), tone(1)),
      SAMPLE_RATE,
    );
    expect(analysis.pauseCount).toBe(2);
    for (const pause of analysis.pauses) {
      expect(pause.durationMs).toBeGreaterThan(900);
      expect(pause.durationMs).toBeLessThan(1100);
    }
    expect(analysis.longestPauseMs).toBeGreaterThan(900);
    expect(analysis.speakingRatio).toBeGreaterThan(0.5);
    expect(analysis.speakingRatio).toBeLessThan(0.75);
  });

  it('excludes the dead air before the first word and after the last', () => {
    const analysis = analyseAudioEnergy(
      concat(silence(2), tone(1), silence(1), tone(1), silence(2)),
      SAMPLE_RATE,
    );
    expect(analysis.pauseCount).toBe(1);
    expect(analysis.leadingSilenceMs).toBeGreaterThan(1900);
    expect(analysis.trailingSilenceMs).toBeGreaterThan(1900);
    // Ratio is over the span from first to last word, so it is not dragged down by
    // the four seconds of dead air at the ends.
    expect(analysis.speakingRatio).toBeGreaterThan(0.6);
  });

  it('ignores gaps shorter than the minimum pause length', () => {
    const blip = silence(0.1);
    const analysis = analyseAudioEnergy(concat(tone(1), blip, tone(1), blip, tone(1)), SAMPLE_RATE);
    expect(MIN_PAUSE_MS).toBeGreaterThan(100);
    expect(analysis.pauseCount).toBe(0);
  });

  it('treats a very quiet buffer as silence rather than stretching its own noise floor', () => {
    const quiet = tone(3, ABSOLUTE_SILENCE_RMS / 4);
    const analysis = analyseAudioEnergy(quiet, SAMPLE_RATE);
    expect(analysis.silent).toBe(true);
    expect(analysis.speakingRatio).toBe(0);
  });

  it('handles degenerate input without throwing or inventing numbers', () => {
    const emptyBuffer = analyseAudioEnergy(new Float32Array(0), SAMPLE_RATE);
    expect(emptyBuffer.frameCount).toBe(0);
    expect(emptyBuffer.pauseCount).toBe(0);
    expect(emptyBuffer.silent).toBe(true);

    const badRate = analyseAudioEnergy(tone(1), 0);
    expect(Number.isFinite(badRate.durationSeconds)).toBe(true);
  });

  it('works over a plain number array, not only a Float32Array', () => {
    const frameSamples = Math.round((FRAME_MS / 1000) * SAMPLE_RATE);
    const plain: number[] = [];
    for (let i = 0; i < frameSamples * 100; i += 1) plain.push(0.4 * Math.sin(i / 10));
    const analysis = analyseAudioEnergy(plain, SAMPLE_RATE);
    expect(analysis.frameCount).toBe(100);
    expect(analysis.silent).toBe(false);
  });
});

/* --------------------------------------------------------------- suggestions */

describe('practice suggestions', () => {
  const pauses: Pause[] = Array.from({ length: 14 }, (_, i) => ({
    startMs: i * 6000,
    durationMs: 700,
  }));

  it('names the number it came from and proposes something concrete', () => {
    const metrics = computeVoiceMetrics({
      durationSeconds: 90,
      scriptWordCount: 200,
      pauses,
      speakingRatio: 0.8,
    });
    const text = metrics.suggestions.join(' ');
    expect(text).toMatch(/paused 14 times in 90 seconds/);
    expect(text).toMatch(/breath points/);
    expect(metrics.pauses?.count).toBe(14);
    expect(metrics.wordsPerMinute).toBe(133);
    expect(metrics.paceBand).toBe('within_reference');
  });

  it('says plainly when pauses were not measured, rather than reporting zero', () => {
    const metrics = computeVoiceMetrics({ durationSeconds: 60, scriptWordCount: 150 });
    expect(metrics.pauses).toBeNull();
    expect(metrics.speakingRatio).toBeNull();
    expect(metrics.suggestions.join(' ')).toMatch(/no recording/i);
    // And it names the reason it actually has — no analysis arrived — rather than
    // asserting the absence of audio, which this pure function cannot know.
    expect(metrics.suggestions.join(' ')).toMatch(/analysis/i);
  });

  it('labels a tapped filler count as the user’s own', () => {
    const metrics = computeVoiceMetrics({ durationSeconds: 60, pauses: [], fillerTally: 9 });
    expect(metrics.fillerTally).toBe(9);
    expect(metrics.fillersPerMinute).toBeCloseTo(9, 6);
    expect(metrics.suggestions.join(' ')).toMatch(/count is yours/i);
    expect(metrics.suggestions.join(' ')).toMatch(/no speech recognition/i);
  });

  it('explains the provenance of every number it reports', () => {
    const withAudio = computeVoiceMetrics({
      durationSeconds: 60,
      scriptWordCount: 150,
      pauses: [],
      speakingRatio: 0.9,
      fillerTally: 2,
      selfRatedClarity: 4,
    });
    const text = withAudio.provenance.join(' ');
    expect(text).toMatch(/recording/i);
    // It has to say WHERE the analysis ran: the server cannot re-derive any of it.
    expect(text).toMatch(/in your browser/i);
    expect(text).toMatch(/self-reported/i);
    expect(text).toMatch(/Nothing was transcribed/i);

    const withoutAudio = computeVoiceMetrics({ durationSeconds: 60 });
    expect(withoutAudio.provenance.join(' ')).toMatch(/practice timer/i);
    expect(withoutAudio.provenance.join(' ')).toMatch(/analysis/i);
    expect(withoutAudio.provenance.join(' ')).not.toMatch(/there is no recording/i);
  });
});

/* ----------------------------------------------------------- feedback drafts */

describe('feedback entries', () => {
  it('marks audio-derived and script-derived numbers as measured', () => {
    const entries = buildFeedbackEntries({
      durationSeconds: 60,
      scriptWordCount: 150,
      pauses: [{ startMs: 1000, durationMs: 800 }],
      speakingRatio: 0.85,
    });
    const byMetric = new Map(entries.map((e) => [e.metric, e]));
    for (const metric of [
      'duration',
      'words_per_minute',
      'pause_count',
      'longest_pause',
      'speaking_ratio',
    ]) {
      expect(byMetric.get(metric)?.source, metric).toBe('measured');
    }
  });

  it('marks everything the user supplied as self-reported', () => {
    const entries = buildFeedbackEntries({
      durationSeconds: 60,
      pauses: [],
      fillerTally: 5,
      selfRatedClarity: 3,
    });
    const byMetric = new Map(entries.map((e) => [e.metric, e]));
    expect(byMetric.get('filler_tally')?.source).toBe('self_reported');
    expect(byMetric.get('self_rated_clarity')?.source).toBe('self_reported');
  });

  it('only ever uses the two honest source values', () => {
    const cases = [
      { durationSeconds: 10 },
      { durationSeconds: 60, scriptWordCount: 150, pauses: [], speakingRatio: 1 },
      { durationSeconds: 60, fillerTally: 3, selfRatedClarity: 5 },
    ];
    for (const input of cases) {
      for (const entry of buildFeedbackEntries(input)) {
        expect(['measured', 'self_reported']).toContain(entry.source);
        expect(entry.observation.length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The duration row is written for every take, including takes with no analysis, so
   * its observation is the one piece of stored prose that has to be true in both
   * cases. The only thing this pure function knows is whether an analysis arrived;
   * whether a recording exists is a separate fact it never sees. They come apart in
   * practice: components/voice-recorder.tsx catches a `decodeAudioData` failure and
   * still uploads the audio, so that take has a recording and no analysis.
   */
  it('keys the duration observation on the missing analysis, not on missing audio', () => {
    const withAnalysis = buildFeedbackEntries({
      durationSeconds: 30,
      pauses: [{ startMs: 1000, durationMs: 600 }],
      speakingRatio: 0.8,
    }).find((e) => e.metric === 'duration');
    expect(withAnalysis?.source).toBe('measured');
    expect(withAnalysis?.observation).toMatch(/in your browser/i);
    expect(withAnalysis?.observation).toMatch(/recorded audio/i);

    const withoutAnalysis = buildFeedbackEntries({ durationSeconds: 45 }).find(
      (e) => e.metric === 'duration',
    );
    expect(withoutAnalysis?.source).toBe('measured');
    expect(withoutAnalysis?.observation).toMatch(/practice timer/i);
    // It must give the reason it actually has.
    expect(withoutAnalysis?.observation).toMatch(/analysis/i);
    // And it must not assert the thing it cannot know. This is the exact sentence the
    // row used to carry, stored against takes that did have a recording.
    expect(withoutAnalysis?.observation).not.toMatch(/this session has no recording/i);
    expect(withoutAnalysis?.observation).not.toMatch(/\bhas no recording\b/i);
  });

  it('omits a metric entirely rather than writing a placeholder value', () => {
    const metrics = buildFeedbackEntries({ durationSeconds: 45 }).map((e) => e.metric);
    expect(metrics).toContain('duration');
    expect(metrics).not.toContain('words_per_minute');
    expect(metrics).not.toContain('pause_count');
    expect(metrics).not.toContain('speaking_ratio');
    expect(metrics).not.toContain('filler_tally');
  });
});

/* -------------------------------------------------------------- safety rails */

/**
 * Vocabulary that must never appear in anything this module produces, or in any
 * script shipped with it. The list covers voice-quality judgements, appearance
 * scoring and gendered ideals; a single hit fails the build.
 */
const FORBIDDEN_VOCABULARY = [
  'attractive',
  'attractiveness',
  'beautiful',
  'beauty',
  'handsome',
  'sexy',
  'looksmax',
  'body fat',
  'bodyfat',
  'physique',
  'facial feature',
  'your voice is',
  'sounds better',
  'sounds worse',
  'pleasant voice',
  'unpleasant',
  'annoying',
  'nasal',
  'shrill',
  'squeaky',
  'whiny',
  'grating',
  'masculine',
  'feminine',
  'manly',
  'girly',
  'authoritative voice',
  'alpha',
  'too high',
  'too low',
  'bad voice',
  'good voice',
  'voice score',
  'voice rating',
  'confidence score',
];

const TRANSCRIPT_KEY_PATTERN =
  /transcri|utterance|spokenText|recognisedText|recognizedText|words\b.*said|speechToText|asr/i;

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) collectKeys(item, out);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      collectKeys(item, out);
    }
  }
  return out;
}

describe('SAFETY — no voice-quality or appearance vocabulary anywhere', () => {
  const outputs = [
    computeVoiceMetrics({
      durationSeconds: 90,
      scriptWordCount: 300,
      pauses: [],
      speakingRatio: 1,
    }),
    computeVoiceMetrics({
      durationSeconds: 20,
      scriptWordCount: 200,
      pauses: [],
      speakingRatio: 0.3,
    }),
    computeVoiceMetrics({ durationSeconds: 300, scriptWordCount: 100 }),
    computeVoiceMetrics({
      durationSeconds: 120,
      pauses: [
        { startMs: 0, durationMs: 5000 },
        { startMs: 20000, durationMs: 600 },
      ],
      speakingRatio: 0.4,
      fillerTally: 30,
      selfRatedClarity: 1,
    }),
    buildFeedbackEntries({
      durationSeconds: 60,
      scriptWordCount: 150,
      pauses: [{ startMs: 0, durationMs: 900 }],
      speakingRatio: 0.7,
      fillerTally: 4,
      selfRatedClarity: 2,
    }),
  ];

  it('produces no forbidden vocabulary for any input, including extreme ones', () => {
    for (const output of outputs) {
      for (const text of collectStrings(output)) {
        const lower = text.toLowerCase();
        for (const banned of FORBIDDEN_VOCABULARY) {
          expect(lower.includes(banned), `"${banned}" found in: ${text}`).toBe(false);
        }
      }
    }
  });

  it('ships no forbidden vocabulary in the script library either', () => {
    for (const script of VOICE_SCRIPTS) {
      const lower = `${script.title} ${script.focus} ${script.text}`.toLowerCase();
      for (const banned of FORBIDDEN_VOCABULARY) {
        expect(lower.includes(banned), `"${banned}" in script ${script.id}`).toBe(false);
      }
    }
  });

  it('exposes no field that resembles a transcript', () => {
    for (const output of outputs) {
      for (const key of collectKeys(output)) {
        expect(TRANSCRIPT_KEY_PATTERN.test(key), `suspicious key: ${key}`).toBe(false);
      }
    }
  });

  it('never returns a score, grade or rating of the speaker', () => {
    for (const output of outputs) {
      for (const key of collectKeys(output)) {
        expect(/^(score|grade|rank|rating)$/i.test(key), `suspicious key: ${key}`).toBe(false);
      }
    }
    // The one rating that exists is explicitly the user's own, and is named so.
    const metrics = computeVoiceMetrics({ durationSeconds: 60, selfRatedClarity: 4 });
    expect(metrics.selfRatedClarity).toBe(4);
  });
});

describe('SAFETY — the voice tables hold no appearance or transcript column', () => {
  it('has no column name suggesting a transcript, score or body judgement', () => {
    // Read from the real schema objects, so adding such a column fails this test.
    const tables = {
      communicationGoals,
      voicePracticeSessions,
      voiceRecordings,
      communicationFeedback,
    };
    for (const [table, definition] of Object.entries(tables)) {
      const columns = Object.entries(getTableColumns(definition)).map(
        ([property, column]) => `${property} ${column.name}`,
      );
      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) {
        expect(TRANSCRIPT_KEY_PATTERN.test(column), `${table}.${column}`).toBe(false);
        expect(
          /attract|beaut|physique|bodyfat|body_fat|appearance|facial|\bscore\b|\bgrade\b/i.test(
            column,
          ),
          `${table}.${column}`,
        ).toBe(false);
      }
    }
  });

  it('constrains the feedback source to exactly the two honest values', () => {
    const column = getTableColumns(communicationFeedback).source;
    expect(column.enumValues).toEqual(['measured', 'self_reported']);
  });
});
