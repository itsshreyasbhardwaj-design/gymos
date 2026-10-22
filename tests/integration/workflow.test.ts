/**
 * End-to-end domain workflow against a real database:
 * register → onboard → equipment → plan → schedule → log → complete → adapt.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();

let account: typeof import('@/lib/services/account');
let equipment: typeof import('@/lib/services/equipment');
let plans: typeof import('@/lib/services/plans');
let sessions: typeof import('@/lib/services/sessions');
let realitysync: typeof import('@/lib/services/realitysync');
let progress: typeof import('@/lib/services/progress');
let nutrition: typeof import('@/lib/services/nutrition');
let content: typeof import('@/lib/content/exercises');
let equipmentEngine: typeof import('@/lib/engines/equipment');
let substitution: typeof import('@/lib/engines/substitution');
let recipes: typeof import('@/lib/content/recipes');

let userId: string;

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  equipment = await import('@/lib/services/equipment');
  plans = await import('@/lib/services/plans');
  sessions = await import('@/lib/services/sessions');
  realitysync = await import('@/lib/services/realitysync');
  progress = await import('@/lib/services/progress');
  nutrition = await import('@/lib/services/nutrition');
  content = await import('@/lib/content/exercises');
  equipmentEngine = await import('@/lib/engines/equipment');
  substitution = await import('@/lib/engines/substitution');
  recipes = await import('@/lib/content/recipes');

  userId = await account.registerUser({
    email: 'workflow@example.com',
    password: 'workflow-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(userId, {
    displayName: 'Workflow',
    ageBand: 'adult_18_plus',
    experience: 'regular',
    interests: ['strength_skills', 'general_fitness'],
    trainingDays: [1, 3, 5],
    sessionMinutes: 45,
    environment: 'commercial_gym',
  });
  account.completeOnboarding(userId);
  account.devSetPlan(userId, 'pro');
});

afterAll(() => temp.cleanup());

describe('equipment profiles', () => {
  it('creates a profile and activates the first one automatically', () => {
    equipment.createGymProfile(userId, 'pro', {
      name: 'Main Gym',
      environment: 'commercial_gym',
      presetKey: 'commercial_gym',
    });
    const list = equipment.listGymProfiles(userId);
    expect(list.length).toBe(1);
    expect(list[0]!.isActive).toBe(true);
    expect(list[0]!.equipmentCount).toBeGreaterThan(20);
  });

  it('switches the active profile', () => {
    equipment.createGymProfile(userId, 'pro', {
      name: 'Home',
      environment: 'home',
      presetKey: 'minimal_home',
    });
    const home = equipment.listGymProfiles(userId).find((p) => p.name === 'Home')!;
    equipment.activateGymProfile(userId, home.id);
    expect(equipment.activeEquipmentSet(userId).profileName).toBe('Home');

    const gym = equipment.listGymProfiles(userId).find((p) => p.name === 'Main Gym')!;
    equipment.activateGymProfile(userId, gym.id);
    expect(equipment.activeEquipmentSet(userId).profileName).toBe('Main Gym');
  });

  it('enforces the free-plan profile limit on the server', () => {
    expect(() =>
      equipment.createGymProfile(userId, 'free', { name: 'Third', environment: 'travel' }),
    ).toThrow(/free plan includes 1/i);
  });

  it('marking equipment unavailable removes it from the active set', () => {
    const gym = equipment.listGymProfiles(userId).find((p) => p.name === 'Main Gym')!;
    expect(equipment.equipmentSetForProfile(gym.id).has('leg_press')).toBe(true);
    equipment.toggleEquipmentAvailability(userId, gym.id, 'leg_press', false);
    expect(equipment.equipmentSetForProfile(gym.id).has('leg_press')).toBe(false);
    equipment.toggleEquipmentAvailability(userId, gym.id, 'leg_press', true);
  });

  it('refuses to delete the last remaining profile', () => {
    const solo = equipment.listGymProfiles(userId);
    expect(solo.length).toBeGreaterThan(1);
    // Deleting down to one is fine; deleting the last is not.
    const home = solo.find((p) => p.name === 'Home')!;
    equipment.deleteGymProfile(userId, home.id);
    const remaining = equipment.listGymProfiles(userId);
    expect(remaining.length).toBe(1);
    expect(() => equipment.deleteGymProfile(userId, remaining[0]!.id)).toThrow(/at least one/i);
  });
});

describe('plan generation and persistence', () => {
  let planId: string;

  it('saves a generated plan with its days and exercises', () => {
    const draft = plans.buildPlanDraft(userId, { weekStart: '2026-10-19' });
    planId = plans.savePlan(userId, draft, { name: 'Test plan' });
    const saved = plans.getActivePlan(userId)!;
    expect(saved.id).toBe(planId);
    expect(saved.days.length).toBe(7);
    expect(saved.days.filter((d) => !d.isRest).length).toBe(3);
    expect(saved.explanation.length).toBeGreaterThan(2);
  });

  it('only persists exercises the active profile supports', () => {
    const available = equipment.activeEquipmentSet(userId).set;
    const saved = plans.getActivePlan(userId)!;
    for (const day of saved.days) {
      for (const item of day.exercises) {
        const seed = content.EXERCISE_BY_ID.get(item.exerciseId)!;
        expect(equipmentEngine.checkEquipment(seed, available).ok).toBe(true);
      }
    }
  });

  it('deactivates the previous plan when a new one is generated', () => {
    const draft = plans.buildPlanDraft(userId, { weekStart: '2026-10-26' });
    const second = plans.savePlan(userId, draft, { name: 'Second plan' });
    expect(plans.getActivePlan(userId)!.id).toBe(second);
    const history = plans.listPlanHistory(userId);
    expect(history.length).toBe(2);
    expect(history.filter((p) => p.isActive).length).toBe(1);
    // The old plan is kept, not deleted.
    expect(plans.getPlan(userId, planId).id).toBe(planId);
  });

  it('allows swapping a planned exercise and records the substitution', () => {
    const plan = plans.getActivePlan(userId)!;
    const day = plan.days.find((d) => d.exercises.length > 0)!;
    const target = day.exercises[0]!;
    const seed = content.EXERCISE_BY_ID.get(target.exerciseId)!;
    const options = substitution.findSubstitutes(seed, {
      availableEquipment: equipment.activeEquipmentSet(userId).set,
      ageBand: 'adult_18_plus',
      level: 'regular',
    });
    const replacement = options.options[0]!;
    plans.replacePlannedExercise(userId, target.id, replacement.exercise.id, 'testing a swap');
    const after = plans.getActivePlan(userId)!;
    const updated = after.days
      .flatMap((d) => d.exercises)
      .find((e) => e.id === target.id)!;
    expect(updated.exerciseId).toBe(replacement.exercise.id);
    expect(updated.substitutedFromExerciseId).toBe(target.exerciseId);
  });

  it('rejects editing a plan belonging to someone else', async () => {
    const otherId = await account.registerUser({
      email: 'other-plan@example.com',
      password: 'other-long-secret-x',
      acceptTerms: true,
    });
    const plan = plans.getActivePlan(userId)!;
    const target = plan.days.flatMap((d) => d.exercises)[0]!;
    expect(() =>
      plans.replacePlannedExercise(otherId, target.id, 'push-up', 'malicious'),
    ).toThrow(/not part of one of your plans/i);
  });
});

describe('scheduling and logging', () => {
  it('materialises the week once, idempotently', () => {
    const first = sessions.materialiseWeek(userId, '2026-10-26');
    expect(first.created).toBeGreaterThan(0);
    const second = sessions.materialiseWeek(userId, '2026-10-26');
    expect(second.created).toBe(0);
  });

  it('logs sets idempotently so a double submit cannot duplicate', () => {
    const list = sessions.listSessions(userId, { from: '2026-10-26', to: '2026-11-01' });
    const session = sessions.getSession(userId, list[list.length - 1]!.id);
    const exercise = session.exercises[0]!;
    sessions.startSession(userId, session.id);

    sessions.logSet(userId, session.id, { exerciseId: exercise.exerciseId, setIndex: 1, reps: 10, weightGrams: 20000 });
    sessions.logSet(userId, session.id, { exerciseId: exercise.exerciseId, setIndex: 1, reps: 12, weightGrams: 22000 });

    const after = sessions.getSession(userId, session.id);
    const logs = after.logs.filter((l) => l.exerciseId === exercise.exerciseId && l.setIndex === 1);
    expect(logs.length).toBe(1);
    expect(logs[0]!.reps).toBe(12);
  });

  it('completes a session, detects milestones and freezes it', () => {
    const list = sessions.listSessions(userId, { from: '2026-10-26', to: '2026-11-01' });
    const target = list.find((s) => s.status === 'in_progress')!;
    const result = sessions.completeSession(userId, target.id, {
      durationSeconds: 2400,
      feedback: { difficulty: 'about_right', recovery: 'ok' },
    });
    expect(result.alreadyCompleted).toBe(false);
    expect(result.milestones.length).toBeGreaterThan(0);
    expect(result.session.status).toBe('completed');

    // Completing again is a no-op rather than a duplicate.
    const again = sessions.completeSession(userId, target.id, {});
    expect(again.alreadyCompleted).toBe(true);

    // And the finished session can no longer be logged to.
    expect(() =>
      sessions.logSet(userId, target.id, { exerciseId: 'push-up', setIndex: 1, reps: 5 }),
    ).toThrow(/already finished/i);
  });

  it('refuses to reschedule or re-plan a completed session', () => {
    const completed = sessions.listSessions(userId, { status: ['completed'] })[0]!;
    expect(() => sessions.rescheduleSession(userId, completed.id, '2026-11-05')).toThrow(
      /history is never rewritten/i,
    );
    expect(() => sessions.replaceSessionSnapshot(userId, completed.id, [])).toThrow(
      /cannot be re-planned/i,
    );
  });

  it('regenerating a plan never destroys logged history', () => {
    const before = sessions.listSessions(userId, { status: ['completed'] });
    const logsBefore = sessions.getSession(userId, before[0]!.id).logs.length;

    const draft = plans.buildPlanDraft(userId, { weekStart: '2026-11-02' });
    plans.savePlan(userId, draft, { name: 'Third plan' });
    sessions.materialiseWeek(userId, '2026-11-02');

    const after = sessions.listSessions(userId, { status: ['completed'] });
    expect(after.length).toBe(before.length);
    expect(sessions.getSession(userId, before[0]!.id).logs.length).toBe(logsBefore);
  });
});

describe('RealitySync applied to real sessions', () => {
  it('proposes and applies an equipment change without touching history', () => {
    equipment.createGymProfile(userId, 'pro', {
      name: 'Travel',
      environment: 'travel',
      presetKey: 'travel',
    });
    const travel = equipment.listGymProfiles(userId).find((p) => p.name === 'Travel')!;
    const upcoming = sessions
      .listSessions(userId, { status: ['scheduled'] })
      .find((s) => s.scheduledDate >= '2026-11-02')!;

    const proposal = realitysync.propose(userId, 'pro', {
      kind: 'equipment',
      sessionId: upcoming.id,
      gymProfileId: travel.id,
    });
    expect('exercises' in proposal).toBe(true);

    realitysync.applyProposal(userId, 'pro', proposal, { sessionId: upcoming.id });
    const updated = sessions.getSession(userId, upcoming.id);
    const travelSet = equipment.equipmentSetForProfile(travel.id);
    for (const item of updated.exercises) {
      const seed = content.EXERCISE_BY_ID.get(item.exerciseId)!;
      expect(equipmentEngine.checkEquipment(seed, travelSet).ok).toBe(true);
    }
    expect(updated.source).toBe('adapted');

    const revisions = plans.listRevisions(userId);
    expect(revisions.length).toBeGreaterThan(0);
  });

  it('blocks RealitySync on the free plan at the server', () => {
    const upcoming = sessions.listSessions(userId, { status: ['scheduled'] })[0]!;
    expect(() =>
      realitysync.propose(userId, 'free', { kind: 'time', sessionId: upcoming.id, minutes: 20 }),
    ).toThrow(/Pro/i);
  });

  it('refuses to adapt a completed session', () => {
    const completed = sessions.listSessions(userId, { status: ['completed'] })[0]!;
    expect(() =>
      realitysync.propose(userId, 'pro', { kind: 'time', sessionId: completed.id, minutes: 20 }),
    ).toThrow(/already finished/i);
  });

  it('reverts an adapted session back to the plan', () => {
    const adapted = sessions
      .listSessions(userId, { status: ['scheduled'] })
      .map((s) => sessions.getSession(userId, s.id))
      .find((s) => s.source === 'adapted');
    if (!adapted) return;
    realitysync.revertSession(userId, adapted.id);
    expect(sessions.getSession(userId, adapted.id).source).toBe('planned');
  });
});

describe('progress reporting', () => {
  it('reports only what was actually logged', () => {
    const overview = progress.progressOverview(userId, 'pro', 4);
    expect(overview.totals.sessionsCompleted).toBeGreaterThan(0);
    expect(overview.totals.setsLogged).toBeGreaterThan(0);
    expect(overview.consistencyNote.length).toBeGreaterThan(0);
  });

  it('limits the history window on the free plan', () => {
    expect(progress.historyWindowStart('free')).not.toBeNull();
    expect(progress.historyWindowStart('pro')).toBeNull();
  });

  it('refuses to record biometrics without consent', () => {
    expect(() =>
      progress.recordBiometric(userId, { date: '2026-10-20', kind: 'steps', value: 8000, unit: 'count' }),
    ).toThrow(progress.ConsentRequiredError);
    expect(() => progress.listBiometrics(userId)).toThrow(progress.ConsentRequiredError);
  });

  it('records and deletes biometrics once consent is given', () => {
    account.setConsent(userId, 'biometrics', true);
    progress.recordBiometric(userId, { date: '2026-10-20', kind: 'steps', value: 8000, unit: 'count' });
    expect(progress.listBiometrics(userId).length).toBe(1);
    expect(progress.deleteAllBiometrics(userId)).toBe(1);
    expect(progress.listBiometrics(userId).length).toBe(0);
    account.setConsent(userId, 'biometrics', false);
  });
});

describe('nutrition workflow', () => {
  it('saves preferences, plans meals and builds a grocery list', () => {
    nutrition.saveNutritionPrefs(userId, 'adult_18_plus', {
      diet: 'vegetarian',
      allergenIds: ['peanut'],
      cuisines: ['bengali', 'north_indian'],
      maxPrepMinutes: 45,
      householdSize: 2,
    });
    const draft = nutrition.buildMealPlanDraft(userId, 'pro', { weekStart: '2026-10-19' });
    const planId = nutrition.saveMealPlan(userId, draft);
    const plan = nutrition.getMealPlan(userId, planId);
    expect(plan.meals.length).toBeGreaterThan(0);
    for (const meal of plan.meals) expect(meal.allergens).not.toContain('peanut');

    const listId = nutrition.generateGroceryList(userId, 'pro', { mealPlanId: planId });
    const list = nutrition.getGroceryList(userId, listId);
    expect(list.items.length).toBeGreaterThan(0);
    // No invented prices.
    expect(list.totalEstimatedPaise).toBeNull();
  });

  it('refuses a swap that would introduce a declared allergen', () => {
    const plan = nutrition.getActiveMealPlan(userId)!;
    const meal = plan.meals[0]!;
    const peanutRecipe = recipes.RECIPE_CATALOG.find((r) =>
      recipes.deriveRecipeAllergens(r).includes('peanut'),
    )!;
    expect(() => nutrition.swapMeal(userId, meal.id, peanutRecipe.id)).toThrow(/cannot be added/i);
  });

  it('allows a swap that passes every filter', () => {
    const plan = nutrition.getActiveMealPlan(userId)!;
    const meal = plan.meals[0]!;
    const alternatives = nutrition.mealAlternatives(userId, meal.id);
    expect(alternatives.length).toBeGreaterThan(0);
    nutrition.swapMeal(userId, meal.id, alternatives[0]!.recipeId);
    const updated = nutrition.getActiveMealPlan(userId)!.meals.find((m) => m.id === meal.id)!;
    expect(updated.recipeId).toBe(alternatives[0]!.recipeId);
    expect(updated.swappedFromRecipeId).toBe(meal.recipeId);
  });

  it('subtracts pantry stock from a regenerated list', () => {
    nutrition.upsertPantryItem(userId, 'pro', { ingredientId: 'onion', quantity: 5000, unit: 'g' });
    const listId = nutrition.generateGroceryList(userId, 'pro', {});
    const list = nutrition.getGroceryList(userId, listId);
    const onion = list.items.find((i) => i.ingredientId === 'onion');
    // Either fully covered (absent) or reduced.
    if (onion) expect(onion.quantity ?? 0).toBeLessThan(5000);
  });

  it('blocks pantry and grocery features on the free plan', () => {
    expect(() =>
      nutrition.upsertPantryItem(userId, 'free', { ingredientId: 'onion', quantity: 1, unit: 'g' }),
    ).toThrow(/Pro/i);
    expect(() => nutrition.generateGroceryList(userId, 'free', {})).toThrow(/Pro/i);
  });

  it('limits meal plan days on the free plan', () => {
    const draft = nutrition.buildMealPlanDraft(userId, 'free', { weekStart: '2026-11-09' });
    const dates = new Set(draft.meals.map((m) => m.date));
    expect(dates.size).toBeLessThanOrEqual(2);
    expect(draft.explanation.join(' ')).toMatch(/free plan covers/i);
  });
});
