/**
 * Photo journal, check-ins and schedules, against a real database and real files.
 *
 * The assertions are about the things that would actually hurt someone: one user
 * reaching another's entry, check-in, schedule or photograph; "deleted" leaving the
 * encrypted bytes sitting on disk; and check-in reminders turning themselves on.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymos-journal-media-'));
process.env.GYMOS_MEDIA_PATH = mediaDir;

let account: typeof import('@/lib/services/account');
let media: typeof import('@/lib/services/media');
let journal: typeof import('@/lib/services/journal');
let equipment: typeof import('@/lib/services/equipment');
let crypto: typeof import('@/lib/media/crypto');
let dbClient: typeof import('@/lib/db/client');
let schema: typeof import('@/lib/db/schema');
let drizzle: typeof import('drizzle-orm');

let owner: string;
let stranger: string;
let minor: string;

/** A minimal, metadata-free JPEG. Enough to exercise the real storage pipeline. */
function jpeg(marker: number): Buffer {
  const dqtPayload = Buffer.alloc(64, marker);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(dqtPayload.length + 2, 0);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xdb]),
    length,
    dqtPayload,
    Buffer.from([0xff, 0xda, 0x00, 0x05, 0x01, 0x01, 0x00]),
    Buffer.from([marker, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function storePhoto(userId: string, marker = 0x11): string {
  return media.storeMedia(userId, 'pro', {
    kind: 'photo',
    mimeType: 'image/jpeg',
    bytes: jpeg(marker),
    consent: 'photo_journal',
  }).id;
}

function assetPathOnDisk(assetId: string): string | null {
  const row = dbClient.db
    .select({ storagePath: schema.privateMediaAssets.storagePath })
    .from(schema.privateMediaAssets)
    .where(drizzle.eq(schema.privateMediaAssets.id, assetId))
    .get();
  return row ? path.join(crypto.mediaRoot(), row.storagePath) : null;
}

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  media = await import('@/lib/services/media');
  journal = await import('@/lib/services/journal');
  equipment = await import('@/lib/services/equipment');
  crypto = await import('@/lib/media/crypto');
  dbClient = await import('@/lib/db/client');
  schema = await import('@/lib/db/schema');
  drizzle = await import('drizzle-orm');

  const makeUser = async (email: string, ageBand: 'adult_18_plus' | 'teen_13_17') => {
    const id = await account.registerUser({
      email,
      password: 'journal-long-enough-secret',
      acceptTerms: true,
    });
    account.upsertProfile(id, {
      displayName: email.split('@')[0] ?? 'Tester',
      ageBand,
      experience: 'some',
      trainingDays: [1, 3],
      sessionMinutes: 45,
    });
    account.devSetPlan(id, 'pro');
    return id;
  };

  owner = await makeUser('journal-owner@example.com', 'adult_18_plus');
  stranger = await makeUser('journal-stranger@example.com', 'adult_18_plus');
  minor = await makeUser('journal-minor@example.com', 'teen_13_17');

  account.setConsent(owner, 'photo_journal', true);
  account.setConsent(stranger, 'photo_journal', true);
}, 60_000);

afterAll(() => {
  temp.cleanup();
  fs.rmSync(mediaDir, { recursive: true, force: true });
});

describe('journal entries are isolated per user', () => {
  let entryId: string;

  it('creates an entry for its owner', () => {
    entryId = journal.createJournalEntry(owner, {
      date: '2026-10-20',
      category: 'training',
      title: 'Felt steady today',
      body: 'Slept well. Legs heavy at the start, fine by the third set.',
      tags: ['sleep', 'sleep', ' legs '],
    });
    const entry = journal.getJournalEntry(owner, entryId);
    expect(entry.title).toBe('Felt steady today');
    // Tags are de-duplicated and trimmed, not stored raw.
    expect(entry.tags).toEqual(['sleep', 'legs']);
  });

  it('refuses to read, update or delete it as another user', () => {
    expect(() => journal.getJournalEntry(stranger, entryId)).toThrow(equipment.NotFoundError);
    expect(() => journal.updateJournalEntry(stranger, entryId, { title: 'hijacked' })).toThrow(
      equipment.NotFoundError,
    );
    expect(() => journal.deleteJournalEntry(stranger, entryId)).toThrow(equipment.NotFoundError);
    // And the failed update changed nothing.
    expect(journal.getJournalEntry(owner, entryId).title).toBe('Felt steady today');
  });

  it('never lists it for another user', () => {
    expect(journal.listJournalEntries(stranger).map((e) => e.id)).not.toContain(entryId);
    expect(journal.listJournalEntries(owner).map((e) => e.id)).toContain(entryId);
  });

  it('requires some content rather than saving an empty row', () => {
    expect(() => journal.createJournalEntry(owner, { title: '   ', body: '' })).toThrow(
      account.ValidationError,
    );
  });

  it('rejects a malformed date instead of coercing it', () => {
    expect(() => journal.createJournalEntry(owner, { date: '20-10-2026', body: 'x' })).toThrow(
      account.ValidationError,
    );
  });
});

