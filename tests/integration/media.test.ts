/**
 * The private-media pipeline, end to end against a real database and real files.
 *
 * This is the security surface for the wellness modules, so the assertions are about
 * the things that would actually hurt someone: bytes readable on disk, metadata left
 * in a photograph, one user reading another's file, and "deleted" meaning the file is
 * still there.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymos-media-'));
process.env.GYMOS_MEDIA_PATH = mediaDir;

let account: typeof import('@/lib/services/account');
let media: typeof import('@/lib/services/media');
let crypto: typeof import('@/lib/media/crypto');
let strip: typeof import('@/lib/media/strip-metadata');
let dbClient: typeof import('@/lib/db/client');
let schema: typeof import('@/lib/db/schema');
let drizzle: typeof import('drizzle-orm');

let adult: string;
let other: string;
let minor: string;

/** A JPEG skeleton carrying an EXIF APP1 block and a comment, both of which must go. */
function jpegWithMetadata(): Buffer {
  const exifPayload = Buffer.concat([
    Buffer.from('Exif\0\0', 'ascii'),
    Buffer.from('MM\0*', 'ascii'),
    Buffer.from('GPSLatitude 12.9716 GPSLongitude 77.5946 Make SecretPhone', 'ascii'),
  ]);
  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    lengthOf(exifPayload),
    exifPayload,
  ]);
  const comment = Buffer.from('personal note that should not survive', 'ascii');
  const com = Buffer.concat([Buffer.from([0xff, 0xfe]), lengthOf(comment), comment]);
  const dqtPayload = Buffer.alloc(64, 0x10);
  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb]), lengthOf(dqtPayload), dqtPayload]);
  const sosHeader = Buffer.from([0x01, 0x01, 0x00]);
  const sos = Buffer.concat([Buffer.from([0xff, 0xda]), lengthOf(sosHeader), sosHeader]);
  const scan = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    com,
    dqt,
    sos,
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function lengthOf(payload: Buffer): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(payload.length + 2, 0);
  return b;
}

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  media = await import('@/lib/services/media');
  crypto = await import('@/lib/media/crypto');
  strip = await import('@/lib/media/strip-metadata');
  dbClient = await import('@/lib/db/client');
  schema = await import('@/lib/db/schema');
  drizzle = await import('drizzle-orm');

  const makeUser = async (email: string, ageBand: 'adult_18_plus' | 'teen_13_17') => {
    const id = await account.registerUser({ email, password: 'a-long-enough-secret', acceptTerms: true });
    account.upsertProfile(id, {
      displayName: email.split('@')[0] ?? 'Tester',
      ageBand,
      experience: 'some',
      trainingDays: [1, 3],
      sessionMinutes: 45,
    });
    return id;
  };

  adult = await makeUser('media-adult@example.com', 'adult_18_plus');
  other = await makeUser('media-other@example.com', 'adult_18_plus');
  minor = await makeUser('media-minor@example.com', 'teen_13_17');

  account.setConsent(adult, 'photo_journal', true);
  account.setConsent(adult, 'voice_recording', true);
  account.setConsent(other, 'photo_journal', true);
});

