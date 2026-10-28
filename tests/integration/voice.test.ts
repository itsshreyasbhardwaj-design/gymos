/**
 * Voice & Communication OS — authorisation, consent and the honesty contract,
 * exercised against a real SQLite database and the real media service.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymos-voice-media-'));
process.env.GYMOS_MEDIA_PATH = mediaDir;

let account: typeof import('@/lib/services/account');
let voice: typeof import('@/lib/services/voice');
let media: typeof import('@/lib/services/media');
let equipment: typeof import('@/lib/services/equipment');
let dbClient: typeof import('@/lib/db/client');
let schema: typeof import('@/lib/db/schema');
let drizzle: typeof import('drizzle-orm');
let scripts: typeof import('@/lib/content/voice-scripts');

let adultId: string;
let otherAdultId: string;
let noConsentId: string;
let minorId: string;
/** A second consenting adult, so cross-account purge isolation can be checked. */
let secondAdultId: string;

/** A short audio payload. Bytes only: nothing here is analysed or transcribed. */
const AUDIO_BYTES = Buffer.from('gymos-test-audio-payload-not-real-speech');

async function makeUser(email: string, ageBand: 'teen_13_17' | 'adult_18_plus'): Promise<string> {
  const id = await account.registerUser({
    email,
    password: 'voice-module-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(id, { displayName: email.split('@')[0] ?? 'Tester', ageBand });
  account.completeOnboarding(id);
  return id;
}

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  voice = await import('@/lib/services/voice');
  media = await import('@/lib/services/media');
  equipment = await import('@/lib/services/equipment');
  dbClient = await import('@/lib/db/client');
  schema = await import('@/lib/db/schema');
  drizzle = await import('drizzle-orm');
  scripts = await import('@/lib/content/voice-scripts');

  adultId = await makeUser('voice-adult@example.com', 'adult_18_plus');
  otherAdultId = await makeUser('voice-other@example.com', 'adult_18_plus');
  noConsentId = await makeUser('voice-noconsent@example.com', 'adult_18_plus');
  minorId = await makeUser('voice-minor@example.com', 'teen_13_17');
  secondAdultId = await makeUser('voice-second@example.com', 'adult_18_plus');

  account.devSetPlan(adultId, 'pro');
  account.setConsent(adultId, 'voice_recording', true);
  account.devSetPlan(secondAdultId, 'pro');
  account.setConsent(secondAdultId, 'voice_recording', true);
  // noConsentId and minorId deliberately keep voice recording off.
});

afterAll(() => {
  temp.cleanup();
  try {
    fs.rmSync(mediaDir, { recursive: true, force: true });
  } catch {
    // Best-effort.
  }
});

const readAloudScript = () => {
  const found = (
    scripts.VOICE_SCRIPTS as { id: string; mode: string; spokenWordCount: number | null }[]
  ).find((s) => s.mode === 'read_aloud' && s.spokenWordCount !== null);
  if (!found) throw new Error('fixture: no read-aloud script in the library');
  return found;
};

const promptScript = () => {
  const found = (scripts.VOICE_SCRIPTS as { id: string; mode: string }[]).find(
    (s) => s.mode === 'prompt',
  );
  if (!found) throw new Error('fixture: no prompt script in the library');
  return found;
};

/* ------------------------------------------------------------- capability */

describe('voice capability', () => {
  it('reports recording as available only for a consenting 18+ account', () => {
    expect(voice.voiceCapability(adultId)).toMatchObject({
      ageEligible: true,
      consentGranted: true,
      canRecord: true,
      reason: null,
    });

    const withoutConsent = voice.voiceCapability(noConsentId);
    expect(withoutConsent.canRecord).toBe(false);
    expect(withoutConsent.reason).toMatch(/Settings/i);

    const minor = voice.voiceCapability(minorId);
    expect(minor.canRecord).toBe(false);
    expect(minor.ageEligible).toBe(false);
    expect(minor.reason).toMatch(/18\+/);
    // The explanation must say the rest of the feature still works.
    expect(minor.reason).toMatch(/still/i);
  });
});

/* ------------------------------------------------------------- goals */

describe('communication goals are per-user', () => {
  it('never exposes, mutates or deletes another account’s goal', () => {
    const goalId = voice.createCommunicationGoal(adultId, 'Stop rushing the closing line');
    expect(voice.listCommunicationGoals(adultId).map((g) => g.id)).toContain(goalId);
    expect(voice.listCommunicationGoals(otherAdultId)).toHaveLength(0);

    expect(() => voice.setGoalActive(otherAdultId, goalId, false)).toThrow(equipment.NotFoundError);
    expect(() => voice.deleteCommunicationGoal(otherAdultId, goalId)).toThrow(
      equipment.NotFoundError,
    );
    // Still intact and still active after both attempts.
    expect(voice.listCommunicationGoals(adultId).find((g) => g.id === goalId)?.active).toBe(true);
  });

  it('refuses to attach a session to a goal the user does not own', () => {
    const goalId = voice.createCommunicationGoal(otherAdultId, 'Interview answers');
    expect(() => voice.startPracticeSession(adultId, { kind: 'interview', goalId })).toThrow(
      equipment.NotFoundError,
    );
  });

  it('validates the label', () => {
    expect(() => voice.createCommunicationGoal(adultId, '  a ')).toThrow(account.ValidationError);
  });
});

