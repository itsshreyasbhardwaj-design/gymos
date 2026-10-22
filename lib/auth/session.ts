import 'server-only';
import { cookies, headers } from 'next/headers';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sessions, users, userProfiles, subscriptionRecords, auditEvents } from '@/lib/db/schema';
import { newId, newToken, sha256, hashIp } from './ids';
import type { Plan } from '@/lib/engines/entitlements';

export const SESSION_COOKIE = 'gymos_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const SESSION_IDLE_REFRESH_SECONDS = 60 * 60; // refresh last_seen at most hourly

export interface SessionUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  plan: Plan;
  displayName: string | null;
  ageBand: 'under_13' | 'teen_13_17' | 'adult_18_plus' | null;
  onboardingCompleted: boolean;
  sessionId: string;
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken(32);
  const hdrs = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  db.insert(sessions)
    .values({
      id: newId(),
      userId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: (hdrs.get('user-agent') ?? '').slice(0, 300),
      ipHash: hashIp(clientIp(hdrs)),
    })
    .run();

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return token;
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    db.update(sessions)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(sessions.tokenHash, sha256(token)))
      .run();
  }
  jar.delete(SESSION_COOKIE);
}

/** Revokes every session for a user except, optionally, the current one. */
export function revokeAllSessions(userId: string, exceptSessionId?: string): number {
  const now = new Date().toISOString();
  const rows = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .all();
  let revoked = 0;
  for (const row of rows) {
    if (exceptSessionId && row.id === exceptSessionId) continue;
    db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.id)).run();
    revoked += 1;
  }
  return revoked;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return resolveSessionToken(token);
}

export function resolveSessionToken(token: string): SessionUser | null {
  const tokenHash = sha256(token);
  const now = new Date().toISOString();
  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      displayName: userProfiles.displayName,
      ageBand: userProfiles.ageBand,
      onboardingCompletedAt: userProfiles.onboardingCompletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .get();

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt <= now) return null;
  if (row.status !== 'active') return null;

  // Touch last_seen at most once an hour to avoid a write on every request.
  if (Date.parse(now) - Date.parse(row.lastSeenAt) > SESSION_IDLE_REFRESH_SECONDS * 1000) {
    db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId)).run();
  }

  return {
    id: row.userId,
    email: row.email,
    role: row.role,
    plan: currentPlan(row.userId),
    displayName: row.displayName ?? null,
    ageBand: row.ageBand ?? null,
    onboardingCompleted: Boolean(row.onboardingCompletedAt),
    sessionId: row.sessionId,
  };
}

export function currentPlan(userId: string): Plan {
  const row = db
    .select({ plan: subscriptionRecords.plan, status: subscriptionRecords.status })
    .from(subscriptionRecords)
    .where(eq(subscriptionRecords.userId, userId))
    .orderBy(sql`${subscriptionRecords.createdAt} desc`)
    .get();
  if (!row) return 'free';
  const active = ['active', 'trialing', 'dev_granted'].includes(row.status);
  return active ? row.plan : 'free';
}

export class AuthError extends Error {
  constructor(message = 'You need to sign in to do that.') {
    super(message);
    this.name = 'AuthError';
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError();
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== 'admin') {
    throw new AuthError('That area is for GymOS content administrators only.');
  }
  return user;
}

export function clientIp(hdrs: Headers): string | null {
  const forwarded = hdrs.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return hdrs.get('x-real-ip');
}

export async function audit(
  action: string,
  opts: {
    userId?: string | null;
    actorUserId?: string | null;
    target?: string;
    meta?: unknown;
  } = {},
): Promise<void> {
  const hdrs = await headers();
  db.insert(auditEvents)
    .values({
      id: newId(),
      userId: opts.userId ?? null,
      actorUserId: opts.actorUserId ?? opts.userId ?? null,
      action,
      target: opts.target ?? '',
      meta: opts.meta ?? null,
      ipHash: hashIp(clientIp(hdrs)),
    })
    .run();
}

export function listSessions(userId: string) {
  return db
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sql`${sessions.createdAt} desc`)
    .all();
}

export function pruneExpiredSessions(): void {
  const now = new Date().toISOString();
  db.delete(sessions).where(sql`${sessions.expiresAt} < ${now}`).run();
}
