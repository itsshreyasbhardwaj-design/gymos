import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/**
 * Envelope encryption for private media.
 *
 * Bytes are sealed with AES-256-GCM before they touch the disk. The key never
 * enters the database; the database holds only the IV and the auth tag, so a stolen
 * database file on its own yields nothing readable.
 *
 * The key comes from GYMOS_MEDIA_KEY. In development, a key is derived from a
 * local keyfile so the app runs with no configuration — but `isDevelopmentKey()`
 * reports that honestly, and the privacy settings page says so to the user rather
 * than implying production-grade key management.
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

let cachedKey: { key: Buffer; development: boolean } | null = null;

function loadKey(): { key: Buffer; development: boolean } {
  if (cachedKey) return cachedKey;

  const configured = process.env.GYMOS_MEDIA_KEY;
  if (configured && configured.length >= 32) {
    cachedKey = {
      key: scryptSync(configured, 'gymos-media-key-v1', KEY_BYTES),
      development: false,
    };
    return cachedKey;
  }

  // Development fallback: a per-install random key persisted outside the repo.
  // Deliberately NOT derived from a constant, so two installs cannot read each
  // other's media, and deliberately reported as a development key.
   
  const fs = require('node:fs') as typeof import('node:fs');
   
  const path = require('node:path') as typeof import('node:path');
  const keyPath = path.join(mediaRoot(), '.media-key');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  let secret: string;
  if (fs.existsSync(keyPath)) {
    secret = fs.readFileSync(keyPath, 'utf8').trim();
  } else {
    secret = randomBytes(48).toString('base64');
    fs.writeFileSync(keyPath, secret, { mode: 0o600 });
  }
  cachedKey = { key: scryptSync(secret, 'gymos-media-key-v1', KEY_BYTES), development: true };
  return cachedKey;
}

export function isDevelopmentKey(): boolean {
  return loadKey().development;
}

export function mediaRoot(): string {
   
  const path = require('node:path') as typeof import('node:path');
  return process.env.GYMOS_MEDIA_PATH ?? path.join(process.cwd(), 'data', 'media');
}

export interface SealedMedia {
  ciphertext: Buffer;
  ivHex: string;
  authTagHex: string;
  sha256: string;
}

export function sealMedia(plaintext: Buffer): SealedMedia {
  const { key } = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext,
    ivHex: iv.toString('hex'),
    authTagHex: cipher.getAuthTag().toString('hex'),
    sha256: createHash('sha256').update(plaintext).digest('hex'),
  };
}

export class MediaIntegrityError extends Error {
  constructor(message = 'This file could not be decrypted and may have been tampered with.') {
    super(message);
    this.name = 'MediaIntegrityError';
  }
}

export function openMedia(ciphertext: Buffer, ivHex: string, authTagHex: string): Buffer {
  const { key } = loadKey();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM authentication failed: wrong key, or the file was modified.
    throw new MediaIntegrityError();
  }
}

/** Reset for tests that swap the key. */
export function resetKeyCache(): void {
  cachedKey = null;
}