/* ------------------------------------------------------------- sessions */

describe('practice sessions are per-user', () => {
  it('isolates reads, writes and deletes', () => {
    const sessionId = voice.startPracticeSession(adultId, { kind: 'free_speaking' });
    voice.finishPracticeSession(adultId, sessionId, { durationSeconds: 60 });

    expect(voice.getPracticeSession(adultId, sessionId).session.id).toBe(sessionId);
    expect(() => voice.getPracticeSession(otherAdultId, sessionId)).toThrow(
      equipment.NotFoundError,
    );
    expect(() =>
      voice.finishPracticeSession(otherAdultId, sessionId, { durationSeconds: 10 }),
    ).toThrow(equipment.NotFoundError);
    expect(() => voice.deletePracticeSession(otherAdultId, sessionId)).toThrow(
      equipment.NotFoundError,
    );
    expect(voice.listPracticeSessions(otherAdultId).map((s) => s.id)).not.toContain(sessionId);

    // Unchanged by the failed cross-account write.
    expect(voice.getPracticeSession(adultId, sessionId).session.durationSeconds).toBe(60);
  });

  it('rejects an unknown script and an unknown kind', () => {
    expect(() =>
      voice.startPracticeSession(adultId, { kind: 'script_reading', scriptId: 'does-not-exist' }),
    ).toThrow(equipment.NotFoundError);
    expect(() =>
      voice.startPracticeSession(adultId, {
        kind: 'appearance_rating' as never,
      }),
    ).toThrow(account.ValidationError);
  });

  it('requires a real measured duration', () => {
    const sessionId = voice.startPracticeSession(adultId, { kind: 'free_speaking' });
    expect(() => voice.finishPracticeSession(adultId, sessionId, { durationSeconds: 0 })).toThrow(
      account.ValidationError,
    );
  });
});

/* -------------------------------------------------- the honesty contract */

