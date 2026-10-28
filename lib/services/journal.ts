import 'server-only';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  personalJournalEntries,
  photoCheckins,
  photoCheckinAssets,
  checkinSchedules,
  privateMediaAssets,
  CHECKIN_CADENCES,
  PHOTO_VIEWS,
} from '@/lib/db/schema';
import { newId } from '@/lib/auth/ids';
import { NotFoundError } from './equipment';
import { ValidationError } from './account';
import { deleteMedia, listMedia } from './media';

/* ==========================================================================
 * Personal photo journal and check-ins.
 *
 * This is a diary, not an analyser. GymOS stores the user's own words and the
 * user's own photographs so that THEY can look back at them. Nothing in this
 * module derives, infers, scores, ranks or grades anything from a photograph:
 * there is no appearance score, no attractiveness rating, no body-fat estimate,
 * no comparison against an ideal and no skin diagnosis. The only numbers it
 * produces are calendar arithmetic (how many days apart two check-ins are) and
 * counts of rows the user created.
 *
 * Every photograph is written and destroyed through lib/services/media.ts, which
 * owns the 18+ rule, the consent gate, metadata stripping, encryption and the
 * auditable deletion event. This module never touches private_media_assets as a
 * writer and never builds a URL for a file.
 * ========================================================================== */

export type CheckinCadence = (typeof CHECKIN_CADENCES)[number];
export type PhotoView = (typeof PHOTO_VIEWS)[number];

/** Suggested categories. The column is free text, so a user's own label also works. */
export const JOURNAL_CATEGORIES = [
  'general',
  'training',
  'nutrition',
  'skin',
  'grooming',
  'sleep',
  'mood',
] as const;

export const CADENCE_LABELS: Record<CheckinCadence, string> = {
  off: 'Off — no check-in reminders',
  weekly: 'Every week',
  fortnightly: 'Every two weeks',
  monthly: 'Every month',
  custom: 'Every N days',
};