afterAll(() => {
  temp.cleanup();
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

describe('metadata stripping', () => {
  it('removes EXIF and comment blocks from a JPEG', () => {
    const input = jpegWithMetadata();
    expect(input.includes(Buffer.from('GPSLatitude'))).toBe(true);

    const result = strip.stripImageMetadata(input);
    expect(result.format).toBe('jpeg');
    expect(result.stripped).toBe(true);
    expect(result.removedBlocks.length).toBeGreaterThan(0);
    expect(result.bytes.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('SecretPhone'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('personal note'))).toBe(false);
    // The actual image data survives.
    expect(result.bytes.includes(Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true);
    expect(result.bytesRemoved).toBeGreaterThan(0);
  });

  it('leaves a file with no metadata byte-identical, and says nothing was removed', () => {
    const once = strip.stripImageMetadata(jpegWithMetadata()).bytes;
    const twice = strip.stripImageMetadata(once);
    expect(twice.bytes.equals(once)).toBe(true);
    // The honest answer on a clean file is "nothing to remove", not "stripped".
    expect(twice.stripped).toBe(false);
    expect(twice.removedBlocks).toEqual([]);
    expect(twice.bytesRemoved).toBe(0);
  });

  it('strips ID3 tags from an MP3 and leaves the frames alone', () => {
    const id3v2Body = Buffer.from('TPE1 Real Name TCOM private comment', 'ascii');
    const header = Buffer.alloc(10);
    header.write('ID3', 0, 'ascii');
    header[3] = 3;
    const size = id3v2Body.length;
    header[6] = (size >> 21) & 0x7f;
    header[7] = (size >> 14) & 0x7f;
    header[8] = (size >> 7) & 0x7f;
    header[9] = size & 0x7f;
    const frames = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x11, 0x22]);
    const id3v1 = Buffer.alloc(128);
    id3v1.write('TAG', 0, 'ascii');
    id3v1.write('A private title', 3, 'ascii');

    const input = Buffer.concat([header, id3v2Body, frames, id3v1]);
    const result = strip.stripAudioMetadata(input, 'audio/mpeg');

    expect(result.format).toBe('mpeg');
    expect(result.stripped).toBe(true);
    expect(result.removedBlocks.sort()).toEqual(['ID3v1', 'ID3v2']);
    expect(result.bytes.equals(frames)).toBe(true);
    expect(result.bytes.includes(Buffer.from('Real Name'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('A private title'))).toBe(false);
  });

  it('does not claim to have cleaned a container it does not understand', () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03]);
    const result = strip.stripAudioMetadata(webm, 'audio/webm');
    expect(result.stripped).toBe(false);
    expect(result.format).toBe('unknown');
    expect(result.bytes.equals(webm)).toBe(true);
  });
});