describe('measured versus self-reported', () => {
  it('leaves words per minute null without a script of known length', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 120,
      fillerTally: 7,
    });
    const { session, feedback } = voice.getPracticeSession(adultId, sessionId);
    expect(session.wordsPerMinute).toBeNull();
    expect(session.scriptWordCount).toBeNull();
    expect(feedback.map((f) => f.metric)).not.toContain('words_per_minute');
  });

  it('leaves words per minute null for a prompt script, whose words are the user’s own', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'interview',
      scriptId: promptScript().id,
      durationSeconds: 90,
      readWholeScript: true,
    });
    expect(voice.getPracticeSession(adultId, sessionId).session.wordsPerMinute).toBeNull();
  });

  it('leaves words per minute null when the user did not confirm reading it all', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'script_reading',
      scriptId: readAloudScript().id,
      durationSeconds: 60,
      readWholeScript: false,
    });
    expect(voice.getPracticeSession(adultId, sessionId).session.wordsPerMinute).toBeNull();
  });

  it('computes words per minute server-side from the script, not from the caller', () => {
    const script = readAloudScript();
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'script_reading',
      scriptId: script.id,
      durationSeconds: 60,
      readWholeScript: true,
      // A caller cannot assert a rate: there is no field for it.
      wordsPerMinute: 999,
    } as never);
    const { session, feedback } = voice.getPracticeSession(adultId, sessionId);
    expect(session.scriptWordCount).toBe(script.spokenWordCount);
    expect(session.wordsPerMinute).toBe(script.spokenWordCount);
    const wpmEntry = feedback.find((f) => f.metric === 'words_per_minute');
    expect(wpmEntry?.source).toBe('measured');
    expect(wpmEntry?.observation).toMatch(/nothing was transcribed/i);
  });

  it('leaves the audio-derived columns null for a session with no recording', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'presentation',
      durationSeconds: 75,
      selfRatedClarity: 4,
    });
    const { session, feedback } = voice.getPracticeSession(adultId, sessionId);
    expect(session.pauseCount).toBeNull();
    expect(session.longestPauseMs).toBeNull();
    expect(session.speakingRatio).toBeNull();
    expect(feedback.find((f) => f.metric === 'duration')?.source).toBe('measured');
    expect(feedback.find((f) => f.metric === 'self_rated_clarity')?.source).toBe('self_reported');
  });

  it('stores browser-measured pauses and marks them measured', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 0,
      measurements: {
        pauses: [
          { startMs: 1000, durationMs: 900 },
          { startMs: 8000, durationMs: 4200 },
        ],
        speakingRatio: 0.72,
        durationSeconds: 30,
      },
      fillerTally: 3,
    });
    const { session, feedback } = voice.getPracticeSession(adultId, sessionId);
    expect(session.durationSeconds).toBe(30);
    expect(session.pauseCount).toBe(2);
    expect(session.longestPauseMs).toBe(4200);
    expect(session.speakingRatio).toBeCloseTo(0.72, 6);
    expect(feedback.find((f) => f.metric === 'pause_count')?.source).toBe('measured');
    expect(feedback.find((f) => f.metric === 'filler_tally')?.source).toBe('self_reported');
  });

  it('refuses an impossible analysis rather than clamping it into plausibility', () => {
    // A speaking ratio of 42 cannot come out of analyseAudioEnergy, so this payload
    // is not an analysis of real audio. Clamping it to 1 would put "100% speaking,
    // measured from your recording" in front of the user.
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 20,
      measurements: {
        pauses: [{ startMs: 0, durationMs: 500 }],
        speakingRatio: 42,
        durationSeconds: 20,
      },
      fillerTally: -5,
      selfRatedClarity: 99,
    });
    const { session, feedback } = voice.getPracticeSession(adultId, sessionId);
    expect(session.speakingRatio).toBeNull();
    expect(session.pauseCount).toBeNull();
    expect(session.longestPauseMs).toBeNull();
    // The take itself survives on the timer duration, which is measured.
    expect(session.durationSeconds).toBe(20);
    expect(feedback.map((f) => f.metric)).not.toContain('speaking_ratio');
    expect(feedback.map((f) => f.metric)).not.toContain('pause_count');
    // The same refusal applies to a self-reported value outside the range its own
    // control can produce: not counted, rather than pulled to the nearest legal
    // number. A tally of -5 clamped to 0 would be stored as a self-reported 0 —
    // "you tapped this during playback", with a value of 0 the user never tapped.
    expect(session.fillerTally).toBeNull();
    expect(session.selfRatedClarity).toBeNull();
    expect(feedback.map((f) => f.metric)).not.toContain('filler_tally');
    expect(feedback.map((f) => f.metric)).not.toContain('self_rated_clarity');
  });

  it('keeps a self-reported value that is in range, and drops one that is not', () => {
    // The boundary, both sides, for both self-reported fields. In range the number is
    // the user's own and is stored as given; out of range it was not reported on that
    // control at all, so it is null and no row claims they reported it.
    const kept = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 60,
      fillerTally: 0,
      selfRatedClarity: 1,
    });
    const keptSession = voice.getPracticeSession(adultId, kept.sessionId);
    // Zero taps is a real report: the user counted and heard none.
    expect(keptSession.session.fillerTally).toBe(0);
    expect(keptSession.session.selfRatedClarity).toBe(1);
    expect(keptSession.feedback.find((f) => f.metric === 'filler_tally')?.source).toBe(
      'self_reported',
    );

    for (const bad of [
      { why: 'negative tally', fillerTally: -1, selfRatedClarity: 3 },
      { why: 'fractional negative tally', fillerTally: -0.4, selfRatedClarity: 3 },
      { why: 'tally above the counter range', fillerTally: 2001, selfRatedClarity: 3 },
      { why: 'clarity below the 1-5 scale', fillerTally: 2, selfRatedClarity: 0 },
      { why: 'clarity above the 1-5 scale', fillerTally: 2, selfRatedClarity: 6 },
      { why: 'non-finite clarity', fillerTally: 2, selfRatedClarity: Number.NaN },
    ]) {
      const { sessionId } = voice.savePracticeSession(adultId, {
        kind: 'free_speaking',
        durationSeconds: 60,
        fillerTally: bad.fillerTally,
        selfRatedClarity: bad.selfRatedClarity,
      });
      const { session, feedback } = voice.getPracticeSession(adultId, sessionId);
      const tallyOk = bad.fillerTally >= 0 && bad.fillerTally <= 2000;
      const clarityOk =
        Number.isFinite(bad.selfRatedClarity) &&
        bad.selfRatedClarity >= 1 &&
        bad.selfRatedClarity <= 5;
      if (tallyOk) {
        expect(session.fillerTally, bad.why).toBe(Math.round(bad.fillerTally));
      } else {
        expect(session.fillerTally, bad.why).toBeNull();
        expect(
          feedback.map((f) => f.metric),
          bad.why,
        ).not.toContain('filler_tally');
      }
      if (clarityOk) {
        expect(session.selfRatedClarity, bad.why).toBe(Math.round(bad.selfRatedClarity));
      } else {
        expect(session.selfRatedClarity, bad.why).toBeNull();
        expect(
          feedback.map((f) => f.metric),
          bad.why,
        ).not.toContain('self_rated_clarity');
      }
    }
  });

  it('stores null, never 0, for an audio metric that was not measured', () => {
    // Each payload is unusable for a different reason. None of them may produce a
    // stored 0 that the UI would print as "0 pauses" or "0% speaking".
    const payloads: { why: string; measurements: unknown; timer: number }[] = [
      {
        why: 'non-finite speaking ratio',
        measurements: { pauses: [], speakingRatio: Number.NaN, durationSeconds: 30 },
        timer: 31,
      },
      {
        why: 'missing speaking ratio',
        measurements: { pauses: [], durationSeconds: 30 },
        timer: 32,
      },
      {
        why: 'non-finite duration',
        measurements: { pauses: [], speakingRatio: 0.8, durationSeconds: Number.POSITIVE_INFINITY },
        timer: 33,
      },
      {
        why: 'duration of zero',
        measurements: { pauses: [], speakingRatio: 0.8, durationSeconds: 0 },
        timer: 34,
      },
      {
        why: 'pauses that do not fit inside the take',
        measurements: {
          pauses: [{ startMs: 29_000, durationMs: 9_000 }],
          speakingRatio: 0.8,
          durationSeconds: 30,
        },
        timer: 35,
      },
      {
        why: 'a pause with a non-finite duration',
        measurements: {
          pauses: [{ startMs: 0, durationMs: Number.NaN }],
          speakingRatio: 0.8,
          durationSeconds: 30,
        },
        timer: 36,
      },
      {
        why: 'pauses that are not an array',
        measurements: { pauses: 'none', speakingRatio: 0.8, durationSeconds: 30 },
        timer: 37,
      },
    ];

    for (const { why, measurements, timer } of payloads) {
      const { sessionId } = voice.savePracticeSession(adultId, {
        kind: 'free_speaking',
        durationSeconds: timer,
        measurements: measurements as never,
      });
      const { session, feedback } = voice.getPracticeSession(adultId, sessionId);
      expect(session.speakingRatio, why).toBeNull();
      expect(session.pauseCount, why).toBeNull();
      expect(session.longestPauseMs, why).toBeNull();
      // And the duration is the timer's, not the number inside the rejected payload.
      expect(session.durationSeconds, why).toBe(timer);
      expect(feedback.find((f) => f.metric === 'duration')?.observation, why).toMatch(
        /practice timer/i,
      );
    }
  });

  it('says in the stored observation that an accepted analysis ran in the browser', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 30,
      measurements: {
        pauses: [{ startMs: 2000, durationMs: 800 }],
        speakingRatio: 0.66,
        durationSeconds: 30,
      },
    });
    const { feedback } = voice.getPracticeSession(adultId, sessionId);
    for (const metric of ['pause_count', 'speaking_ratio']) {
      const entry = feedback.find((f) => f.metric === metric);
      expect(entry?.source, metric).toBe('measured');
      expect(entry?.observation, metric).toMatch(/in your browser/i);
    }
  });

  it('records every feedback row with one of exactly two honest sources', () => {
    const { and, eq, inArray } = drizzle;
    const sessionIds = voice.listPracticeSessions(adultId, { limit: 500 }).map((s) => s.id);
    expect(sessionIds.length).toBeGreaterThan(3);
    const rows = dbClient.db
      .select({
        source: schema.communicationFeedback.source,
        metric: schema.communicationFeedback.metric,
      })
      .from(schema.communicationFeedback)
      .where(inArray(schema.communicationFeedback.sessionId, sessionIds))
      .all();
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(['measured', 'self_reported']).toContain(row.source);
    }
    // And the two buckets are both actually used, so the distinction is live.
    expect(rows.some((r) => r.source === 'measured')).toBe(true);
    expect(rows.some((r) => r.source === 'self_reported')).toBe(true);

    // Sanity: the ownership predicate really is in SQL for the join above.
    const foreign = dbClient.db
      .select({ id: schema.voicePracticeSessions.id })
      .from(schema.voicePracticeSessions)
      .where(
        and(
          inArray(schema.voicePracticeSessions.id, sessionIds),
          eq(schema.voicePracticeSessions.userId, otherAdultId),
        ),
      )
      .all();
    expect(foreign).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- feedback */

describe('feedback entries', () => {
  it('requires an explicit, honest source', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'conversation',
      durationSeconds: 40,
    });
    expect(() =>
      voice.addFeedback(adultId, sessionId, {
        metric: 'felt_rushed',
        source: 'inferred' as never,
      }),
    ).toThrow(account.ValidationError);

    const id = voice.addFeedback(adultId, sessionId, {
      metric: 'felt_rushed',
      source: 'self_reported',
      observation: 'The middle section ran away from me.',
    });
    expect(
      voice.getPracticeSession(adultId, sessionId).feedback.find((f) => f.id === id)?.source,
    ).toBe('self_reported');
  });

  it('refuses to store an appearance or voice-quality metric', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'conversation',
      durationSeconds: 40,
    });
    for (const metric of [
      'attractiveness',
      'voice quality',
      'looksmaxxing',
      'body fat',
      'overall score',
      'facial symmetry',
    ]) {
      expect(
        () => voice.addFeedback(adultId, sessionId, { metric, source: 'self_reported' }),
        metric,
      ).toThrow(account.ValidationError);
    }
  });

  /**
   * A note may not take a name the metrics engine writes for itself.
   *
   * /voice/history decides whether to offer a Remove button by asking whether the
   * row's metric is one of ENGINE_FEEDBACK_METRICS. A note called "duration" fails
   * that test, so it renders with no Remove button at all: a row the user wrote,
   * owns, and cannot delete from the UI — and one that the next save of the take
   * would quietly wipe, because the engine's rows are deleted and rewritten there.
   */
  it('refuses a note whose name collides with an engine metric name', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'conversation',
      durationSeconds: 40,
    });
    for (const metric of [
      'duration',
      'words_per_minute',
      'pause_count',
      'longest_pause',
      'speaking_ratio',
      'filler_tally',
      'self_rated_clarity',
      // The page prints the engine's names with spaces, so the spaced and
      // differently-cased spellings of one name have to collide too.
      'Duration',
      '  duration  ',
      'words per minute',
      'Speaking Ratio',
      'self-rated-clarity',
    ]) {
      expect(
        () => voice.addFeedback(adultId, sessionId, { metric, source: 'self_reported' }),
        metric,
      ).toThrow(account.ValidationError);
    }

    // The refusal says which names are reserved and why they are.
    let message = '';
    try {
      voice.addFeedback(adultId, sessionId, { metric: 'duration', source: 'self_reported' });
    } catch (err) {
      message = err instanceof Error ? err.message : '';
    }
    expect(message).toMatch(/duration/);
    expect(message).toMatch(/words_per_minute/);
    expect(message).toMatch(/rewritten|overwrit|wipe/i);
    expect(message).toMatch(/remove/i);

    // Nothing was stored under any of those names by the attempts above, so every
    // row the session holds for an engine metric is the engine's own.
    const rows = voice.getPracticeSession(adultId, sessionId).feedback;
    expect(rows.filter((f) => f.metric === 'duration')).toHaveLength(1);
    expect(rows.find((f) => f.metric === 'duration')?.source).toBe('measured');
    expect(rows.map((f) => f.metric)).not.toContain('words per minute');

    // A name of the user's own is still accepted, and is removable.
    const id = voice.addFeedback(adultId, sessionId, {
      metric: 'rushed the last line',
      source: 'self_reported',
    });
    voice.deleteFeedback(adultId, id);
  });

  it('is isolated per user', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'conversation',
      durationSeconds: 40,
    });
    expect(() =>
      voice.addFeedback(otherAdultId, sessionId, { metric: 'intrusion', source: 'self_reported' }),
    ).toThrow(equipment.NotFoundError);

    const id = voice.addFeedback(adultId, sessionId, {
      metric: 'own_note',
      source: 'self_reported',
    });
    expect(() => voice.deleteFeedback(otherAdultId, id)).toThrow(equipment.NotFoundError);
    voice.deleteFeedback(adultId, id);
    expect(voice.getPracticeSession(adultId, sessionId).feedback.map((f) => f.id)).not.toContain(
      id,
    );
  });
});

