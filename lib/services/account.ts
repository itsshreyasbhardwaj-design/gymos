import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  users,
  userProfiles,
  consents,
  preferences,
  userPreferencesHistory,
  subscriptionRecords,
  dataExports,
  gymProfiles,
  gymEquipment,
  workoutPlans,
  workoutDays,
  plannedExercises,
  workoutSessions,
  exerciseLogs,
  sessionFeedback,
  planRevisions,
  substitutionEvents,
  nutritionPrefs,
  mealPlans,
  plannedMeals,
  pantryItems,
  groceryLists,
  groceryItems,
  activityRecords,
  performanceMilestones,
  progressSnapshots,
  biometricRecords,
  notifications,
  auditEvents,
  userIngredientPrices,
  sessions as sessionRows,
} from '@/lib/db/schema';
import { hashPassword, verifyPassword, validatePasswordStrength } from '@/lib/auth/password';
import { newId, normalizeEmail } from '@/lib/auth/ids';
import { NotFoundError } from './equipment';
import type { AgeBand } from '@/lib/engines/programming';
import type { Level } from '@/lib/content/exercise-types';

export class ValidationError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function registerUser(input: {
  email: string;
  password: string;
  acceptTerms: boolean;
}): Promise<string> {
  const email = input.email.trim();
  if (!EMAIL_RE.test(email)) throw new ValidationError('Enter a valid email address.', 'email');
  const strength = validatePasswordStrength(input.password);
  if (strength) throw new ValidationError(strength, 'password');
  if (!input.acceptTerms) {
    throw new ValidationError('You need to accept the terms to create an account.', 'acceptTerms');
  }

  const normalized = normalizeEmail(email);
  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, normalized))
    .get();
  if (existing) throw new ValidationError('An account with that email already exists.', 'email');

  const passwordHash = await hashPassword(input.password);
  const id = newId();
  db.transaction((tx) => {
    tx.insert(users).values({ id, email, emailNormalized: normalized, passwordHash }).run();
    tx.insert(consents)
      .values({
        id: newId(),
        userId: id,
        kind: 'terms',
        granted: true,
        grantedAt: new Date().toISOString(),
      })
      .run();
    tx.insert(subscriptionRecords)
      .values({ id: newId(), userId: id, plan: 'free', status: 'none' })
      .run();
  });
  return id;
}

export async function authenticate(email: string, password: string): Promise<string | null> {
  const row = db
    .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .where(eq(users.emailNormalized, normalizeEmail(email)))
    .get();
  if (!row) {
    // Constant-ish work even for unknown accounts, so timing does not leak existence.
    await verifyPassword(password, 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
    return null;
  }
  if (row.status !== 'active') return null;
  const ok = await verifyPassword(password, row.passwordHash);
  return ok ? row.id : null;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const row = db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).get();
  if (!row) throw new NotFoundError('Account not found.');
  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new ValidationError('That is not your current password.', 'currentPassword');
  }
  const strength = validatePasswordStrength(newPassword);
  if (strength) throw new ValidationError(strength, 'newPassword');
  db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date().toISOString() })
    .where(eq(users.id, userId))
    .run();
}

/* ------------------------------------------------------------------ profile */

export interface ProfileInput {
  displayName: string;
  ageBand: AgeBand;
  language?: string;
  timezone?: string;
  units?: 'metric' | 'imperial';
  experience?: Level;
  interests?: string[];
  trainingDays?: number[];
  sessionMinutes?: number;
  preferredTime?: string | null;
  scheduleFlexibility?: 'rigid' | 'some' | 'flexible';
  environment?: string;
  activities?: string[];
  limitations?: string[];
  accessibility?: { reduceMotion?: boolean; largeText?: boolean; highContrast?: boolean };
  onboardingStep?: number;
}

export function getProfile(userId: string) {
  return db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).get() ?? null;
}