describe('check-ins are isolated per user', () => {
  let checkinId: string;
  let assetId: string;

  it('creates a check-in with the owner\'s own photo', () => {
    assetId = storePhoto(owner, 0x21);
    checkinId = journal.createPhotoCheckin(owner, {
      date: '2026-10-21',
      note: 'Morning, same light as last time.',
      photos: [{ assetId, view: 'front', caption: 'kitchen window' }],
    });
    const checkin = journal.getPhotoCheckin(owner, checkinId);
    expect(checkin.photos.map((p) => p.assetId)).toEqual([assetId]);
    expect(checkin.note).toBe('Morning, same light as last time.');
  });

  it('refuses to read or delete it as another user', () => {
    expect(() => journal.getPhotoCheckin(stranger, checkinId)).toThrow(equipment.NotFoundError);
    expect(() => journal.deletePhotoCheckin(stranger, checkinId)).toThrow(equipment.NotFoundError);
    expect(() => journal.updateCheckinNote(stranger, checkinId, 'hijacked')).toThrow(
      equipment.NotFoundError,
    );
    expect(() => journal.removeCheckinPhoto(stranger, checkinId, assetId)).toThrow(
      equipment.NotFoundError,
    );
    expect(journal.listPhotoCheckins(stranger).map((c) => c.id)).not.toContain(checkinId);
    // Nothing was removed by the attempts above.
    expect(journal.getPhotoCheckin(owner, checkinId).photos.length).toBe(1);
  });

  it('refuses to attach another user\'s asset to a check-in', () => {
    expect(() =>
      journal.createPhotoCheckin(stranger, {
        date: '2026-10-21',
        photos: [{ assetId, view: 'front' }],
      }),
    ).toThrow(equipment.NotFoundError);
    expect(
      dbClient.db
        .select()
        .from(schema.photoCheckinAssets)
        .where(drizzle.eq(schema.photoCheckinAssets.assetId, assetId))
        .all().length,
    ).toBe(1);
  });

  it('refuses to attach another user\'s asset to a journal entry', () => {
    expect(() =>
      journal.createJournalEntry(stranger, { body: 'trying it on', photos: [{ assetId }] }),
    ).toThrow(equipment.NotFoundError);
    // The rejected entry was not written either.
    expect(journal.listJournalEntries(stranger).some((e) => e.body === 'trying it on')).toBe(false);
  });

  it('refuses to attach an audio file as a check-in photo', () => {
    account.setConsent(owner, 'voice_recording', true);
    const audio = media.storeMedia(owner, 'pro', {
      kind: 'audio',
      mimeType: 'audio/webm',
      bytes: Buffer.from('not really audio but typed as such'),
      consent: 'voice_recording',
    });
    expect(() =>
      journal.createPhotoCheckin(owner, { date: '2026-10-21', photos: [{ assetId: audio.id }] }),
    ).toThrow(equipment.NotFoundError);
    media.deleteMedia(owner, audio.id, 'user_request');
  });

  it('refuses to read another user\'s asset bytes', () => {
    expect(() => media.readMedia(stranger, assetId)).toThrow(equipment.NotFoundError);
    expect(media.readMedia(owner, assetId).bytes.length).toBeGreaterThan(0);
  });

  it('requires at least one photo', () => {
    expect(() => journal.createPhotoCheckin(owner, { date: '2026-10-21', photos: [] })).toThrow(
      account.ValidationError,
    );
  });

  it('refuses an over-sized check-in rather than silently dropping photos', () => {
    const tooMany = Array.from({ length: journal.MAX_PHOTOS_PER_CHECKIN + 1 }, (_, i) => ({
      assetId: `placeholder-${i}`,
    }));
    expect(() =>
      journal.createPhotoCheckin(owner, { date: '2026-10-21', photos: tooMany }),
    ).toThrow(account.ValidationError);
  });

  it('de-duplicates the same photo rather than failing its unique index', () => {
    const dupe = storePhoto(owner, 0x71);
    const id = journal.createPhotoCheckin(owner, {
      date: '2026-10-25',
      photos: [{ assetId: dupe, view: 'front' }, { assetId: dupe, view: 'side' }],
    });
    expect(journal.getPhotoCheckin(owner, id).photos.length).toBe(1);
  });
});

