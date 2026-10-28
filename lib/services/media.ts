import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  privateMediaAssets,
  mediaAccessGrants,
  mediaDeletionEvents,
  userProfiles,
  consents,
} from '@/lib/db/schema';
import { sealMedia, openMedia, mediaRoot, isDevelopmentKey } from '@/lib/media/crypto';
import { stripImageMetadata, stripAudioMetadata } from '@/lib/media/strip-metadata';
import { newId } from '@/lib/auth/ids';
import { requireEntitlement } from './entitlements';
import { NotFoundError } from './equipment';
import type { Plan } from '@/lib/engines/entitlements';
import type { AgeBand } from '@/lib/engines/programming';

export class MediaPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaPolicyError';
  }
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
] as const;

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type MediaConsent = 'photo_journal' | 'voice_recording';

/**
 * Age policy for sensitive media.
 *
 * Storing a minor's face photographs or voice recordings carries consent
 * requirements this build cannot satisfy: there is no verified parental-consent
 * mechanism and no legal review. So it is refused outright rather than collected
 * under a consent a child cannot meaningfully give.
 *
 * Every other wellness feature — grooming, hygiene, wardrobe, voice practice
 * without recording, reviews — remains fully available to under-18 accounts.
 */
export function assertMediaAgeEligible(ageBand: AgeBand | null | undefined): void {
  if (ageBand !== 'adult_18_plus') {
    throw new MediaPolicyError(
      'Photo and voice capture are only available on 18+ accounts. GymOS has no verified parental-consent mechanism, so it does not store photographs or recordings for under-18 accounts. Every other personal-care feature is still available to you.',
    );
  }
}

/**
 * Read straight from the consents table rather than through the account service,
 * which deletes media when a consent is withdrawn and so depends on this module.
 */
function hasMediaConsent(userId: string, kind: MediaConsent): boolean {
  const row = db
    .select({ granted: consents.granted })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.kind, kind)))
    .get();
  return Boolean(row?.granted);
}

function ageBandOf(userId: string): AgeBand | null {
  const row = db
    .select({ ageBand: userProfiles.ageBand })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .get();
  return row?.ageBand ?? null;
}

export interface StoreMediaInput {
  kind: 'photo' | 'audio';
  mimeType: string;
  bytes: Buffer;
  originalFilename?: string;
  durationSeconds?: number;
  consent: MediaConsent;
}

export interface StoredMedia {
  id: string;
  byteSize: number;
  metadataStripped: boolean;
  removedBlocks: string[];
}

/**
 * The single entry point for writing private media.
 *
 * Order matters: age, then consent, then entitlement, then type and size, and only
 * then is a single byte written. Metadata is stripped before encryption, so the
 * plaintext on disk never contained it either.
 */
export function storeMedia(userId: string, plan: Plan, input: StoreMediaInput): StoredMedia {
  assertMediaAgeEligible(ageBandOf(userId));

  if (!hasMediaConsent(userId, input.consent)) {
    throw new MediaPolicyError(
      input.consent === 'photo_journal'
        ? 'Turn on the photo journal in Settings → Media privacy before uploading photographs.'
        : 'Turn on voice recording in Settings → Media privacy before saving a recording.',
    );
  }

  requireEntitlement(plan, userId, 'media_assets');

  const allowed: readonly string[] =
    input.kind === 'photo' ? ALLOWED_IMAGE_TYPES : ALLOWED_AUDIO_TYPES;
  if (!allowed.includes(input.mimeType)) {
    throw new MediaPolicyError(
      `${input.mimeType} is not an accepted ${input.kind} format. Accepted: ${allowed.join(', ')}.`,
    );
  }

  const maxBytes = input.kind === 'photo' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (input.bytes.length === 0) throw new MediaPolicyError('That file is empty.');
  if (input.bytes.length > maxBytes) {
    throw new MediaPolicyError(
      `That file is ${(input.bytes.length / 1024 / 1024).toFixed(1)} MB. The limit is ${maxBytes / 1024 / 1024} MB.`,
    );
  }

  // Strip before sealing, so the plaintext written to disk never held the metadata.
  const strip =
    input.kind === 'photo'
      ? stripImageMetadata(input.bytes)
      : stripAudioMetadata(input.bytes, input.mimeType);

  // `metadataStripped` records whether the file went through a stripper that
  // understands its format — not whether anything happened to be in it. A WebM or Ogg
  // recording from the in-app recorder carries no metadata to remove, but it also was
  // not inspected, and the privacy screen says so rather than implying otherwise.
  const metadataStripped = strip.format !== 'unknown';

  const sealed = sealMedia(strip.bytes);
  const id = newId();
  const relative = path.join(userId, `${id}.bin`);
  const absolute = path.join(mediaRoot(), relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, sealed.ciphertext, { mode: 0o600 });

  db.insert(privateMediaAssets)
    .values({
      id,
      userId,
      kind: input.kind,
      mimeType: input.mimeType,
      byteSize: strip.bytes.length,
      storagePath: relative,
      ivHex: sealed.ivHex,
      authTagHex: sealed.authTagHex,
      sha256: sealed.sha256,
      originalFilename: input.originalFilename?.slice(0, 200) ?? null,
      metadataStripped,
      durationSeconds: input.durationSeconds ?? null,
    })
    .run();

  return {
    id,
    byteSize: strip.bytes.length,
    metadataStripped,
    removedBlocks: strip.removedBlocks,
  };
}