export function upsertProfile(userId: string, input: Partial<ProfileInput>): void {
  const existing = getProfile(userId);
  if (input.displayName !== undefined && input.displayName.trim().length === 0) {
    throw new ValidationError('Please enter a name we can greet you by.', 'displayName');
  }
  if (input.sessionMinutes !== undefined && (input.sessionMinutes < 10 || input.sessionMinutes > 180)) {
    throw new ValidationError('Session length should be between 10 and 180 minutes.', 'sessionMinutes');
  }
  if (input.trainingDays && input.trainingDays.some((d) => d < 0 || d > 6)) {
    throw new ValidationError('Training days are invalid.', 'trainingDays');
  }

  const values = {
    displayName: (input.displayName ?? existing?.displayName ?? 'Friend').slice(0, 60),
    ageBand: (input.ageBand ?? existing?.ageBand ?? 'adult_18_plus') as AgeBand,
    language: input.language ?? existing?.language ?? 'en-IN',
    timezone: input.timezone ?? existing?.timezone ?? 'Asia/Kolkata',
    units: input.units ?? existing?.units ?? 'metric',
    experience: (input.experience ?? existing?.experience ?? 'new') as Level,
    interests: input.interests ?? existing?.interests ?? [],
    trainingDays: input.trainingDays ?? existing?.trainingDays ?? [],
    sessionMinutes: input.sessionMinutes ?? existing?.sessionMinutes ?? 45,
    preferredTime: input.preferredTime ?? existing?.preferredTime ?? null,
    scheduleFlexibility: input.scheduleFlexibility ?? existing?.scheduleFlexibility ?? 'some',
    environment: (input.environment ?? existing?.environment ?? 'home') as never,
    activities: input.activities ?? existing?.activities ?? [],
    limitations: input.limitations ?? existing?.limitations ?? [],
    accessibility: input.accessibility ?? existing?.accessibility ?? {},
    onboardingStep: input.onboardingStep ?? existing?.onboardingStep ?? 0,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    recordPreferenceHistory(userId, 'profile', existing, values);
    db.update(userProfiles).set(values).where(eq(userProfiles.userId, userId)).run();
  } else {
    db.insert(userProfiles).values({ userId, ...values }).run();
  }
}

export function completeOnboarding(userId: string): void {
  db.update(userProfiles)
    .set({ onboardingCompletedAt: new Date().toISOString(), onboardingStep: 9 })
    .where(eq(userProfiles.userId, userId))
    .run();
}

function recordPreferenceHistory(userId: string, key: string, oldValue: unknown, newValue: unknown): void {
  db.insert(userPreferencesHistory)
    .values({ id: newId(), userId, key, oldValue, newValue })
    .run();
}

/* ----------------------------------------------------------------- consents */

export type ConsentKind =
  | 'terms'
  | 'biometrics'
  | 'activity_import'
  | 'household_planning'
  | 'analytics'
  | 'coach_sharing';

export const CONSENT_COPY: Record<ConsentKind, { title: string; body: string; minorNote?: string }> = {
  terms: { title: 'Terms of service', body: 'Required to hold an account.' },
  biometrics: {
    title: 'Optional biometric records',
    body: 'Lets you record steps, sleep duration, resting heart rate, body mass and self-reported recovery. GymOS never requires these and never claims a single reading reveals your ideal training intensity.',
    minorNote: 'Not offered to under-18 accounts.',
  },
  activity_import: {
    title: 'Imported activity data',
    body: 'Reserved for a future authorised integration with Apple HealthKit or Android Health Connect. Nothing is connected in this build.',
  },
  household_planning: {
    title: 'Household meal planning',
    body: 'Lets you plan meals for more than one person and size the grocery list accordingly.',
  },
  analytics: {
    title: 'Privacy-conscious product analytics',
    body: 'Off by default. GymOS collects no third-party analytics in this build.',
  },
  coach_sharing: {
    title: 'Share with a coach',
    body: 'Reserved for a future trainer feature. No trainer accounts exist in this build, so nothing can be shared.',
  },
};

export function listConsents(userId: string) {
  return db.select().from(consents).where(eq(consents.userId, userId)).all();
}