export const PHOTO_VIEW_LABELS: Record<PhotoView, string> = {
  front: 'Front',
  side: 'Side',
  back: 'Back',
  skin: 'Skin',
  other: 'Other',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertDate(value: string, field = 'date'): string {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new ValidationError('Use a date like 2026-10-27.', field);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = raw.trim().slice(0, 24);
    if (tag) seen.add(tag);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/**
 * Checks photo ownership through the media service only.
 *
 * `listMedia` already scopes to the owner, excludes tombstoned rows and filters by
 * kind, so an id that is not in that set is either someone else's or not a photo.
 * The error text is deliberately the same in both cases: a user learns nothing
 * about whether another account's id exists.
 */
function assertOwnedPhotos(userId: string, assetIds: string[]): void {
  if (assetIds.length === 0) return;
  const owned = new Set(listMedia(userId, 'photo').map((asset) => asset.id));
  for (const assetId of assetIds) {
    if (!owned.has(assetId)) throw new NotFoundError('That photo does not exist.');
  }
}

/* ------------------------------------------------------------ journal entries */

export interface JournalPhotoRef {
  assetId: string;
  view?: PhotoView;
  caption?: string;
}

export interface JournalEntryInput {
  date?: string;
  category?: string;
  title?: string;
  body?: string;
  tags?: string[];
  /**
   * Ids of photographs the user already uploaded through POST /api/media.
   *
   * `personal_journal_entries` has no asset column, so attached photographs are
   * stored as a photo check-in. That is deliberate: it keeps one place where a
   * photograph can live, so deleting it really deletes it, and the photographs
   * attached to a journal entry are the same ones the comparison view shows.
   *
   * That check-in belongs to this entry alone — see `createJournalEntry`.
   */
  photos?: JournalPhotoRef[];
}

export interface JournalPhotoView {
  assetId: string;
  checkinId: string;
  date: string;
  view: PhotoView;
  caption: string;
  mimeType: string;
  createdAt: string;
}

export interface JournalEntryView {
  id: string;
  date: string;
  category: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** The photographs attached to THIS entry. Nothing is computed from them. */
  photos: JournalPhotoView[];
}

export function createJournalEntry(userId: string, input: JournalEntryInput): string {
  const date = assertDate(input.date ?? todayIso());
  const title = (input.title ?? '').trim().slice(0, 120);
  const body = (input.body ?? '').trim().slice(0, 5000);
  if (!title && !body) {
    throw new ValidationError('Write a title or a note before saving.', 'body');
  }

  const photos = dedupePhotos(input.photos ?? []);
  assertOwnedPhotos(userId, photos.map((p) => p.assetId));

  const id = newId();
  // The entry's photographs go into ONE check-in that carries the entry's own id, so
  // `photo_checkins.id = <entry id>` is this entry's photo set and nobody else's.
  // Resolving them by (user, date) instead made two entries written on the same day
  // each display the other's photographs, and pulled in any unrelated check-in from
  // that date as well. The schema has no checkin_id column on an entry, and the id
  // columns are ours to choose, so the link is the id itself.
  const rows = photos.length > 0 ? buildCheckinRows(userId, date, '', photos, id) : null;

  db.transaction((tx) => {
    tx.insert(personalJournalEntries)
      .values({
        id,
        userId,
        date,
        category: (input.category ?? 'general').trim().slice(0, 40) || 'general',
        title,
        body,
        tags: cleanTags(input.tags),
      })
      .run();
    if (rows) {
      tx.insert(photoCheckins).values(rows.checkin).run();
      for (const assetRow of rows.assetRows) tx.insert(photoCheckinAssets).values(assetRow).run();
    }
  });
  return id;
}

export function updateJournalEntry(
  userId: string,
  entryId: string,
  input: Omit<JournalEntryInput, 'photos'>,
): void {
  const existing = db
    .select()
    .from(personalJournalEntries)
    .where(and(eq(personalJournalEntries.id, entryId), eq(personalJournalEntries.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That journal entry does not exist.');

  const title = (input.title ?? existing.title).trim().slice(0, 120);
  const body = (input.body ?? existing.body).trim().slice(0, 5000);
  if (!title && !body) {
    throw new ValidationError('Write a title or a note before saving.', 'body');
  }

  const date = input.date ? assertDate(input.date) : existing.date;

  db.update(personalJournalEntries)
    .set({
      date,
      category: input.category ? input.category.trim().slice(0, 40) : existing.category,
      title,
      body,
      tags: input.tags ? cleanTags(input.tags) : existing.tags,
      updatedAt: nowIso(),
    })
    .where(and(eq(personalJournalEntries.id, entryId), eq(personalJournalEntries.userId, userId)))
    .run();

  if (date !== existing.date) {
    // The entry's photographs live in the check-in carrying the entry's id, so moving
    // the entry moves them with it rather than leaving them filed under a date the
    // entry no longer has. No file is touched: only the date written beside it.
    db.update(photoCheckins)
      .set({ date })
      .where(and(eq(photoCheckins.id, entryId), eq(photoCheckins.userId, userId)))
      .run();
  }
}

/**
 * Deletes the text entry only.
 *
 * Photographs are never destroyed as a side effect of tidying up notes — they are
 * removed from their check-in, which states plainly that the files go with it.
 */
export function deleteJournalEntry(userId: string, entryId: string): void {
  const existing = db
    .select({ id: personalJournalEntries.id })
    .from(personalJournalEntries)
    .where(and(eq(personalJournalEntries.id, entryId), eq(personalJournalEntries.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That journal entry does not exist.');
  db.delete(personalJournalEntries)
    .where(and(eq(personalJournalEntries.id, entryId), eq(personalJournalEntries.userId, userId)))
    .run();
}

export function getJournalEntry(userId: string, entryId: string): JournalEntryView {
  const row = db
    .select()
    .from(personalJournalEntries)
    .where(and(eq(personalJournalEntries.id, entryId), eq(personalJournalEntries.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That journal entry does not exist.');
  const photos = journalPhotos(userId, [row.id]);
  return {
    id: row.id,
    date: row.date,
    category: row.category,
    title: row.title,
    body: row.body,
    tags: row.tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    photos: photos.get(row.id) ?? [],
  };
}

export function listJournalEntries(
  userId: string,
  opts: { from?: string; to?: string; category?: string; limit?: number } = {},
): JournalEntryView[] {
  const clauses = [eq(personalJournalEntries.userId, userId)];
  if (opts.from) clauses.push(gte(personalJournalEntries.date, assertDate(opts.from, 'from')));
  if (opts.to) clauses.push(lte(personalJournalEntries.date, assertDate(opts.to, 'to')));
  if (opts.category) clauses.push(eq(personalJournalEntries.category, opts.category));

  const rows = db
    .select()
    .from(personalJournalEntries)
    .where(and(...clauses))
    .orderBy(desc(personalJournalEntries.date), desc(personalJournalEntries.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
    .all();

  const photos = journalPhotos(
    userId,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    category: row.category,
    title: row.title,
    body: row.body,
    tags: row.tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    photos: photos.get(row.id) ?? [],
  }));
}

/**
 * The photographs attached to each of the given journal entries, keyed by entry id.
 *
 * `createJournalEntry` writes an entry's photographs into a check-in whose id IS the
 * entry's id, so this reads exactly the entry's own photo set: never a sibling entry's
 * from the same date, and never a check-in the user made separately. Ownership is
 * asserted on both joined tables, in the SQL predicate.
 */
function journalPhotos(userId: string, entryIds: string[]): Map<string, JournalPhotoView[]> {
  const map = new Map<string, JournalPhotoView[]>();
  if (entryIds.length === 0) return map;
  const rows = db
    .select({
      assetId: photoCheckinAssets.assetId,
      checkinId: photoCheckins.id,
      date: photoCheckins.date,
      view: photoCheckinAssets.view,
      caption: photoCheckinAssets.caption,
      mimeType: privateMediaAssets.mimeType,
      createdAt: privateMediaAssets.createdAt,
    })
    .from(photoCheckinAssets)
    .innerJoin(photoCheckins, eq(photoCheckins.id, photoCheckinAssets.checkinId))
    .innerJoin(privateMediaAssets, eq(privateMediaAssets.id, photoCheckinAssets.assetId))
    .where(
      and(
        eq(photoCheckins.userId, userId),
        eq(privateMediaAssets.userId, userId),
        inArray(photoCheckins.id, entryIds),
      ),
    )
    .orderBy(privateMediaAssets.createdAt)
    .all();
  for (const row of rows) {
    const list = map.get(row.checkinId) ?? [];
    list.push(row);
    map.set(row.checkinId, list);
  }
  return map;
}

/* --------------------------------------------------------------- check-ins */

export interface CheckinInput {
  date?: string;
  /** The user's own words. GymOS adds no observation of its own. */
  note?: string;
  photos: JournalPhotoRef[];
}

export interface CheckinPhotoView {
  assetId: string;
  view: PhotoView;
  caption: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

export interface CheckinView {
  id: string;
  date: string;
  note: string;
  createdAt: string;
  photos: CheckinPhotoView[];
}

export const MAX_PHOTOS_PER_CHECKIN = 12;

function dedupePhotos(photos: JournalPhotoRef[]): Required<JournalPhotoRef>[] {
  const seen = new Set<string>();
  const out: Required<JournalPhotoRef>[] = [];
  for (const photo of photos) {
    const assetId = photo.assetId.trim();
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    out.push({
      assetId,
      view: PHOTO_VIEWS.includes(photo.view ?? 'other') ? (photo.view ?? 'other') : 'other',
      caption: (photo.caption ?? '').trim().slice(0, 200),
    });
  }
  // Refused rather than silently truncated: quietly dropping someone's photographs
  // while reporting success would be a lie about what was saved.
  if (out.length > MAX_PHOTOS_PER_CHECKIN) {
    throw new ValidationError(
      `A check-in holds up to ${MAX_PHOTOS_PER_CHECKIN} photos. Save the rest as a second check-in.`,
      'photos',
    );
  }
  return out;
}

function buildCheckinRows(
  userId: string,
  date: string,
  note: string,
  photos: Required<JournalPhotoRef>[],
  /** A journal entry passes its own id so the check-in it creates belongs to it alone. */
  checkinId: string = newId(),
) {
  return {
    checkinId,
    checkin: { id: checkinId, userId, date, note },
    assetRows: photos.map((photo) => ({
      id: newId(),
      checkinId,
      assetId: photo.assetId,
      view: photo.view,
      caption: photo.caption,
    })),
  };
}

/**
 * Records a check-in: one or more of the user's own photographs, plus the user's
 * own note. No analysis is performed and none is stored.
 */
export function createPhotoCheckin(userId: string, input: CheckinInput): string {
  const date = assertDate(input.date ?? todayIso());
  const photos = dedupePhotos(input.photos);
  if (photos.length === 0) {
    throw new ValidationError('Add at least one photo to save a check-in.', 'photos');
  }
  assertOwnedPhotos(userId, photos.map((p) => p.assetId));

  const rows = buildCheckinRows(userId, date, (input.note ?? '').trim().slice(0, 2000), photos);
  db.transaction((tx) => {
    tx.insert(photoCheckins).values(rows.checkin).run();
    for (const assetRow of rows.assetRows) tx.insert(photoCheckinAssets).values(assetRow).run();
  });
  return rows.checkinId;
}

export function getPhotoCheckin(userId: string, checkinId: string): CheckinView {
  const checkin = db
    .select()
    .from(photoCheckins)
    .where(and(eq(photoCheckins.id, checkinId), eq(photoCheckins.userId, userId)))
    .get();
  if (!checkin) throw new NotFoundError('That check-in does not exist.');
  return {
    id: checkin.id,
    date: checkin.date,
    note: checkin.note,
    createdAt: checkin.createdAt,
    photos: checkinPhotos(userId, [checkin.id]).get(checkin.id) ?? [],
  };
}

export function listPhotoCheckins(
  userId: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): CheckinView[] {
  const clauses = [eq(photoCheckins.userId, userId)];
  if (opts.from) clauses.push(gte(photoCheckins.date, assertDate(opts.from, 'from')));
  if (opts.to) clauses.push(lte(photoCheckins.date, assertDate(opts.to, 'to')));

  const rows = db
    .select()
    .from(photoCheckins)
    .where(and(...clauses))
    .orderBy(desc(photoCheckins.date), desc(photoCheckins.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 60, 1), 365))
    .all();

  const photos = checkinPhotos(
    userId,
    rows.map((r) => r.id),
  );
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    note: row.note,
    createdAt: row.createdAt,
    photos: photos.get(row.id) ?? [],
  }));
}

/** Child rows are only ever reached through a parent the SQL predicate proves is the user's. */
function checkinPhotos(userId: string, checkinIds: string[]): Map<string, CheckinPhotoView[]> {
  const map = new Map<string, CheckinPhotoView[]>();
  if (checkinIds.length === 0) return map;
  const rows = db
    .select({
      checkinId: photoCheckinAssets.checkinId,
      assetId: photoCheckinAssets.assetId,
      view: photoCheckinAssets.view,
      caption: photoCheckinAssets.caption,
      mimeType: privateMediaAssets.mimeType,
      byteSize: privateMediaAssets.byteSize,
      createdAt: privateMediaAssets.createdAt,
    })
    .from(photoCheckinAssets)
    .innerJoin(photoCheckins, eq(photoCheckins.id, photoCheckinAssets.checkinId))
    .innerJoin(privateMediaAssets, eq(privateMediaAssets.id, photoCheckinAssets.assetId))
    .where(
      and(
        eq(photoCheckins.userId, userId),
        eq(privateMediaAssets.userId, userId),
        inArray(photoCheckinAssets.checkinId, checkinIds),
      ),
    )
    .orderBy(privateMediaAssets.createdAt)
    .all();
  for (const row of rows) {
    const list = map.get(row.checkinId) ?? [];
    list.push({
      assetId: row.assetId,
      view: row.view,
      caption: row.caption,
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      createdAt: row.createdAt,
    });
    map.set(row.checkinId, list);
  }
  return map;
}

export function updateCheckinNote(userId: string, checkinId: string, note: string): void {
  const existing = db
    .select({ id: photoCheckins.id })
    .from(photoCheckins)
    .where(and(eq(photoCheckins.id, checkinId), eq(photoCheckins.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That check-in does not exist.');
  db.update(photoCheckins)
    .set({ note: note.trim().slice(0, 2000) })
    .where(and(eq(photoCheckins.id, checkinId), eq(photoCheckins.userId, userId)))
    .run();
}

/**
 * Deletes a check-in AND the photographs in it.
 *
 * Each file goes through the media service, so the encrypted bytes are removed from
 * disk and a deletion event is written for every one. The check-in row is removed
 * last, so a failure part way through leaves a smaller check-in rather than a
 * check-in pointing at files that are gone.
 */
export function deletePhotoCheckin(
  userId: string,
  checkinId: string,
): { assetsDeleted: number; filesRemoved: number } {
  const checkin = db
    .select({ id: photoCheckins.id })
    .from(photoCheckins)
    .where(and(eq(photoCheckins.id, checkinId), eq(photoCheckins.userId, userId)))
    .get();
  if (!checkin) throw new NotFoundError('That check-in does not exist.');

  const assetIds = db
    .select({ assetId: photoCheckinAssets.assetId })
    .from(photoCheckinAssets)
    .innerJoin(photoCheckins, eq(photoCheckins.id, photoCheckinAssets.checkinId))
    .where(and(eq(photoCheckinAssets.checkinId, checkinId), eq(photoCheckins.userId, userId)))
    .all()
    .map((r) => r.assetId);

  let filesRemoved = 0;
  for (const assetId of assetIds) {
    if (deleteMedia(userId, assetId, 'user_request')) filesRemoved += 1;
  }

  db.delete(photoCheckins)
    .where(and(eq(photoCheckins.id, checkinId), eq(photoCheckins.userId, userId)))
    .run();

  return { assetsDeleted: assetIds.length, filesRemoved };
}

/** Removes one photograph from a check-in, destroying the file with it. */
export function removeCheckinPhoto(
  userId: string,
  checkinId: string,
  assetId: string,
): { fileRemoved: boolean } {
  const row = db
    .select({ id: photoCheckinAssets.id })
    .from(photoCheckinAssets)
    .innerJoin(photoCheckins, eq(photoCheckins.id, photoCheckinAssets.checkinId))
    .where(
      and(
        eq(photoCheckinAssets.checkinId, checkinId),
        eq(photoCheckinAssets.assetId, assetId),
        eq(photoCheckins.userId, userId),
      ),
    )
    .get();
  if (!row) throw new NotFoundError('That photo does not exist.');
  // Deleting the asset cascades the join row; the media service removes the file
  // and writes the deletion event.
  return { fileRemoved: deleteMedia(userId, assetId, 'user_request') };
}

export interface CheckinComparison {
  earlier: CheckinView;
  later: CheckinView;
  daysApart: number;
  /** Stated in the UI verbatim. There is no automated analysis of these photographs. */
  analysis: null;
}

/**
 * Puts two of the user's own check-ins side by side.
 *
 * `daysApart` is calendar arithmetic on the dates the user chose. Nothing is
 * measured, scored, ranked or inferred from the images, and `analysis` is null to
 * make that explicit to every caller.
 */
export function comparePhotoCheckins(
  userId: string,
  firstId: string,
  secondId: string,
): CheckinComparison {
  const a = getPhotoCheckin(userId, firstId);
  const b = getPhotoCheckin(userId, secondId);
  const [earlier, later] = a.date <= b.date ? [a, b] : [b, a];
  const daysApart = Math.round(
    Math.abs(Date.parse(`${later.date}T00:00:00.000Z`) - Date.parse(`${earlier.date}T00:00:00.000Z`)) /
      DAY_MS,
  );
  return { earlier, later, daysApart, analysis: null };
}

/* -------------------------------------------------------------- schedules */

export interface CheckinScheduleView {
  cadence: CheckinCadence;
  customDays: number | null;
  reminderTime: string | null;
  lastPromptedAt: string | null;
  updatedAt: string | null;
  /** Days between suggested check-ins, or null when check-ins are off. */
  intervalDays: number | null;
}

function intervalFor(cadence: CheckinCadence, customDays: number | null): number | null {
  switch (cadence) {
    case 'weekly':
      return 7;
    case 'fortnightly':
      return 14;
    case 'monthly':
      return 30;
    case 'custom':
      return customDays && customDays > 0 ? customDays : null;
    case 'off':
    default:
      return null;
  }
}

/**
 * Check-ins are opt-in: with no row stored the cadence is 'off', which is also the
 * column default. There is no path in this module that turns them on by itself.
 */
export function getCheckinSchedule(userId: string): CheckinScheduleView {
  const row = db
    .select()
    .from(checkinSchedules)
    .where(eq(checkinSchedules.userId, userId))
    .get();
  if (!row) {
    return {
      cadence: 'off',
      customDays: null,
      reminderTime: null,
      lastPromptedAt: null,
      updatedAt: null,
      intervalDays: null,
    };
  }
  return {
    cadence: row.cadence,
    customDays: row.customDays,
    reminderTime: row.reminderTime,
    lastPromptedAt: row.lastPromptedAt,
    updatedAt: row.updatedAt,
    intervalDays: intervalFor(row.cadence, row.customDays),
  };
}

export function setCheckinSchedule(
  userId: string,
  input: { cadence: string; customDays?: number | null; reminderTime?: string | null },
): void {
  if (!(CHECKIN_CADENCES as readonly string[]).includes(input.cadence)) {
    throw new ValidationError('Pick one of the listed cadences.', 'cadence');
  }
  const cadence = input.cadence as CheckinCadence;

  let customDays: number | null = null;
  if (cadence === 'custom') {
    const days = Number(input.customDays);
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      throw new ValidationError('Choose between 1 and 365 days.', 'customDays');
    }
    customDays = Math.round(days);
  }

  let reminderTime: string | null = null;
  if (cadence !== 'off' && input.reminderTime) {
    if (!TIME_RE.test(input.reminderTime)) {
      throw new ValidationError('Use a 24-hour time like 08:30.', 'reminderTime');
    }
    reminderTime = input.reminderTime;
  }

  const updatedAt = nowIso();
  db.insert(checkinSchedules)
    .values({ userId, cadence, customDays, reminderTime, updatedAt })
    .onConflictDoUpdate({
      target: checkinSchedules.userId,
      set: { cadence, customDays, reminderTime, updatedAt },
    })
    .run();
}

/** One call for the user's "turn this off" control. Always available. */
export function disableCheckins(userId: string): void {
  setCheckinSchedule(userId, { cadence: 'off' });
}

export interface CheckinOutlook {
  cadence: CheckinCadence;
  intervalDays: number | null;
  reminderTime: string | null;
  lastCheckinDate: string | null;
  /** null when check-ins are off, or when there is nothing to count from yet. */
  nextSuggestedDate: string | null;
  dueToday: boolean;
}

/**
 * When the next check-in would fall, if the user asked for a cadence.
 *
 * Deliberately neutral: a date that has passed is simply due, and nothing here
 * counts missed check-ins or produces a streak.
 */
export function checkinOutlook(userId: string, today = todayIso()): CheckinOutlook {
  const schedule = getCheckinSchedule(userId);
  const last = db
    .select({ date: photoCheckins.date })
    .from(photoCheckins)
    .where(eq(photoCheckins.userId, userId))
    .orderBy(desc(photoCheckins.date))
    .get();
  const lastCheckinDate = last?.date ?? null;

  if (!schedule.intervalDays) {
    return {
      cadence: schedule.cadence,
      intervalDays: null,
      reminderTime: schedule.reminderTime,
      lastCheckinDate,
      nextSuggestedDate: null,
      dueToday: false,
    };
  }

  const from = lastCheckinDate ?? today;
  const next = new Date(Date.parse(`${from}T00:00:00.000Z`) + schedule.intervalDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
  return {
    cadence: schedule.cadence,
    intervalDays: schedule.intervalDays,
    reminderTime: schedule.reminderTime,
    lastCheckinDate,
    nextSuggestedDate: lastCheckinDate ? next : today,
    dueToday: lastCheckinDate ? next <= today : true,
  };
}

/* ----------------------------------------------------------------- summary */

export interface JournalSummary {
  entryCount: number;
  checkinCount: number;
  photoCount: number;
  lastEntryDate: string | null;
  lastCheckinDate: string | null;
}

export function journalSummary(userId: string): JournalSummary {
  const entries = db
    .select({
      count: sql<number>`count(*)`,
      last: sql<string | null>`max(${personalJournalEntries.date})`,
    })
    .from(personalJournalEntries)
    .where(eq(personalJournalEntries.userId, userId))
    .all();
  const checkins = db
    .select({
      count: sql<number>`count(*)`,
      last: sql<string | null>`max(${photoCheckins.date})`,
    })
    .from(photoCheckins)
    .where(eq(photoCheckins.userId, userId))
    .all();
  const photos = db
    .select({ count: sql<number>`count(*)` })
    .from(photoCheckinAssets)
    .innerJoin(photoCheckins, eq(photoCheckins.id, photoCheckinAssets.checkinId))
    .where(eq(photoCheckins.userId, userId))
    .all();

  return {
    entryCount: entries[0]?.count ?? 0,
    checkinCount: checkins[0]?.count ?? 0,
    photoCount: photos[0]?.count ?? 0,
    lastEntryDate: entries[0]?.last ?? null,
    lastCheckinDate: checkins[0]?.last ?? null,
  };
}
