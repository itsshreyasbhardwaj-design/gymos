/**
 * SAFETY 9 — one user can never reach another user's records.
 *
 * Every read and write path that takes an id is exercised with a second account's id.
 * Ownership is enforced in the SQL predicate, not filtered afterwards in app code.
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
let realitysync: typeof import('@/lib/services/realitysync');
let fitbrain: typeof import('@/lib/services/fitbrain');

interface Fixture {
  userId: string;
  profileId: string;
  planId: string;
  sessionId: string;
  plannedExerciseId: string;
  workoutDayId: string;
  mealPlanId: string;
  plannedMealId: string;
  groceryListId: string;
  groceryItemId: string;
  pantryItemId: string;
  activityId: string;
}

let alice: Fixture;
let mallory: Fixture;

async function makeUser(email: string): Promise<Fixture> {
  const userId = await account.registerUser({
    email,
    password: 'isolation-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(userId, {
    displayName: email.split('@')[0]!,
    ageBand: 'adult_18_plus',
    experience: 'some',
    trainingDays: [1, 3],
    sessionMinutes: 45,
  });
  account.completeOnboarding(userId);
  account.devSetPlan(userId, 'pro');

  const profileId = equipment.createGymProfile(userId, 'pro', {
    name: `${email} gym`,
    environment: 'home',
    presetKey: 'minimal_home',
  });
  equipment.activateGymProfile(userId, profileId);

  const planId = plans.savePlan(userId, plans.buildPlanDraft(userId, { weekStart: '2026-10-19' }));
  sessions.materialiseWeek(userId, '2026-10-19');
  const sessionId = sessions.listSessions(userId, { from: '2026-10-19', to: '2026-10-25' })[0]!.id;

  const plan = plans.getActivePlan(userId)!;
  const day = plan.days.find((d) => d.exercises.length > 0)!;

  nutrition.saveNutritionPrefs(userId, 'adult_18_plus', { diet: 'vegetarian' });
  const mealPlanId = nutrition.saveMealPlan(
    userId,
    nutrition.buildMealPlanDraft(userId, 'pro', { weekStart: '2026-10-19' }),
  );
  const plannedMealId = nutrition.getMealPlan(userId, mealPlanId).meals[0]!.id;
  nutrition.upsertPantryItem(userId, 'pro', { ingredientId: 'onion', quantity: 500, unit: 'g' });
  const pantryItemId = nutrition.listPantry(userId)[0]!.id;
  const groceryListId = nutrition.generateGroceryList(userId, 'pro', { mealPlanId });
  const groceryItemId = nutrition.getGroceryList(userId, groceryListId).items[0]!.id;

  progress.addActivity(userId, { kind: 'walk', date: '2026-10-19', minutes: 30 });
  const activityId = progress.listActivities(userId)[0]!.id;

  return {
    userId,
    profileId,
    planId,
    sessionId,
    plannedExerciseId: day.exercises[0]!.id,
    workoutDayId: day.id,
    mealPlanId,
    plannedMealId,
    groceryListId,
    groceryItemId,
    pantryItemId,
    activityId,
  };
}

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  equipment = await import('@/lib/services/equipment');
  plans = await import('@/lib/services/plans');
  sessions = await import('@/lib/services/sessions');
  nutrition = await import('@/lib/services/nutrition');
  progress = await import('@/lib/services/progress');
  realitysync = await import('@/lib/services/realitysync');
  fitbrain = await import('@/lib/services/fitbrain');

  alice = await makeUser('alice-iso@example.com');
  mallory = await makeUser('mallory-iso@example.com');
}, 60_000);

afterAll(() => temp.cleanup());

describe('equipment isolation', () => {
  it('cannot read another user\'s equipment profile', () => {
    expect(() => equipment.getGymProfile(mallory.userId, alice.profileId)).toThrow(/does not exist/i);
  });

  it('cannot modify another user\'s equipment', () => {
    expect(() => equipment.setProfileEquipment(mallory.userId, alice.profileId, ['barbell'])).toThrow();
    expect(() => equipment.activateGymProfile(mallory.userId, alice.profileId)).toThrow();
    expect(() => equipment.renameGymProfile(mallory.userId, alice.profileId, 'pwned')).toThrow();
    expect(() => equipment.deleteGymProfile(mallory.userId, alice.profileId)).toThrow();
    expect(() =>
      equipment.toggleEquipmentAvailability(mallory.userId, alice.profileId, 'dumbbells', false),
    ).toThrow();
    // Alice's profile is intact.
    expect(equipment.getGymProfile(alice.userId, alice.profileId).profile.name).toContain('alice');
  });

  it('lists only the caller\'s own profiles', () => {
    const ids = equipment.listGymProfiles(mallory.userId).map((p) => p.id);
    expect(ids).not.toContain(alice.profileId);
  });
});

describe('plan isolation', () => {
  it('cannot read another user\'s plan', () => {
    expect(() => plans.getPlan(mallory.userId, alice.planId)).toThrow(/does not exist/i);
  });

  it('cannot edit another user\'s planned exercises', () => {
    expect(() =>
      plans.replacePlannedExercise(mallory.userId, alice.plannedExerciseId, 'push-up', 'x'),
    ).toThrow(/not part of one of your plans/i);
    expect(() => plans.removePlannedExercise(mallory.userId, alice.plannedExerciseId)).toThrow();
    expect(() =>
      plans.updatePlannedExerciseDose(mallory.userId, alice.plannedExerciseId, { sets: 99 }),
    ).toThrow();
    expect(() =>
      plans.addPlannedExercise(mallory.userId, alice.workoutDayId, 'push-up', {
        sets: 3,
        restSeconds: 60,
      }),
    ).toThrow();
  });

  it('leaves the victim\'s plan unchanged after every attempt', () => {
    const plan = plans.getActivePlan(alice.userId)!;
    const found = plan.days.flatMap((d) => d.exercises).find((e) => e.id === alice.plannedExerciseId);
    expect(found).toBeDefined();
    expect(found!.sets).toBeLessThan(99);
  });

  it('lists only the caller\'s own plan history', () => {
    const ids = plans.listPlanHistory(mallory.userId).map((p) => p.id);
    expect(ids).not.toContain(alice.planId);
  });
});

describe('session and log isolation', () => {
  it('cannot read another user\'s session', () => {
    expect(() => sessions.getSession(mallory.userId, alice.sessionId)).toThrow(/does not exist/i);
  });

  it('cannot write to another user\'s session', () => {
    expect(() => sessions.startSession(mallory.userId, alice.sessionId)).toThrow();
    expect(() =>
      sessions.logSet(mallory.userId, alice.sessionId, { exerciseId: 'push-up', setIndex: 1, reps: 1 }),
    ).toThrow();
    expect(() => sessions.completeSession(mallory.userId, alice.sessionId, {})).toThrow();
    expect(() => sessions.skipSession(mallory.userId, alice.sessionId)).toThrow();
    expect(() => sessions.rescheduleSession(mallory.userId, alice.sessionId, '2026-11-01')).toThrow();
    expect(() =>
      sessions.substituteInSession(mallory.userId, alice.sessionId, 'push-up', 'knee-push-up', 'x'),
    ).toThrow();
    expect(() => sessions.replaceSessionSnapshot(mallory.userId, alice.sessionId, [])).toThrow();
  });

  it('leaves the victim\'s session untouched', () => {
    const session = sessions.getSession(alice.userId, alice.sessionId);
    expect(session.status).toBe('scheduled');
    expect(session.logs.length).toBe(0);
  });

  it('lists only the caller\'s own sessions', () => {
    const ids = sessions.listSessions(mallory.userId, {}).map((s) => s.id);
    expect(ids).not.toContain(alice.sessionId);
  });
});

describe('RealitySync isolation', () => {
  it('cannot propose or apply an adaptation to another user\'s session', () => {
    expect(() =>
      realitysync.propose(mallory.userId, 'pro', {
        kind: 'time',
        sessionId: alice.sessionId,
        minutes: 20,
      }),
    ).toThrow();
    expect(() => realitysync.revertSession(mallory.userId, alice.sessionId)).toThrow();
  });
});

describe('nutrition isolation', () => {
  it('cannot read another user\'s meal plan', () => {
    expect(() => nutrition.getMealPlan(mallory.userId, alice.mealPlanId)).toThrow(/does not exist/i);
  });

  it('cannot swap or restatus another user\'s meals', () => {
    expect(() => nutrition.swapMeal(mallory.userId, alice.plannedMealId, 'dal-tadka')).toThrow(
      /does not exist/i,
    );
    expect(() => nutrition.setMealStatus(mallory.userId, alice.plannedMealId, 'cooked')).toThrow();
    expect(() => nutrition.mealAlternatives(mallory.userId, alice.plannedMealId)).toThrow();
  });

  it('cannot read or edit another user\'s grocery list', () => {
    expect(() => nutrition.getGroceryList(mallory.userId, alice.groceryListId)).toThrow(/does not exist/i);
    expect(() => nutrition.toggleGroceryItem(mallory.userId, alice.groceryItemId, true)).toThrow();
    expect(() => nutrition.deleteGroceryItem(mallory.userId, alice.groceryItemId)).toThrow();
    expect(() => nutrition.addGroceryItem(mallory.userId, alice.groceryListId, { customName: 'x' })).toThrow();
    expect(() => nutrition.shareGroceryList(mallory.userId, alice.groceryListId)).toThrow();
    expect(() => nutrition.deleteGroceryList(mallory.userId, alice.groceryListId)).toThrow();
  });

  it('deleting a pantry item scoped to another user is a no-op', () => {
    const before = nutrition.listPantry(alice.userId).length;
    nutrition.deletePantryItem(mallory.userId, alice.pantryItemId);
    expect(nutrition.listPantry(alice.userId).length).toBe(before);
  });

  it('lists only the caller\'s own lists and pantry', () => {
    expect(nutrition.listGroceryLists(mallory.userId).map((l) => l.id)).not.toContain(
      alice.groceryListId,
    );
    expect(nutrition.listPantry(mallory.userId).map((p) => p.id)).not.toContain(alice.pantryItemId);
  });
});

describe('progress isolation', () => {
  it('deleting another user\'s activity record is a no-op', () => {
    const before = progress.listActivities(alice.userId).length;
    progress.deleteActivity(mallory.userId, alice.activityId);
    expect(progress.listActivities(alice.userId).length).toBe(before);
  });

  it('reports only the caller\'s own numbers', () => {
    const overview = progress.progressOverview(mallory.userId, 'pro', 4);
    expect(overview.totals.activityMinutes).toBe(
      progress.listActivities(mallory.userId).reduce((s, a) => s + (a.minutes ?? 0), 0),
    );
  });
});

describe('FitBrain isolation', () => {
  it('answers only from the caller\'s own records', () => {
    const answer = fitbrain.ask({
      userId: mallory.userId,
      plan: 'pro',
      query: 'why am i doing these exercises',
    });
    expect(JSON.stringify(answer)).not.toContain(alice.planId);
    expect(JSON.stringify(answer)).not.toContain('alice-iso');
  });

  it('only exposes the caller\'s own memory', () => {
    plans.setPreference(alice.userId, 'disliked_exercises', ['burpee-x'], 'user');
    const memory = fitbrain.listMemory(mallory.userId);
    expect(JSON.stringify(memory)).not.toContain('burpee-x');
  });
});

describe('shared grocery lists', () => {
  it('a share token exposes only item names and quantities', () => {
    const token = nutrition.shareGroceryList(alice.userId, alice.groceryListId);
    const shared = nutrition.getSharedGroceryList(token)!;
    expect(shared.items.length).toBeGreaterThan(0);
    const text = JSON.stringify(shared);
    expect(text).not.toContain(alice.userId);
    expect(text).not.toContain('alice-iso@example.com');
    expect(Object.keys(shared)).toEqual(['name', 'items']);
  });

  it('an unknown or revoked token returns nothing', () => {
    expect(nutrition.getSharedGroceryList('not-a-real-token')).toBeNull();
    const token = nutrition.shareGroceryList(alice.userId, alice.groceryListId);
    nutrition.unshareGroceryList(alice.userId, alice.groceryListId);
    expect(nutrition.getSharedGroceryList(token)).toBeNull();
  });
});