describe('deleting a check-in really deletes the files', () => {
  it('removes the encrypted bytes from disk and writes a deletion event for each', () => {
    const first = storePhoto(owner, 0x31);
    const second = storePhoto(owner, 0x32);
    const checkinId = journal.createPhotoCheckin(owner, {
      date: '2026-10-22',
      note: 'two angles',
      photos: [
        { assetId: first, view: 'front' },
        { assetId: second, view: 'side' },
      ],
    });

    const firstPath = assetPathOnDisk(first);
    const secondPath = assetPathOnDisk(second);
    expect(firstPath).toBeTruthy();
    expect(secondPath).toBeTruthy();
    expect(fs.existsSync(firstPath!)).toBe(true);
    expect(fs.existsSync(secondPath!)).toBe(true);

    const deletionsBefore = media.listDeletionEvents(owner, 200).length;
    const result = journal.deletePhotoCheckin(owner, checkinId);

    expect(result.assetsDeleted).toBe(2);
    expect(result.filesRemoved).toBe(2);
    expect(fs.existsSync(firstPath!)).toBe(false);
    expect(fs.existsSync(secondPath!)).toBe(false);

    // The rows are gone, not tombstoned-and-forgotten.
    expect(() => journal.getPhotoCheckin(owner, checkinId)).toThrow(equipment.NotFoundError);
    expect(
      dbClient.db
        .select()
        .from(schema.photoCheckinAssets)
        .where(drizzle.inArray(schema.photoCheckinAssets.assetId, [first, second]))
        .all().length,
    ).toBe(0);
    expect(
      dbClient.db
        .select()
        .from(schema.privateMediaAssets)
        .where(drizzle.inArray(schema.privateMediaAssets.id, [first, second]))
        .all().length,
    ).toBe(0);

    // And the deletion is auditable.
    const events = media.listDeletionEvents(owner, 200);
    expect(events.length).toBe(deletionsBefore + 2);
    const relevant = events.filter((e) => e.assetId === first || e.assetId === second);
    expect(relevant.length).toBe(2);
    for (const event of relevant) {
      expect(event.reason).toBe('user_request');
      expect(event.fileRemoved).toBe(true);
      expect(event.bytesFreed).toBeGreaterThan(0);
    }
  });

  it('removes a single photo and its file without touching the rest of the check-in', () => {
    const keep = storePhoto(owner, 0x41);
    const drop = storePhoto(owner, 0x42);
    const checkinId = journal.createPhotoCheckin(owner, {
      date: '2026-10-23',
      photos: [{ assetId: keep }, { assetId: drop }],
    });
    const dropPath = assetPathOnDisk(drop)!;

    expect(journal.removeCheckinPhoto(owner, checkinId, drop).fileRemoved).toBe(true);
    expect(fs.existsSync(dropPath)).toBe(false);

    const checkin = journal.getPhotoCheckin(owner, checkinId);
    expect(checkin.photos.map((p) => p.assetId)).toEqual([keep]);
    expect(fs.existsSync(assetPathOnDisk(keep)!)).toBe(true);
  });

  it('deletes only the text when a journal entry is deleted', () => {
    const assetId = storePhoto(owner, 0x51);
    const entryId = journal.createJournalEntry(owner, {
      date: '2026-10-24',
      body: 'attached a photo today',
      photos: [{ assetId, view: 'front' }],
    });
    // Attaching a photo to an entry records it as a check-in for that date.
    const entry = journal.getJournalEntry(owner, entryId);
    expect(entry.photos.map((p) => p.assetId)).toEqual([assetId]);
    expect(journal.listPhotoCheckins(owner, { from: '2026-10-24', to: '2026-10-24' }).length).toBe(1);

    journal.deleteJournalEntry(owner, entryId);

    expect(() => journal.getJournalEntry(owner, entryId)).toThrow(equipment.NotFoundError);
    // The photograph survives: it is destroyed only when its check-in is.
    expect(fs.existsSync(assetPathOnDisk(assetId)!)).toBe(true);
    expect(media.ownsMedia(owner, assetId)).toBe(true);
  });
});