/* ------------------------------------------------------------ recordings */

describe('recordings are consent-gated and 18+ only', () => {
  it('refuses to save a recording when voice consent is off', () => {
    const { sessionId } = voice.savePracticeSession(noConsentId, {
      kind: 'free_speaking',
      durationSeconds: 30,
    });
    expect(() =>
      voice.attachRecording(noConsentId, 'free', sessionId, {
        bytes: AUDIO_BYTES,
        mimeType: 'audio/webm',
        durationSeconds: 30,
      }),
    ).toThrow(media.MediaPolicyError);

    // Nothing was written: no asset row, no recording row.
    expect(media.listMedia(noConsentId, 'audio')).toHaveLength(0);
    expect(voice.getPracticeSession(noConsentId, sessionId).recordings).toHaveLength(0);
  });

  it('refuses to save a recording for an under-18 account', () => {
    const { sessionId } = voice.savePracticeSession(minorId, {
      kind: 'script_reading',
      scriptId: readAloudScript().id,
      durationSeconds: 45,
      readWholeScript: true,
    });
    expect(() =>
      voice.attachRecording(minorId, 'free', sessionId, {
        bytes: AUDIO_BYTES,
        mimeType: 'audio/webm',
        durationSeconds: 45,
      }),
    ).toThrow(media.MediaPolicyError);
    expect(media.listMedia(minorId, 'audio')).toHaveLength(0);
  });

  it('keeps the rest of the feature working for an under-18 account', () => {
    const script = readAloudScript();
    const { sessionId } = voice.savePracticeSession(minorId, {
      kind: 'script_reading',
      scriptId: script.id,
      durationSeconds: 60,
      readWholeScript: true,
      fillerTally: 2,
      selfRatedClarity: 3,
      reflection: 'Slower on the numbers next time.',
    });
    const { session, feedback, recordings } = voice.getPracticeSession(minorId, sessionId);
    expect(session.durationSeconds).toBe(60);
    expect(session.wordsPerMinute).toBe(script.spokenWordCount);
    expect(recordings).toHaveLength(0);
    expect(feedback.length).toBeGreaterThan(1);
    expect(voice.progressSeries(minorId).totals.sessions).toBeGreaterThan(0);
  });

  it('rejects a non-audio mime type outright', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 20,
    });
    expect(() =>
      voice.attachRecording(adultId, 'pro', sessionId, {
        bytes: AUDIO_BYTES,
        mimeType: 'text/plain',
        durationSeconds: 20,
      }),
    ).toThrow(media.MediaPolicyError);
  });

  it('stores, isolates and truly deletes a recording for a consenting adult', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 25,
    });
    const { recordingId, assetId } = voice.attachRecording(adultId, 'pro', sessionId, {
      bytes: AUDIO_BYTES,
      mimeType: 'audio/webm',
      durationSeconds: 25,
    });

    const attached = voice.getPracticeSession(adultId, sessionId).recordings;
    expect(attached).toHaveLength(1);
    expect(attached[0]?.assetId).toBe(assetId);
    expect(voice.listPracticeSessions(adultId).find((s) => s.id === sessionId)?.hasRecording).toBe(
      true,
    );

    // The bytes come back only for the owner, through the media service.
    expect(media.readMedia(adultId, assetId).bytes.equals(AUDIO_BYTES)).toBe(true);
    expect(() => media.readMedia(otherAdultId, assetId)).toThrow(equipment.NotFoundError);

    // Another account can neither attach to nor delete this session's audio.
    expect(() =>
      voice.attachRecording(otherAdultId, 'pro', sessionId, {
        bytes: AUDIO_BYTES,
        mimeType: 'audio/webm',
        durationSeconds: 25,
      }),
    ).toThrow(equipment.NotFoundError);
    expect(() => voice.deleteRecording(otherAdultId, recordingId)).toThrow(equipment.NotFoundError);
    expect(voice.getPracticeSession(adultId, sessionId).recordings).toHaveLength(1);

    voice.deleteRecording(adultId, recordingId);
    expect(voice.getPracticeSession(adultId, sessionId).recordings).toHaveLength(0);
    expect(() => media.readMedia(adultId, assetId)).toThrow(equipment.NotFoundError);
  });

  it('destroys the audio when the session is deleted', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 25,
    });
    const { assetId } = voice.attachRecording(adultId, 'pro', sessionId, {
      bytes: AUDIO_BYTES,
      mimeType: 'audio/webm',
      durationSeconds: 25,
    });
    voice.deletePracticeSession(adultId, sessionId);
    expect(() => voice.getPracticeSession(adultId, sessionId)).toThrow(equipment.NotFoundError);
    expect(() => media.readMedia(adultId, assetId)).toThrow(equipment.NotFoundError);
  });

  it('destroys every recording when voice consent is withdrawn', () => {
    const { sessionId } = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 25,
    });
    voice.attachRecording(adultId, 'pro', sessionId, {
      bytes: AUDIO_BYTES,
      mimeType: 'audio/webm',
      durationSeconds: 25,
    });
    expect(media.listMedia(adultId, 'audio').length).toBeGreaterThan(0);

    account.setConsent(adultId, 'voice_recording', false);
    expect(media.listMedia(adultId, 'audio')).toHaveLength(0);
    // The practice record itself survives: only the audio was consented to.
    expect(voice.getPracticeSession(adultId, sessionId).session.durationSeconds).toBe(25);
    expect(voice.getPracticeSession(adultId, sessionId).recordings).toHaveLength(0);

    account.setConsent(adultId, 'voice_recording', true);
  });
});