describe('storing media', () => {
  it('writes ciphertext to disk, not the photograph', () => {
    const stored = media.storeMedia(adult, 'free', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      originalFilename: 'IMG_0001.jpg',
      consent: 'photo_journal',
    });

    const row = dbClient.db
      .select()
      .from(schema.privateMediaAssets)
      .where(drizzle.eq(schema.privateMediaAssets.id, stored.id))
      .get();
    expect(row).toBeTruthy();

    const onDisk = fs.readFileSync(path.join(mediaDir, row!.storagePath));
    expect(onDisk.includes(Buffer.from('GPSLatitude'))).toBe(false);
    expect(onDisk.includes(Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(false);
    expect(onDisk.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(false);

    // And it comes back intact through the service.
    const read = media.readMedia(adult, stored.id);
    expect(read.mimeType).toBe('image/jpeg');
    expect(read.bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(stored.metadataStripped).toBe(true);
    expect(stored.removedBlocks).toContain('COM');
  });

  it('records the stripped size, not the uploaded size', () => {
    const raw = jpegWithMetadata();
    const stored = media.storeMedia(adult, 'free', {
      kind: 'photo',
      mimeType: 'image/png',
      bytes: Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', Buffer.alloc(13)),
        pngChunk('tEXt', Buffer.from('Comment\0private', 'ascii')),
        pngChunk('IEND', Buffer.alloc(0)),
      ]),
      consent: 'photo_journal',
    });
    const read = media.readMedia(adult, stored.id);
    expect(read.bytes.includes(Buffer.from('private'))).toBe(false);
    expect(stored.byteSize).toBe(read.bytes.length);
    expect(raw.length).toBeGreaterThan(0);
  });

  it('refuses a type it does not accept', () => {
    expect(() =>
      media.storeMedia(adult, 'free', {
        kind: 'photo',
        mimeType: 'image/svg+xml',
        bytes: Buffer.from('<svg onload="alert(1)"/>'),
        consent: 'photo_journal',
      }),
    ).toThrow(/not an accepted/i);
  });

  it('refuses an empty file', () => {
    expect(() =>
      media.storeMedia(adult, 'free', {
        kind: 'audio',
        mimeType: 'audio/webm',
        bytes: Buffer.alloc(0),
        consent: 'voice_recording',
      }),
    ).toThrow(/empty/i);
  });
});

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

describe('age and consent gating', () => {
  it('refuses photo capture for an under-18 account', () => {
    expect(() =>
      media.storeMedia(minor, 'pro', {
        kind: 'photo',
        mimeType: 'image/jpeg',
        bytes: jpegWithMetadata(),
        consent: 'photo_journal',
      }),
    ).toThrow(/18\+/);
  });

  it('refuses to grant a media consent to an under-18 account at all', () => {
    expect(() => account.setConsent(minor, 'photo_journal', true)).toThrow(/under-18/i);
  });

  it('refuses an upload when the consent is off', () => {
    expect(() =>
      media.storeMedia(adult, 'free', {
        kind: 'audio',
        mimeType: 'audio/webm',
        bytes: Buffer.from('fake audio bytes'),
        consent: 'voice_recording',
      }),
    ).not.toThrow();

    account.setConsent(adult, 'voice_recording', false);
    expect(() =>
      media.storeMedia(adult, 'free', {
        kind: 'audio',
        mimeType: 'audio/webm',
        bytes: Buffer.from('fake audio bytes'),
        consent: 'voice_recording',
      }),
    ).toThrow(/Turn on voice recording/i);
    account.setConsent(adult, 'voice_recording', true);
  });

  it('destroys the media collected under a consent when it is withdrawn', () => {
    const stored = media.storeMedia(adult, 'pro', {
      kind: 'audio',
      mimeType: 'audio/webm',
      bytes: Buffer.from('a recording that must not survive revocation'),
      consent: 'voice_recording',
    });
    const row = dbClient.db
      .select()
      .from(schema.privateMediaAssets)
      .where(drizzle.eq(schema.privateMediaAssets.id, stored.id))
      .get();
    const file = path.join(mediaDir, row!.storagePath);
    expect(fs.existsSync(file)).toBe(true);

    account.setConsent(adult, 'voice_recording', false);

    expect(fs.existsSync(file)).toBe(false);
    expect(
      dbClient.db
        .select()
        .from(schema.privateMediaAssets)
        .where(drizzle.eq(schema.privateMediaAssets.id, stored.id))
        .get(),
    ).toBeUndefined();
    const events = media.listDeletionEvents(adult);
    expect(events.some((e) => e.assetId === stored.id && e.reason === 'consent_withdrawn')).toBe(true);

    account.setConsent(adult, 'voice_recording', true);
  });
});

describe('withdrawing a consent takes what was derived from the media too', () => {
  it('clears the audio-derived analysis when voice recording is switched off', async () => {
    const voice = await import('@/lib/services/voice');

    account.setConsent(adult, 'voice_recording', true);
    const saved = voice.savePracticeSession(adult, {
      kind: 'script_reading',
      date: new Date().toISOString().slice(0, 10),
      // The stopwatch value the recorder always sends, and the browser analysis the
      // service may accept or reject independently of it.
      durationSeconds: 40,
      measurements: {
        durationSeconds: 40,
        pauses: [{ startMs: 2_000, durationMs: 700 }],
        speakingRatio: 0.62,
      },
    });

    const before = dbClient.db
      .select()
      .from(schema.voicePracticeSessions)
      .where(drizzle.eq(schema.voicePracticeSessions.id, saved.sessionId))
      .get();
    expect(before?.pauseCount).toBe(1);
    expect(before?.speakingRatio).toBeCloseTo(0.62, 2);

    // Switching the consent off is the user saying the recordings should go. The numbers
    // taken from those recordings have to go with them.
    account.setConsent(adult, 'voice_recording', false);

    const after = dbClient.db
      .select()
      .from(schema.voicePracticeSessions)
      .where(drizzle.eq(schema.voicePracticeSessions.id, saved.sessionId))
      .get();
    expect(after?.pauseCount).toBeNull();
    expect(after?.longestPauseMs).toBeNull();
    expect(after?.speakingRatio).toBeNull();

    // And the feedback rows that asserted those measurements are gone too.
    const metrics = dbClient.db
      .select({ metric: schema.communicationFeedback.metric })
      .from(schema.communicationFeedback)
      .where(drizzle.eq(schema.communicationFeedback.sessionId, saved.sessionId))
      .all()
      .map((r) => r.metric);
    expect(metrics).not.toContain('pause_count');
    expect(metrics).not.toContain('longest_pause');
    expect(metrics).not.toContain('speaking_ratio');

    // What the user recorded about their own practice survives: the take is still there.
    expect(after).toBeTruthy();
    expect(after?.durationSeconds).toBe(40);

    account.setConsent(adult, 'voice_recording', true);
  });

  it('leaves another account\'s analysis alone', async () => {
    const voice = await import('@/lib/services/voice');
    account.setConsent(other, 'voice_recording', true);
    const theirs = voice.savePracticeSession(other, {
      kind: 'script_reading',
      date: new Date().toISOString().slice(0, 10),
      durationSeconds: 30,
      measurements: {
        durationSeconds: 30,
        pauses: [{ startMs: 1_000, durationMs: 400 }],
        speakingRatio: 0.5,
      },
    });

    account.setConsent(adult, 'voice_recording', false);

    const untouched = dbClient.db
      .select()
      .from(schema.voicePracticeSessions)
      .where(drizzle.eq(schema.voicePracticeSessions.id, theirs.sessionId))
      .get();
    expect(untouched?.pauseCount).toBe(1);

    account.setConsent(adult, 'voice_recording', true);
  });
});

describe('ownership', () => {
  let assetId: string;

  beforeAll(() => {
    assetId = media.storeMedia(adult, 'pro', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      consent: 'photo_journal',
    }).id;
  });

  it('refuses a read by another user, and says nothing about whether the id exists', () => {
    let ownError: unknown;
    try {
      media.readMedia(other, assetId);
    } catch (err) {
      ownError = err;
    }
    let missingError: unknown;
    try {
      media.readMedia(other, 'an-id-that-was-never-issued');
    } catch (err) {
      missingError = err;
    }
    expect((ownError as Error).message).toBe((missingError as Error).message);
  });

  it('refuses a delete by another user', () => {
    expect(() => media.deleteMedia(other, assetId, 'user_request')).toThrow();
    expect(media.readMedia(adult, assetId).bytes.length).toBeGreaterThan(0);
  });

  it('does not list another user\'s files', () => {
    expect(media.listMedia(other).some((a) => a.id === assetId)).toBe(false);
    expect(media.listMedia(adult).some((a) => a.id === assetId)).toBe(true);
  });

  it('reports usage per user', () => {
    const mine = media.mediaUsage(adult);
    expect(mine.count).toBeGreaterThan(0);
    expect(mine.bytes).toBeGreaterThan(0);
    expect(media.mediaUsage(other).count).toBe(0);
  });
});