describe('check-in schedules', () => {
  it('defaults to off with no row stored at all', () => {
    const fresh = dbClient.db
      .select()
      .from(schema.checkinSchedules)
      .where(drizzle.eq(schema.checkinSchedules.userId, stranger))
      .all();
    expect(fresh.length).toBe(0);
    const schedule = journal.getCheckinSchedule(stranger);
    expect(schedule.cadence).toBe('off');
    expect(schedule.intervalDays).toBeNull();
    expect(journal.checkinOutlook(stranger).nextSuggestedDate).toBeNull();
    expect(journal.checkinOutlook(stranger).dueToday).toBe(false);
  });

  it('matches the column default declared in the schema', () => {
    expect(schema.CHECKIN_CADENCES[0]).toBe('off');
    expect(schema.checkinSchedules.cadence.default).toBe('off');
  });

  it('can be set, changed and set back to off', () => {
    journal.setCheckinSchedule(owner, { cadence: 'weekly', reminderTime: '08:30' });
    expect(journal.getCheckinSchedule(owner)).toMatchObject({
      cadence: 'weekly',
      intervalDays: 7,
      reminderTime: '08:30',
    });

    journal.setCheckinSchedule(owner, { cadence: 'custom', customDays: 21 });
    expect(journal.getCheckinSchedule(owner)).toMatchObject({
      cadence: 'custom',
      customDays: 21,
      intervalDays: 21,
    });

    journal.disableCheckins(owner);
    const off = journal.getCheckinSchedule(owner);
    expect(off.cadence).toBe('off');
    expect(off.customDays).toBeNull();
    expect(off.reminderTime).toBeNull();
    expect(off.intervalDays).toBeNull();
    expect(journal.checkinOutlook(owner).nextSuggestedDate).toBeNull();
  });

  it('validates cadence input instead of storing nonsense', () => {
    expect(() => journal.setCheckinSchedule(owner, { cadence: 'hourly' })).toThrow(
      account.ValidationError,
    );
    expect(() => journal.setCheckinSchedule(owner, { cadence: 'custom', customDays: 0 })).toThrow(
      account.ValidationError,
    );
    expect(() =>
      journal.setCheckinSchedule(owner, { cadence: 'weekly', reminderTime: '25:00' }),
    ).toThrow(account.ValidationError);
    expect(journal.getCheckinSchedule(owner).cadence).toBe('off');
  });

  it('keeps one user\'s cadence out of another user\'s schedule', () => {
    journal.setCheckinSchedule(owner, { cadence: 'monthly' });
    expect(journal.getCheckinSchedule(owner).cadence).toBe('monthly');
    expect(journal.getCheckinSchedule(stranger).cadence).toBe('off');
    journal.disableCheckins(owner);
  });
});

describe('under-18 accounts', () => {
  it('can keep a written journal with no photographs at all', () => {
    const entryId = journal.createJournalEntry(minor, {
      date: '2026-10-20',
      body: 'Trained with friends. Good session.',
    });
    expect(journal.getJournalEntry(minor, entryId).body).toContain('Good session');
    expect(journal.getCheckinSchedule(minor).cadence).toBe('off');
  });

  it('cannot store a photograph, so cannot create a photo check-in', () => {
    expect(() => storePhoto(minor)).toThrow(media.MediaPolicyError);
    expect(() =>
      journal.createPhotoCheckin(minor, { date: '2026-10-20', photos: [{ assetId: 'anything' }] }),
    ).toThrow(equipment.NotFoundError);
  });
});