/* ------------------------------- audio-derived analysis and the audio itself */

describe('an analysis never outlives the audio it came from', () => {
  /** Shaped like one analyseAudioEnergy result, so the service accepts it. */
  const ANALYSIS = {
    pauses: [
      { startMs: 1500, durationMs: 1200 },
      { startMs: 9000, durationMs: 3400 },
    ],
    speakingRatio: 0.58,
    durationSeconds: 24,
  };

  function takeWithRecording(userId: string): { sessionId: string; recordingId: string } {
    const { sessionId } = voice.savePracticeSession(userId, {
      kind: 'free_speaking',
      durationSeconds: 24,
      measurements: ANALYSIS,
      selfRatedClarity: 4,
      reflection: 'Kept the opening slower this time.',
    });
    const { recordingId } = voice.attachRecording(userId, 'pro', sessionId, {
      bytes: AUDIO_BYTES,
      mimeType: 'audio/webm',
      durationSeconds: 24,
    });
    // Precondition: the analysis really is stored before anything is deleted.
    const before = voice.getPracticeSession(userId, sessionId).session;
    expect(before.pauseCount).toBe(2);
    expect(before.longestPauseMs).toBe(3400);
    expect(before.speakingRatio).toBeCloseTo(0.58, 6);
    return { sessionId, recordingId };
  }

  it('clears the audio-derived columns and their feedback rows when the recording is deleted', () => {
    const { sessionId, recordingId } = takeWithRecording(adultId);
    voice.deleteRecording(adultId, recordingId);

    const { session, feedback } = voice.getPracticeSession(adultId, sessionId);
    expect(session.pauseCount).toBeNull();
    expect(session.longestPauseMs).toBeNull();
    expect(session.speakingRatio).toBeNull();
    for (const metric of ['pause_count', 'longest_pause', 'speaking_ratio']) {
      expect(
        feedback.map((f) => f.metric),
        metric,
      ).not.toContain(metric);
    }

    // What must survive: the take, its measured duration, the user's own words and
    // everything they reported themselves. Only audio-derived numbers go.
    expect(session.durationSeconds).toBe(24);
    expect(session.reflection).toBe('Kept the opening slower this time.');
    expect(session.selfRatedClarity).toBe(4);
    expect(feedback.find((f) => f.metric === 'duration')?.source).toBe('measured');
    expect(feedback.find((f) => f.metric === 'self_rated_clarity')?.source).toBe('self_reported');
  });

  it('clears them for every recording-less session of one account, and only that account', () => {
    const mine = takeWithRecording(adultId);
    const theirs = takeWithRecording(secondAdultId);

    // Both recordings destroyed the way consent withdrawal destroys them: through
    // the media service, which cascades the voice_recordings row away.
    media.deleteMedia(
      adultId,
      voice.getPracticeSession(adultId, mine.sessionId).recordings[0]?.assetId ?? '',
      'user_request',
    );
    media.deleteMedia(
      secondAdultId,
      voice.getPracticeSession(secondAdultId, theirs.sessionId).recordings[0]?.assetId ?? '',
      'user_request',
    );
    expect(voice.getPracticeSession(adultId, mine.sessionId).recordings).toHaveLength(0);

    const changed = voice.purgeAudioDerivedMetrics(adultId);
    expect(changed).toBeGreaterThan(0);
    expect(voice.getPracticeSession(adultId, mine.sessionId).session.speakingRatio).toBeNull();

    // The other account's orphaned analysis is untouched by my purge.
    const other = voice.getPracticeSession(secondAdultId, theirs.sessionId).session;
    expect(other.pauseCount).toBe(2);
    expect(other.speakingRatio).toBeCloseTo(0.58, 6);
    // And it is cleared by theirs.
    expect(voice.purgeAudioDerivedMetrics(secondAdultId)).toBeGreaterThan(0);
    expect(voice.getPracticeSession(secondAdultId, theirs.sessionId).session.pauseCount).toBeNull();
  });

  it('leaves a session alone while its recording is still there', () => {
    const { sessionId, recordingId } = takeWithRecording(adultId);
    expect(voice.purgeAudioDerivedMetrics(adultId, { sessionId })).toBe(0);
    expect(voice.getPracticeSession(adultId, sessionId).session.pauseCount).toBe(2);
    voice.deleteRecording(adultId, recordingId);
  });

  it('clears the analysis when voice consent is withdrawn, with no second call', () => {
    const { sessionId } = takeWithRecording(adultId);

    // Withdrawing the consent is the user asking for that audio material to go, so
    // the derived numbers go with it — and `setConsent` in lib/services/account.ts
    // calls purgeAudioDerivedMetrics itself. Deliberately NO purge call of our own
    // here: the point of this test is that the consent path does not need one.
    account.setConsent(adultId, 'voice_recording', false);
    expect(voice.getPracticeSession(adultId, sessionId).recordings).toHaveLength(0);

    const { session } = voice.getPracticeSession(adultId, sessionId);
    expect(session.pauseCount).toBeNull();
    expect(session.longestPauseMs).toBeNull();
    expect(session.speakingRatio).toBeNull();
    expect(session.durationSeconds).toBe(24);

    account.setConsent(adultId, 'voice_recording', true);
  });
});