describe('sharing', () => {
  it('lets a grant open one file and a revoke close it again', () => {
    const asset = media.storeMedia(adult, 'pro', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      consent: 'photo_journal',
    });
    expect(() => media.readMedia(other, asset.id)).toThrow();

    const grantId = media.grantMediaAccess(adult, asset.id, other, { reason: 'showing a friend' });
    expect(media.readMedia(other, asset.id).bytes.length).toBeGreaterThan(0);

    media.revokeMediaAccess(adult, grantId);
    expect(() => media.readMedia(other, asset.id)).toThrow();
  });

  it('treats an expired grant as closed', () => {
    const asset = media.storeMedia(adult, 'pro', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      consent: 'photo_journal',
    });
    media.grantMediaAccess(adult, asset.id, other, {
      reason: 'briefly',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expect(() => media.readMedia(other, asset.id)).toThrow();
  });

  it('refuses to grant access to a file you do not own', () => {
    const asset = media.storeMedia(adult, 'pro', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      consent: 'photo_journal',
    });
    expect(() => media.grantMediaAccess(other, asset.id, adult, {})).toThrow();
  });

  it('revokes every open grant at once', () => {
    const asset = media.storeMedia(adult, 'pro', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      consent: 'photo_journal',
    });
    media.grantMediaAccess(adult, asset.id, other, {});
    expect(media.revokeAllGrants(adult)).toBeGreaterThan(0);
    expect(() => media.readMedia(other, asset.id)).toThrow();
  });
});