export function getConsent(userId: string, kind: ConsentKind): boolean {
  const row = db
    .select({ granted: consents.granted })
    .from(consents)
    .where(and(eq(consents.userId, userId), eq(consents.kind, kind)))
    .get();
  return Boolean(row?.granted);
}

export function setConsent(userId: string, kind: ConsentKind, granted: boolean): void {
  const profile = getProfile(userId);
  if (granted && kind === 'biometrics' && profile && profile.ageBand !== 'adult_18_plus') {
    throw new ValidationError('Biometric collection is not available for under-18 accounts.');
  }
  const now = new Date().toISOString();
  db.insert(consents)
    .values({
      id: newId(),
      userId,
      kind,
      granted,
      grantedAt: granted ? now : null,
      revokedAt: granted ? null : now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [consents.userId, consents.kind],
      set: {
        granted,
        grantedAt: granted ? now : null,
        revokedAt: granted ? null : now,
        updatedAt: now,
      },
    })
    .run();
}

/* ------------------------------------------------------- export and deletion */

/** Everything GymOS holds about a user, as plain JSON. */
export function buildExport(userId: string): Record<string, unknown> {
  const user = db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) throw new NotFoundError('Account not found.');

  return {
    exportedAt: new Date().toISOString(),
    format: 'gymos-export/1',
    note:
      'This file contains everything GymOS stores about your account. Workout and meal content from the shared libraries is referenced by id.',
    account: user,
    profile: getProfile(userId),
    consents: listConsents(userId),
    preferences: db.select().from(preferences).where(eq(preferences.userId, userId)).all(),
    preferenceHistory: db
      .select()
      .from(userPreferencesHistory)
      .where(eq(userPreferencesHistory.userId, userId))
      .all(),
    subscriptions: db
      .select()
      .from(subscriptionRecords)
      .where(eq(subscriptionRecords.userId, userId))
      .all(),
    equipmentProfiles: db.select().from(gymProfiles).where(eq(gymProfiles.userId, userId)).all(),
    workoutPlans: db.select().from(workoutPlans).where(eq(workoutPlans.userId, userId)).all(),
    workoutSessions: db.select().from(workoutSessions).where(eq(workoutSessions.userId, userId)).all(),
    exerciseLogs: db
      .select()
      .from(exerciseLogs)
      .innerJoin(workoutSessions, eq(workoutSessions.id, exerciseLogs.sessionId))
      .where(eq(workoutSessions.userId, userId))
      .all()
      .map((r) => r.exercise_logs),
    planRevisions: db.select().from(planRevisions).where(eq(planRevisions.userId, userId)).all(),
    substitutions: db
      .select()
      .from(substitutionEvents)
      .where(eq(substitutionEvents.userId, userId))
      .all(),
    nutritionPreferences: db
      .select()
      .from(nutritionPrefs)
      .where(eq(nutritionPrefs.userId, userId))
      .all(),
    mealPlans: db.select().from(mealPlans).where(eq(mealPlans.userId, userId)).all(),
    pantry: db.select().from(pantryItems).where(eq(pantryItems.userId, userId)).all(),
    groceryLists: db.select().from(groceryLists).where(eq(groceryLists.userId, userId)).all(),
    ingredientPrices: db
      .select()
      .from(userIngredientPrices)
      .where(eq(userIngredientPrices.userId, userId))
      .all(),
    activityRecords: db.select().from(activityRecords).where(eq(activityRecords.userId, userId)).all(),
    milestones: db
      .select()
      .from(performanceMilestones)
      .where(eq(performanceMilestones.userId, userId))
      .all(),
    progressSnapshots: db
      .select()
      .from(progressSnapshots)
      .where(eq(progressSnapshots.userId, userId))
      .all(),
    biometrics: db.select().from(biometricRecords).where(eq(biometricRecords.userId, userId)).all(),
    notifications: db.select().from(notifications).where(eq(notifications.userId, userId)).all(),
    auditEvents: db.select().from(auditEvents).where(eq(auditEvents.userId, userId)).all(),
  };
}

