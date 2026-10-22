import { randomBytes, randomUUID, createHash } from 'node:crypto';

export const newId = (): string => randomUUID();

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** One-way, salted-by-deployment hash for IP addresses in audit rows. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.GYMOS_IP_SALT ?? 'gymos-local-dev-salt';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