describe('comparison exposes dates and nothing else', () => {
  it('returns only calendar arithmetic between two of the user\'s own check-ins', () => {
    const a = journal.createPhotoCheckin(owner, {
      date: '2026-09-01',
      photos: [{ assetId: storePhoto(owner, 0x61) }],
    });
    const b = journal.createPhotoCheckin(owner, {
      date: '2026-09-29',
      photos: [{ assetId: storePhoto(owner, 0x62) }],
    });

    const comparison = journal.comparePhotoCheckins(owner, b, a);
    expect(comparison.earlier.date).toBe('2026-09-01');
    expect(comparison.later.date).toBe('2026-09-29');
    expect(comparison.daysApart).toBe(28);
    expect(comparison.analysis).toBeNull();

    // Nothing resembling a score, rating or measurement is present anywhere in it.
    const keys = JSON.stringify(comparison).toLowerCase();
    for (const forbidden of ['score', 'rating', 'bodyfat', 'body_fat', 'attractive', 'grade']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('refuses to compare another user\'s check-ins', () => {
    const mine = journal.listPhotoCheckins(owner)[0]!;
    expect(() => journal.comparePhotoCheckins(stranger, mine.id, mine.id)).toThrow(
      equipment.NotFoundError,
    );
  });
});

describe('a journal entry shows only its own photographs', () => {
  it('keeps two entries written on the same date apart', () => {
    const firstPhoto = storePhoto(owner, 0x81);
    const secondPhoto = storePhoto(owner, 0x82);
    const first = journal.createJournalEntry(owner, {
      date: '2026-08-11',
      body: 'morning note',
      photos: [{ assetId: firstPhoto, view: 'front' }],
    });
    const second = journal.createJournalEntry(owner, {
      date: '2026-08-11',
      body: 'evening note',
      photos: [{ assetId: secondPhoto, view: 'side' }],
    });

    expect(journal.getJournalEntry(owner, first).photos.map((p) => p.assetId)).toEqual([firstPhoto]);
    expect(journal.getJournalEntry(owner, second).photos.map((p) => p.assetId)).toEqual([
      secondPhoto,
    ]);

    const listed = journal.listJournalEntries(owner, { from: '2026-08-11', to: '2026-08-11' });
    expect(listed.length).toBe(2);
    const byEntry = new Map(listed.map((entry) => [entry.id, entry.photos.map((p) => p.assetId)]));
    expect(byEntry.get(first)).toEqual([firstPhoto]);
    expect(byEntry.get(second)).toEqual([secondPhoto]);
  });

  it('does not borrow photographs from a separate check-in on the same date', () => {
    const entryPhoto = storePhoto(owner, 0x83);
    const checkinPhoto = storePhoto(owner, 0x84);
    const entryId = journal.createJournalEntry(owner, {
      date: '2026-08-12',
      body: 'wrote this one',
      photos: [{ assetId: entryPhoto }],
    });
    journal.createPhotoCheckin(owner, {
      date: '2026-08-12',
      photos: [{ assetId: checkinPhoto }],
    });

    expect(journal.getJournalEntry(owner, entryId).photos.map((p) => p.assetId)).toEqual([
      entryPhoto,
    ]);
    // Both are still the user's own photographs, and both are still reachable as
    // check-ins — only the entry's view of them is narrowed to its own.
    expect(
      journal
        .listPhotoCheckins(owner, { from: '2026-08-12', to: '2026-08-12' })
        .flatMap((checkin) => checkin.photos.map((p) => p.assetId))
        .sort(),
    ).toEqual([entryPhoto, checkinPhoto].sort());
  });

  it('shows no photographs at all on an entry that was saved without any', () => {
    const photo = storePhoto(owner, 0x85);
    journal.createJournalEntry(owner, {
      date: '2026-08-13',
      body: 'with a photo',
      photos: [{ assetId: photo }],
    });
    const textOnly = journal.createJournalEntry(owner, { date: '2026-08-13', body: 'just words' });
    expect(journal.getJournalEntry(owner, textOnly).photos).toEqual([]);
  });

  it("moves an entry's photographs with it when its date changes", () => {
    const photo = storePhoto(owner, 0x86);
    const entryId = journal.createJournalEntry(owner, {
      date: '2026-08-14',
      body: 'mis-dated',
      photos: [{ assetId: photo }],
    });

    journal.updateJournalEntry(owner, entryId, { date: '2026-08-15' });

    const entry = journal.getJournalEntry(owner, entryId);
    expect(entry.date).toBe('2026-08-15');
    expect(entry.photos.map((p) => p.assetId)).toEqual([photo]);
    // The photograph is filed under the date the entry now has, not the one it had.
    expect(entry.photos.map((p) => p.date)).toEqual(['2026-08-15']);
    expect(journal.listPhotoCheckins(owner, { from: '2026-08-14', to: '2026-08-14' }).length).toBe(
      0,
    );
  });
});

describe('journal reads return the reviewed shape and nothing more', () => {
  /**
   * The runtime half of the structural guard in tests/unit/journal-safety.test.ts.
   *
   * The unit suite pins the declared interfaces; this pins the objects that actually
   * come back from the database, so a fabricated metric cannot arrive on a read under
   * a name no wordlist would catch. Every key here is the user's own input, a date, a
   * file fact, or a count of rows they created.
   */
  it('pins every key of every read against real rows', () => {
    const photo = storePhoto(owner, 0x91);
    const entryId = journal.createJournalEntry(owner, {
      date: '2026-07-02',
      body: 'shape check',
      photos: [{ assetId: photo, view: 'front', caption: 'window light' }],
    });
    const checkinId = journal.createPhotoCheckin(owner, {
      date: '2026-07-03',
      note: 'second one',
      photos: [{ assetId: storePhoto(owner, 0x92) }],
    });

    const entry = journal.getJournalEntry(owner, entryId);
    expect(Object.keys(entry).sort()).toEqual(
      ['id', 'date', 'category', 'title', 'body', 'tags', 'createdAt', 'updatedAt', 'photos'].sort(),
    );
    expect(Object.keys(entry.photos[0]!).sort()).toEqual(
      ['assetId', 'checkinId', 'date', 'view', 'caption', 'mimeType', 'createdAt'].sort(),
    );
    expect(Object.keys(journal.listJournalEntries(owner, { limit: 1 })[0]!).sort()).toEqual(
      Object.keys(entry).sort(),
    );

    const checkin = journal.getPhotoCheckin(owner, checkinId);
    expect(Object.keys(checkin).sort()).toEqual(['id', 'date', 'note', 'createdAt', 'photos'].sort());
    expect(Object.keys(checkin.photos[0]!).sort()).toEqual(
      ['assetId', 'view', 'caption', 'mimeType', 'byteSize', 'createdAt'].sort(),
    );
    expect(Object.keys(journal.listPhotoCheckins(owner, { limit: 1 })[0]!).sort()).toEqual(
      Object.keys(checkin).sort(),
    );

    const comparison = journal.comparePhotoCheckins(owner, entryId, checkinId);
    expect(Object.keys(comparison).sort()).toEqual(
      ['earlier', 'later', 'daysApart', 'analysis'].sort(),
    );
    expect(comparison.analysis).toBeNull();
    expect(comparison.daysApart).toBe(1);

    expect(Object.keys(journal.getCheckinSchedule(owner)).sort()).toEqual(
      ['cadence', 'customDays', 'reminderTime', 'lastPromptedAt', 'updatedAt', 'intervalDays'].sort(),
    );
    expect(Object.keys(journal.checkinOutlook(owner)).sort()).toEqual(
      [
        'cadence',
        'intervalDays',
        'reminderTime',
        'lastCheckinDate',
        'nextSuggestedDate',
        'dueToday',
      ].sort(),
    );
    expect(Object.keys(journal.journalSummary(owner)).sort()).toEqual(
      ['entryCount', 'checkinCount', 'photoCount', 'lastEntryDate', 'lastCheckinDate'].sort(),
    );

    // Write results too: a count of rows and whether the bytes went, nothing else.
    const doomed = journal.createPhotoCheckin(owner, {
      date: '2026-07-04',
      photos: [{ assetId: storePhoto(owner, 0x93) }, { assetId: storePhoto(owner, 0x94) }],
    });
    const removal = journal.removeCheckinPhoto(
      owner,
      doomed,
      journal.getPhotoCheckin(owner, doomed).photos[0]!.assetId,
    );
    expect(Object.keys(removal)).toEqual(['fileRemoved']);
    expect(Object.keys(journal.deletePhotoCheckin(owner, doomed)).sort()).toEqual(
      ['assetsDeleted', 'filesRemoved'].sort(),
    );
  });
});