export interface MediaBytes {
  bytes: Buffer;
  mimeType: string;
  kind: 'photo' | 'audio';
}

/**
 * Reads media the caller is entitled to see.
 *
 * Access is the owner, or an explicit, unexpired, unrevoked grant. There is no
 * third path, and no URL that bypasses this function.
 */
export function readMedia(userId: string, assetId: string): MediaBytes {
  const asset = db
    .select()
    .from(privateMediaAssets)
    .where(and(eq(privateMediaAssets.id, assetId), isNull(privateMediaAssets.deletedAt)))
    .get();
  if (!asset) throw new NotFoundError('That file does not exist.');

  if (asset.userId !== userId && !hasActiveGrant(assetId, userId)) {
    // Deliberately identical to the missing-file error: a stranger learns nothing
    // about whether the id exists.
    throw new NotFoundError('That file does not exist.');
  }

  const absolute = path.join(mediaRoot(), asset.storagePath);
  if (!fs.existsSync(absolute)) throw new NotFoundError('That file does not exist.');

  const bytes = openMedia(fs.readFileSync(absolute), asset.ivHex, asset.authTagHex);
  return { bytes, mimeType: asset.mimeType, kind: asset.kind };
}

export function hasActiveGrant(assetId: string, userId: string): boolean {
  const nowIso = new Date().toISOString();
  const grant = db
    .select({ id: mediaAccessGrants.id, expiresAt: mediaAccessGrants.expiresAt })
    .from(mediaAccessGrants)
    .where(
      and(
        eq(mediaAccessGrants.assetId, assetId),
        eq(mediaAccessGrants.grantedToUserId, userId),
        isNull(mediaAccessGrants.revokedAt),
      ),
    )
    .get();
  if (!grant) return false;
  return !grant.expiresAt || grant.expiresAt > nowIso;
}

export function ownsMedia(userId: string, assetId: string): boolean {
  return Boolean(
    db
      .select({ id: privateMediaAssets.id })
      .from(privateMediaAssets)
      .where(
        and(
          eq(privateMediaAssets.id, assetId),
          eq(privateMediaAssets.userId, userId),
          isNull(privateMediaAssets.deletedAt),
        ),
      )
      .get(),
  );
}

export function listMedia(userId: string, kind?: 'photo' | 'audio') {
  const clauses = [eq(privateMediaAssets.userId, userId), isNull(privateMediaAssets.deletedAt)];
  if (kind) clauses.push(eq(privateMediaAssets.kind, kind));
  return db
    .select({
      id: privateMediaAssets.id,
      kind: privateMediaAssets.kind,
      mimeType: privateMediaAssets.mimeType,
      byteSize: privateMediaAssets.byteSize,
      metadataStripped: privateMediaAssets.metadataStripped,
      durationSeconds: privateMediaAssets.durationSeconds,
      createdAt: privateMediaAssets.createdAt,
    })
    .from(privateMediaAssets)
    .where(and(...clauses))
    .orderBy(desc(privateMediaAssets.createdAt))
    .all();
}

