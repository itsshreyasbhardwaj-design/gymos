/**
 * SAFETY 10 — consent gating, export completeness and true deletion.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();

let account: typeof import('@/lib/services/account');
let equipment: typeof import('@/lib/services/equipment');
let plans: typeof import('@/lib/services/plans');
let sessions: typeof import('@/lib/services/sessions');
let nutrition: typeof import('@/lib/services/nutrition');
let progress: typeof import('@/lib/services/progress');
let dbClient: typeof import('@/lib/db/client');
let schema: typeof import('@/lib/db/schema');
let drizzle: typeof import('drizzle-orm');

let userId: string;
let otherUserId: string;

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  equipment = await import('@/lib/services/equipment');
  plans = await import('@/lib/services/plans');
  sessions = await import('@/lib/services/sessions');
  nutrition = await import('@/lib/services/nutrition');
  progress = await import('@/lib/services/progress');
  dbClient = await import('@/lib/db/client');
  schema = await import('@/lib/db/schema');
  drizzle = await import('drizzle-orm');

  userId = await account.registerUser({
    email: 'privacy@example.com',
    password: 'privacy-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(userId, {
    displayName: 'Privacy Tester',
    ageBand: 'adult_18_plus',
    experience: 'some',
    trainingDays: [1, 3],
    sessionMinutes: 45,
  });
  account.completeOnboarding(userId);
  account.devSetPlan(userId, 'pro');

  const profileId = equipment.createGymProfile(userId, 'pro', {
    name: 'Home',
    environment: 'home',
    presetKey: 'minimal_home',
  });
  equipment.activateGymProfile(userId, profileId);
  plans.savePlan(userId, plans.buildPlanDraft(userId, { weekStart: '2026-10-19' }));
  sessions.materialiseWeek(userId, '2026-10-19');

  const first = sessions.listSessions(userId, { from: '2026-10-19', to: '2026-10-25' })[0]!;
  sessions.startSession(userId, first.id);
  const session = sessions.getSession(userId, first.id);
  sessions.logSet(userId, first.id, {
    exerciseId: session.exercises[0]!.exerciseId,
    setIndex: 1,
    reps: 10,
    weightGrams: 15000,
  });
  sessions.completeSession(userId, first.id, { feedback: { difficulty: 'about_right' } });

  nutrition.saveNutritionPrefs(userId, 'adult_18_plus', { diet: 'vegetarian' });
  const mealPlanId = nutrition.saveMealPlan(
    userId,
    nutrition.buildMealPlanDraft(userId, 'pro', { weekStart: '2026-10-19' }),
  );
  nutrition.upsertPantryItem(userId, 'pro', { ingredientId: 'onion', quantity: 500, unit: 'g' });
  nutrition.generateGroceryList(userId, 'pro', { mealPlanId });
  nutrition.recordIngredientPrice(userId, {
    ingredientId: 'onion',
    pricePaise: 4000,
    perQuantity: 1000,
    unit: 'g',
  });
  progress.addActivity(userId, { kind: 'walk', date: '2026-10-19', minutes: 30 });

  otherUserId = await account.registerUser({
    email: 'bystander@example.com',
    password: 'bystander-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(otherUserId, { displayName: 'Bystander', ageBand: 'adult_18_plus' });
  equipment.createGymProfile(otherUserId, 'free', {
    name: 'Bystander home',
    environment: 'home',
    presetKey: 'bodyweight_home',
  });
}, 60_000);

afterAll(() => temp.cleanup());

describe('consent gating', () => {
  it('biometrics are off by default and refused until consent is given', () => {
    expect(account.getConsent(userId, 'biometrics')).toBe(false);
    expect(() =>
      progress.recordBiometric(userId, { date: '2026-10-19', kind: 'steps', value: 5000, unit: 'count' }),
    ).toThrow(progress.ConsentRequiredError);
    expect(() => progress.listBiometrics(userId)).toThrow(progress.ConsentRequiredError);
  });

  it('accepts records once consent is recorded', () => {
    account.setConsent(userId, 'biometrics', true);
    progress.recordBiometric(userId, {
      date: '2026-10-19',
      kind: 'resting_hr',
      value: 58,
      unit: 'bpm',
    });
    expect(progress.listBiometrics(userId).length).toBe(1);
  });

  it('withdrawing consent blocks access again', () => {
    account.setConsent(userId, 'biometrics', false);
    expect(() => progress.listBiometrics(userId)).toThrow(progress.ConsentRequiredError);
  });

  it('deleting biometric records removes every row', () => {
    account.setConsent(userId, 'biometrics', true);
    const removed = progress.deleteAllBiometrics(userId);
    expect(removed).toBeGreaterThan(0);
    expect(progress.listBiometrics(userId).length).toBe(0);
    account.setConsent(userId, 'biometrics', false);
  });

  it('records a consent row for every change rather than silently toggling', () => {
    const consents = account.listConsents(userId);
    const biometrics = consents.find((c) => c.kind === 'biometrics')!;
    expect(biometrics.revokedAt).toBeTruthy();
    expect(biometrics.granted).toBe(false);
  });
});

describe('data export', () => {
  it('includes every category of the user\'s data', () => {
    const data = account.buildExport(userId) as Record<string, unknown[]>;
    for (const key of [
      'account',
      'profile',
      'consents',
      'preferences',
      'subscriptions',
      'equipmentProfiles',
      'workoutPlans',
      'workoutSessions',
      'exerciseLogs',
      'nutritionPreferences',
      'mealPlans',
      'pantry',
      'groceryLists',
      'ingredientPrices',
      'activityRecords',
      'milestones',
    ]) {
      expect(data[key], `${key} missing from export`).toBeDefined();
    }
    expect((data.workoutSessions as unknown[]).length).toBeGreaterThan(0);
    expect((data.exerciseLogs as unknown[]).length).toBeGreaterThan(0);
    expect((data.equipmentProfiles as unknown[]).length).toBeGreaterThan(0);
  });

  it('never includes the password hash', () => {
    const json = JSON.stringify(account.buildExport(userId));
    expect(json).not.toContain('scrypt$');
    expect(json).not.toContain('passwordHash');
  });

  it('contains only the requesting user\'s records', () => {
    const json = JSON.stringify(account.buildExport(userId));
    expect(json).not.toContain(otherUserId);
    expect(json).not.toContain('bystander@example.com');
  });

  it('is available regardless of plan and is recorded', () => {
    const id = account.recordExport(userId);
    expect(id).toBeTruthy();
    const { db } = dbClient;
    const rows = db
      .select()
      .from(schema.dataExports)
      .where(drizzle.eq(schema.dataExports.userId, userId))
      .all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.status).toBe('ready');
  });
});

describe('account deletion', () => {
  it('removes every row belonging to the user across all tables', () => {
    const { db } = dbClient;
    const before = {
      sessions: db.select().from(schema.workoutSessions).all().length,
      logs: db.select().from(schema.exerciseLogs).all().length,
      profiles: db.select().from(schema.gymProfiles).all().length,
    };
    expect(before.sessions).toBeGreaterThan(0);
    expect(before.logs).toBeGreaterThan(0);

    account.deleteAccount(userId);

    const remaining = {
      users: db.select().from(schema.users).where(drizzle.eq(schema.users.id, userId)).all(),
      profile: db
        .select()
        .from(schema.userProfiles)
        .where(drizzle.eq(schema.userProfiles.userId, userId))
        .all(),
      sessions: db
        .select()
        .from(schema.workoutSessions)
        .where(drizzle.eq(schema.workoutSessions.userId, userId))
        .all(),
      plans: db
        .select()
        .from(schema.workoutPlans)
        .where(drizzle.eq(schema.workoutPlans.userId, userId))
        .all(),
      gyms: db
        .select()
        .from(schema.gymProfiles)
        .where(drizzle.eq(schema.gymProfiles.userId, userId))
        .all(),
      mealPlans: db
        .select()
        .from(schema.mealPlans)
        .where(drizzle.eq(schema.mealPlans.userId, userId))
        .all(),
      pantry: db
        .select()
        .from(schema.pantryItems)
        .where(drizzle.eq(schema.pantryItems.userId, userId))
        .all(),
      groceryLists: db
        .select()
        .from(schema.groceryLists)
        .where(drizzle.eq(schema.groceryLists.userId, userId))
        .all(),
      prices: db
        .select()
        .from(schema.userIngredientPrices)
        .where(drizzle.eq(schema.userIngredientPrices.userId, userId))
        .all(),
      activity: db
        .select()
        .from(schema.activityRecords)
        .where(drizzle.eq(schema.activityRecords.userId, userId))
        .all(),
      consents: db
        .select()
        .from(schema.consents)
        .where(drizzle.eq(schema.consents.userId, userId))
        .all(),
      prefs: db
        .select()
        .from(schema.preferences)
        .where(drizzle.eq(schema.preferences.userId, userId))
        .all(),
      subscriptions: db
        .select()
        .from(schema.subscriptionRecords)
        .where(drizzle.eq(schema.subscriptionRecords.userId, userId))
        .all(),
    };
    for (const [key, rows] of Object.entries(remaining)) {
      expect(rows.length, `${key} still has rows after deletion`).toBe(0);
    }
  });

  it('leaves no orphaned child rows behind', () => {
    const { db } = dbClient;
    const sessionIds = new Set(db.select().from(schema.workoutSessions).all().map((s) => s.id));
    for (const log of db.select().from(schema.exerciseLogs).all()) {
      expect(sessionIds.has(log.sessionId)).toBe(true);
    }
    const listIds = new Set(db.select().from(schema.groceryLists).all().map((l) => l.id));
    for (const item of db.select().from(schema.groceryItems).all()) {
      expect(listIds.has(item.listId)).toBe(true);
    }
    const dayIds = new Set(db.select().from(schema.workoutDays).all().map((d) => d.id));
    for (const pe of db.select().from(schema.plannedExercises).all()) {
      expect(dayIds.has(pe.workoutDayId)).toBe(true);
    }
    const mealPlanIds = new Set(db.select().from(schema.mealPlans).all().map((m) => m.id));
    for (const meal of db.select().from(schema.plannedMeals).all()) {
      expect(mealPlanIds.has(meal.mealPlanId)).toBe(true);
    }
  });

  it('leaves other users completely untouched', () => {
    expect(account.getProfile(otherUserId)?.displayName).toBe('Bystander');
    expect(equipment.listGymProfiles(otherUserId).length).toBe(1);
  });

  it('leaves the shared content library intact', () => {
    const { db } = dbClient;
    expect(db.select().from(schema.exercises).all().length).toBeGreaterThan(150);
    expect(db.select().from(schema.recipes).all().length).toBeGreaterThan(60);
    expect(db.select().from(schema.equipmentTypes).all().length).toBeGreaterThan(50);
  });
});
