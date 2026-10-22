import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { authAttempts } from '@/lib/db/schema';

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Database-backed sliding-window rate limit for authentication endpoints.
 * Stored in SQLite so it survives a dev restart and works without Redis.
 */
export function checkRateLimit(rule: RateLimitRule): RateLimitResult {
  const since = new Date(Date.now() - rule.windowSeconds * 1000).toISOString();
  const rows = db
    .select({ count: sql<number>`count(*)` })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.bucket, rule.bucket),
        eq(authAttempts.outcome, 'failure'),
        gte(authAttempts.createdAt, since),
      ),
    )
    .all();
  const count = rows[0]?.count ?? 0;
  return {
    allowed: count < rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: count >= rule.limit ? rule.windowSeconds : 0,
  };
}

export function recordAttempt(bucket: string, outcome: 'success' | 'failure'): void {
  db.insert(authAttempts).values({ bucket, outcome }).run();
}

/** Housekeeping: drop attempt rows older than a day. */
export function pruneAttempts(): void {
  const cutoff = new Date(Date.now() - 86400_000).toISOString();
  db.delete(authAttempts).where(sql`${authAttempts.createdAt} < ${cutoff}`).run();
}

export const AUTH_LIMITS = {
  loginPerIp: { limit: 20, windowSeconds: 900 },
  loginPerAccount: { limit: 8, windowSeconds: 900 },
  signupPerIp: { limit: 5, windowSeconds: 3600 },
};