/* ------------------------------------------------------------- progress */

describe('progress series', () => {
  it('reports only real rows and labels which metrics are which', () => {
    // One take that still has its recording, so a measured point exists in the
    // series no matter what the tests above deleted or purged. Without this the
    // "both shapes are present" assertions below could pass vacuously.
    const measured = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 22,
      measurements: {
        pauses: [{ startMs: 3000, durationMs: 1100 }],
        speakingRatio: 0.74,
        durationSeconds: 22,
      },
    });
    voice.attachRecording(adultId, 'pro', measured.sessionId, {
      bytes: AUDIO_BYTES,
      mimeType: 'audio/webm',
      durationSeconds: 22,
    });
    // And one take the user measured but chose NOT to store audio for: an accepted
    // browser analysis, no attachRecording. See the rule below.
    const measuredNoAudio = voice.savePracticeSession(adultId, {
      kind: 'free_speaking',
      durationSeconds: 19,
      measurements: {
        pauses: [{ startMs: 2000, durationMs: 850 }],
        speakingRatio: 0.63,
        durationSeconds: 19,
      },
    });
    // And one timer-only take, so the "both shapes are present" checks below rest on
    // this test's own three takes rather than on whatever earlier tests left behind.
    voice.savePracticeSession(adultId, { kind: 'free_speaking', durationSeconds: 31 });

    const progress = voice.progressSeries(adultId);
    expect(progress.points.length).toBe(progress.totals.sessions);
    expect(progress.measuredMetrics).toContain('words_per_minute');
    expect(progress.selfReportedMetrics).toContain('filler_tally');
    expect(progress.note).toMatch(/left out rather than estimated/i);

    /*
     * THE RULE for the three audio-derived numbers — pause count, longest pause and
     * speaking ratio — written down here because it is easy to state wrongly as "no
     * recording implies no audio-derived metrics", which is NOT what this app does
     * and not what it should do.
     *
     *  1. They come out of ONE browser-side analysis, so a point has all three or
     *     none. Never interpolated, carried forward or zero-filled: a point without
     *     an analysis is left empty.
     *  2. Computing them required audio; KEEPING the audio file is a separate
     *     choice. The numbers are the user's own record of their own practice, so a
     *     take they measured and chose not to store audio for legitimately keeps
     *     them. Measuring without storing is not a gap to be punished.
     *  3. What does remove them is the user asking for that audio material to go:
     *     deleting the recording (`deleteRecording` → `purgeAudioDerivedMetrics`)
     *     or withdrawing the voice_recording consent (`setConsent` in
     *     lib/services/account.ts, which calls `purgeAudioDerivedMetrics(userId)`;
     *     covered by tests/integration/media.test.ts). Destroying someone's audio
     *     while keeping a derived description of it is not a deletion.
     *
     * Rule 1 is the invariant swept below. Rules 2 and 3 are asserted explicitly,
     * because a sweep cannot distinguish them: the regression in rule 2 would make
     * every point 0-of-3 and the sweep would still pass.
     */
    for (const point of progress.points) {
      const audioMetrics = [point.speakingRatio, point.pauseCount, point.longestPauseMs];
      const measured = audioMetrics.filter((value) => value !== null).length;
      expect([0, 3], `${point.sessionId} has ${measured} of 3 audio metrics`).toContain(measured);
    }

    // Rule 2, pinned: measured, no stored recording, numbers kept.
    const kept = progress.points.find((p) => p.sessionId === measuredNoAudio.sessionId);
    expect(kept?.hasRecording).toBe(false);
    expect(kept?.pauseCount).toBe(1);
    expect(kept?.longestPauseMs).toBe(850);
    expect(kept?.speakingRatio).toBeCloseTo(0.63, 6);
    expect(kept?.durationSeconds).toBe(19);

    // Both shapes are actually present, so the loop above is not vacuous.
    expect(progress.points.some((p) => p.speakingRatio === null)).toBe(true);
    expect(progress.points.some((p) => p.speakingRatio !== null)).toBe(true);
    expect(progress.points.some((p) => p.wordsPerMinute === null)).toBe(true);
    expect(progress.totals.sessionsWithRecording).toBeLessThanOrEqual(progress.totals.sessions);
    // A measured point that holds no audio exists, so "has a recording" and "has
    // audio-derived numbers" really are different sets in this series.
    expect(
      progress.points.filter((p) => p.speakingRatio !== null && !p.hasRecording).length,
    ).toBeGreaterThan(0);

    // Oldest first.
    const dates = progress.points.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('drops a point’s audio metrics once its recording is deleted', () => {
    const { sessionId } = voice.savePracticeSession(secondAdultId, {
      kind: 'free_speaking',
      durationSeconds: 18,
      measurements: {
        pauses: [{ startMs: 500, durationMs: 700 }],
        speakingRatio: 0.91,
        durationSeconds: 18,
      },
    });
    const { recordingId } = voice.attachRecording(secondAdultId, 'pro', sessionId, {
      bytes: AUDIO_BYTES,
      mimeType: 'audio/webm',
      durationSeconds: 18,
    });

    const before = voice
      .progressSeries(secondAdultId)
      .points.find((p) => p.sessionId === sessionId);
    expect(before?.pauseCount).toBe(1);
    expect(before?.speakingRatio).toBeCloseTo(0.91, 6);
    expect(before?.hasRecording).toBe(true);

    voice.deleteRecording(secondAdultId, recordingId);

    const after = voice.progressSeries(secondAdultId).points.find((p) => p.sessionId === sessionId);
    expect(after?.hasRecording).toBe(false);
    expect(after?.pauseCount).toBeNull();
    expect(after?.longestPauseMs).toBeNull();
    expect(after?.speakingRatio).toBeNull();
    // The point is still in the series: the practice happened and was timed.
    expect(after?.durationSeconds).toBe(18);
  });

  it('shows another account nothing', () => {
    const fresh = voice.progressSeries(otherAdultId);
    expect(fresh.points).toHaveLength(0);
    expect(fresh.totals.sessions).toBe(0);
  });
});