describe('deletion is real', () => {
  it('removes the file from disk and records an auditable event', () => {
    const asset = media.storeMedia(adult, 'pro', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      consent: 'photo_journal',
    });
    const row = dbClient.db
      .select()
      .from(schema.privateMediaAssets)
      .where(drizzle.eq(schema.privateMediaAssets.id, asset.id))
      .get();
    const file = path.join(mediaDir, row!.storagePath);
    expect(fs.existsSync(file)).toBe(true);

    expect(media.deleteMedia(adult, asset.id, 'user_request')).toBe(true);
    expect(fs.existsSync(file)).toBe(false);

    const event = media.listDeletionEvents(adult).find((e) => e.assetId === asset.id);
    expect(event?.reason).toBe('user_request');
    expect(event?.fileRemoved).toBe(true);
    expect(event?.bytesFreed).toBeGreaterThan(0);
    expect(() => media.readMedia(adult, asset.id)).toThrow();
  });

  it('takes every file with the account', async () => {
    const doomed = await account.registerUser({
      email: 'media-doomed@example.com',
      password: 'another-long-secret',
      acceptTerms: true,
    });
    account.upsertProfile(doomed, {
      displayName: 'Doomed',
      ageBand: 'adult_18_plus',
      experience: 'some',
      trainingDays: [2],
      sessionMinutes: 30,
    });
    account.setConsent(doomed, 'photo_journal', true);
    const asset = media.storeMedia(doomed, 'pro', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      consent: 'photo_journal',
    });
    const row = dbClient.db
      .select()
      .from(schema.privateMediaAssets)
      .where(drizzle.eq(schema.privateMediaAssets.id, asset.id))
      .get();
    const file = path.join(mediaDir, row!.storagePath);
    expect(fs.existsSync(file)).toBe(true);

    account.deleteAccount(doomed);

    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(mediaDir, doomed))).toBe(false);
  });
});

describe('integrity', () => {
  it('refuses to serve a file that was altered on disk', () => {
    const asset = media.storeMedia(adult, 'pro', {
      kind: 'photo',
      mimeType: 'image/jpeg',
      bytes: jpegWithMetadata(),
      consent: 'photo_journal',
    });
    const row = dbClient.db
      .select()
      .from(schema.privateMediaAssets)
      .where(drizzle.eq(schema.privateMediaAssets.id, asset.id))
      .get();
    const file = path.join(mediaDir, row!.storagePath);

    const bytes = fs.readFileSync(file);
    bytes[0] = bytes[0]! ^ 0xff;
    fs.writeFileSync(file, bytes);

    expect(() => media.readMedia(adult, asset.id)).toThrow(crypto.MediaIntegrityError);
  });

  it('reports honestly that this install uses a development key', () => {
    // No GYMOS_MEDIA_KEY is set in the test environment, so this must be true rather
    // than quietly claiming production-grade key management.
    expect(media.isDevelopmentKey()).toBe(true);
  });
});

describe('entitlement limits', () => {
  it('stops a free account at its file allowance and names the limit', async () => {
    const capped = await account.registerUser({
      email: `media-capped-${randomUUID().slice(0, 8)}@example.com`,
      password: 'yet-another-long-secret',
      acceptTerms: true,
    });
    account.upsertProfile(capped, {
      displayName: 'Capped',
      ageBand: 'adult_18_plus',
      experience: 'some',
      trainingDays: [4],
      sessionMinutes: 30,
    });
    account.setConsent(capped, 'photo_journal', true);

    const limit = 25;
    for (let i = 0; i < limit; i += 1) {
      media.storeMedia(capped, 'free', {
        kind: 'photo',
        mimeType: 'image/jpeg',
        bytes: jpegWithMetadata(),
        consent: 'photo_journal',
      });
    }
    expect(media.mediaUsage(capped).count).toBe(limit);
    expect(() =>
      media.storeMedia(capped, 'free', {
        kind: 'photo',
        mimeType: 'image/jpeg',
        bytes: jpegWithMetadata(),
        consent: 'photo_journal',
      }),
    ).toThrow();
    // Pro lifts it rather than blocking the data itself.
    expect(() =>
      media.storeMedia(capped, 'pro', {
        kind: 'photo',
        mimeType: 'image/jpeg',
        bytes: jpegWithMetadata(),
        consent: 'photo_journal',
      }),
    ).not.toThrow();
  });
});