export function mediaUsage(userId: string): { count: number; bytes: number } {
  const row = db
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${privateMediaAssets.byteSize}), 0)`,
    })
    .from(privateMediaAssets)
    .where(and(eq(privateMediaAssets.userId, userId), isNull(privateMediaAssets.deletedAt)))
    .all();
  return { count: row[0]?.count ?? 0, bytes: row[0]?.bytes ?? 0 };
}

export type DeletionReason =
  | 'user_request'
  | 'consent_withdrawn'
  | 'account_deleted'
  | 'retention';

/**
 * Deletes media for real: the encrypted file is removed from disk, the row is
 * tombstoned, and an auditable deletion event records whether the file actually
 * went. "Deleted" is therefore checkable rather than merely claimed.
 */
export function deleteMedia(userId: string, assetId: string, reason: DeletionReason): boolean {
  const asset = db
    .select()
    .from(privateMediaAssets)
    .where(and(eq(privateMediaAssets.id, assetId), eq(privateMediaAssets.userId, userId)))
    .get();
  if (!asset) throw new NotFoundError('That file does not exist.');
  return removeAsset(asset, reason);
}

function removeAsset(
  asset: typeof privateMediaAssets.$inferSelect,
  reason: DeletionReason,
): boolean {
  const absolute = path.join(mediaRoot(), asset.storagePath);
  let fileRemoved = false;
  try {
    if (fs.existsSync(absolute)) {
      fs.rmSync(absolute, { force: true });
      fileRemoved = true;
    }
  } catch {
    fileRemoved = false;
  }

  db.transaction((tx) => {
    tx.delete(mediaAccessGrants).where(eq(mediaAccessGrants.assetId, asset.id)).run();
    tx.delete(privateMediaAssets).where(eq(privateMediaAssets.id, asset.id)).run();
    tx.insert(mediaDeletionEvents)
      .values({
        id: newId(),
        userId: asset.userId,
        assetId: asset.id,
        reason,
        bytesFreed: asset.byteSize,
        fileRemoved,
      })
      .run();
  });
  return fileRemoved;
}

/**
 * Withdrawing consent is not a UI toggle — it destroys the media collected under it.
 */
export function deleteMediaForConsent(userId: string, consent: MediaConsent): number {
  const kind = consent === 'photo_journal' ? 'photo' : 'audio';
  const assets = db
    .select()
    .from(privateMediaAssets)
    .where(and(eq(privateMediaAssets.userId, userId), eq(privateMediaAssets.kind, kind)))
    .all();
  for (const asset of assets) removeAsset(asset, 'consent_withdrawn');
  return assets.length;
}

export function deleteAllMedia(userId: string, reason: DeletionReason = 'account_deleted'): number {
  const assets = db
    .select()
    .from(privateMediaAssets)
    .where(eq(privateMediaAssets.userId, userId))
    .all();
  for (const asset of assets) removeAsset(asset, reason);
  try {
    fs.rmSync(path.join(mediaRoot(), userId), { recursive: true, force: true });
  } catch {
    // Directory removal is best-effort; the files themselves are already gone.
  }
  return assets.length;
}

/* ------------------------------------------------------------- sharing */

export function grantMediaAccess(
  userId: string,
  assetId: string,
  toUserId: string,
  opts: { reason?: string; expiresAt?: string } = {},
): string {
  if (!ownsMedia(userId, assetId)) throw new NotFoundError('That file does not exist.');
  if (toUserId === userId) throw new MediaPolicyError('You already have access to your own files.');
  const id = newId();
  db.insert(mediaAccessGrants)
    .values({
      id,
      assetId,
      grantedByUserId: userId,
      grantedToUserId: toUserId,
      reason: (opts.reason ?? '').slice(0, 300),
      expiresAt: opts.expiresAt ?? null,
    })
    .run();
  return id;
}

export function revokeMediaAccess(userId: string, grantId: string): void {
  const grant = db
    .select({ id: mediaAccessGrants.id })
    .from(mediaAccessGrants)
    .where(and(eq(mediaAccessGrants.id, grantId), eq(mediaAccessGrants.grantedByUserId, userId)))
    .get();
  if (!grant) throw new NotFoundError('That share does not exist.');
  db.update(mediaAccessGrants)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(mediaAccessGrants.id, grantId))
    .run();
}

export function listGrants(userId: string) {
  return db
    .select()
    .from(mediaAccessGrants)
    .where(eq(mediaAccessGrants.grantedByUserId, userId))
    .orderBy(desc(mediaAccessGrants.createdAt))
    .all();
}

export function revokeAllGrants(userId: string): number {
  const nowIso = new Date().toISOString();
  const open = db
    .select({ id: mediaAccessGrants.id })
    .from(mediaAccessGrants)
    .where(
      and(eq(mediaAccessGrants.grantedByUserId, userId), isNull(mediaAccessGrants.revokedAt)),
    )
    .all();
  for (const grant of open) {
    db.update(mediaAccessGrants).set({ revokedAt: nowIso }).where(eq(mediaAccessGrants.id, grant.id)).run();
  }
  return open.length;
}

export function listDeletionEvents(userId: string, limit = 50) {
  return db
    .select()
    .from(mediaDeletionEvents)
    .where(eq(mediaDeletionEvents.userId, userId))
    .orderBy(desc(mediaDeletionEvents.createdAt))
    .limit(limit)
    .all();
}

export { isDevelopmentKey };
