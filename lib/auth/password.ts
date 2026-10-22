import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>;

/**
 * scrypt parameters. N=2^15 with r=8, p=1 is a commonly recommended interactive
 * setting and needs ~32 MB per hash. Stored alongside the hash so the cost can be
 * raised later without invalidating existing passwords.
 */
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashB64 as string, 'base64url');
  } catch {
    return false;
  }
  const salt = Buffer.from(saltB64 as string, 'base64url');
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: PARAMS.maxmem,
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export const PASSWORD_RULES = {
  minLength: 10,
  maxLength: 200,
};

export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_RULES.minLength) {
    return `Use at least ${PASSWORD_RULES.minLength} characters.`;
  }
  if (password.length > PASSWORD_RULES.maxLength) {
    return 'That password is too long.';
  }
  const lower = password.toLowerCase();
  const weak = ['password', '1234567890', 'qwertyuiop', 'gymos', 'letmein', 'iloveyou'];
  if (weak.some((w) => lower.includes(w))) {
    return 'That password contains a very common pattern. Please choose something less guessable.';
  }
  if (/^(.)\1+$/.test(password)) return 'Please use more than one repeated character.';
  return null;
}