export function recordExport(userId: string): string {
  const id = newId();
  const payload = buildExport(userId);
  db.insert(dataExports)
    .values({ id, userId, status: 'ready', payload, completedAt: new Date().toISOString() })
    .run();
  return id;
}

/**
 * Hard deletion. Foreign keys cascade from `users`, but deletions that hang off a
 * join (exercise logs, planned meals, grocery items, planned exercises) are removed
 * explicitly so nothing is orphaned if cascade behaviour ever changes.
 */
export function deleteAccount(userId: string): void {
  db.transaction((tx) => {
    const sessionIds = tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(eq(workoutSessions.userId, userId))
      .all()
      .map((r) => r.id);
    for (const sid of sessionIds) {
      tx.delete(exerciseLogs).where(eq(exerciseLogs.sessionId, sid)).run();
      tx.delete(sessionFeedback).where(eq(sessionFeedback.sessionId, sid)).run();
    }
    const planIds = tx
      .select({ id: workoutPlans.id })
      .from(workoutPlans)
      .where(eq(workoutPlans.userId, userId))
      .all()
      .map((r) => r.id);
    for (const pid of planIds) {
      const dayIds = tx
        .select({ id: workoutDays.id })
        .from(workoutDays)
        .where(eq(workoutDays.planId, pid))
        .all()
        .map((r) => r.id);
      for (const did of dayIds) {
        tx.delete(plannedExercises).where(eq(plannedExercises.workoutDayId, did)).run();
      }
      tx.delete(workoutDays).where(eq(workoutDays.planId, pid)).run();
    }
    const mealPlanIds = tx
      .select({ id: mealPlans.id })
      .from(mealPlans)
      .where(eq(mealPlans.userId, userId))
      .all()
      .map((r) => r.id);
    for (const mid of mealPlanIds) {
      tx.delete(plannedMeals).where(eq(plannedMeals.mealPlanId, mid)).run();
    }
    const listIds = tx
      .select({ id: groceryLists.id })
      .from(groceryLists)
      .where(eq(groceryLists.userId, userId))
      .all()
      .map((r) => r.id);
    for (const lid of listIds) {
      tx.delete(groceryItems).where(eq(groceryItems.listId, lid)).run();
    }
    const profileIds = tx
      .select({ id: gymProfiles.id })
      .from(gymProfiles)
      .where(eq(gymProfiles.userId, userId))
      .all()
      .map((r) => r.id);
    for (const gid of profileIds) {
      tx.delete(gymEquipment).where(eq(gymEquipment.gymProfileId, gid)).run();
    }

    tx.delete(workoutSessions).where(eq(workoutSessions.userId, userId)).run();
    tx.delete(workoutPlans).where(eq(workoutPlans.userId, userId)).run();
    tx.delete(mealPlans).where(eq(mealPlans.userId, userId)).run();
    tx.delete(groceryLists).where(eq(groceryLists.userId, userId)).run();
    tx.delete(gymProfiles).where(eq(gymProfiles.userId, userId)).run();
    tx.delete(sessionRows).where(eq(sessionRows.userId, userId)).run();
    // The remaining tables cascade from users; deleting the row finishes the job.
    tx.delete(users).where(eq(users.id, userId)).run();
  });
}

export function listNotifications(userId: string, limit = 20) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(notifications.createdAt)
    .limit(limit)
    .all()
    .reverse();
}

export function markNotificationRead(userId: string, id: string): void {
  db.update(notifications)
    .set({ readAt: new Date().toISOString() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .run();
}

/** Development-only plan switch. There is no payment path in this build. */
export function devSetPlan(userId: string, plan: 'free' | 'pro'): void {
  db.insert(subscriptionRecords)
    .values({
      id: newId(),
      userId,
      plan,
      status: plan === 'pro' ? 'dev_granted' : 'none',
      amountPaise: 0,
      provider: 'none',
      interval: plan === 'pro' ? 'month' : 'none',
      startedAt: new Date().toISOString(),
    })
    .run();
}
