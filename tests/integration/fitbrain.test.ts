import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();

let account: typeof import('@/lib/services/account');
let equipment: typeof import('@/lib/services/equipment');
let plans: typeof import('@/lib/services/plans');
let sessions: typeof import('@/lib/services/sessions');
let nutrition: typeof import('@/lib/services/nutrition');
let fitbrain: typeof import('@/lib/services/fitbrain');
let userId: string;

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  equipment = await import('@/lib/services/equipment');
  plans = await import('@/lib/services/plans');
  sessions = await import('@/lib/services/sessions');
  nutrition = await import('@/lib/services/nutrition');
  fitbrain = await import('@/lib/services/fitbrain');

  userId = await account.registerUser({
    email: 'brain@example.com',
    password: 'fitbrain-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(userId, {
    displayName: 'Brain',
    ageBand: 'adult_18_plus',
    experience: 'regular',
    interests: ['strength_skills'],
    trainingDays: [1, 3, 5],
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
  nutrition.saveNutritionPrefs(userId, 'adult_18_plus', {
    diet: 'vegetarian',
    allergenIds: ['peanut'],
  });
}, 60_000);

afterAll(() => temp.cleanup());

const ask = (query: string) => fitbrain.ask({ userId, plan: 'pro', query });

describe('grounded answers', () => {
  it('marks every answer as computed, not generated', () => {
    expect(ask('why am i doing these exercises').grounded).toBe(true);
  });

  it('uses no language model and says so', () => {
    const provider = fitbrain.activeProvider();
    expect(provider.id).toBe('none');
    expect(provider.configured).toBe(false);
  });

  it('explains the real saved plan', () => {
    const answer = ask('explain my plan');
    expect(answer.intent).toBe('explain_plan');
    const plan = plans.getActivePlan(userId)!;
    expect(answer.text).toContain(plan.splitKind.replace(/_/g, ' '));
    expect(answer.bullets.length).toBeGreaterThan(2);
  });

  it('only lists exercises the active equipment profile allows', async () => {
    const answer = ask('exercises for my chest');
    const available = equipment.activeEquipmentSet(userId).set;
    const { EXERCISE_CATALOG } = await import('@/lib/content/exercises');
    const { checkEquipment } = await import('@/lib/engines/equipment');
    for (const source of answer.sources.filter((s) => s.kind === 'exercise')) {
      const match = EXERCISE_CATALOG.find((e) => e.name === source.label);
      if (match) expect(checkEquipment(match, available).ok).toBe(true);
    }
  });

  it('refuses to answer medical questions and points to a professional', () => {
    const answer = ask('my knee hurts during squats, what should I do');
    expect(answer.intent).toBe('safety_redirect');
    expect(answer.disclaimer).toMatch(/not medical/i);
    expect(answer.bullets.join(' ')).toMatch(/qualified professional/i);
    expect(answer.bullets.join(' ')).toMatch(/cannot diagnose/i);
  });

  it('never answers an appearance question', () => {
    const answer = ask('rate my body');
    expect(answer.intent).toBe('safety_redirect');
  });

  it('reports honestly when it cannot match a question', () => {
    const answer = ask('who won the cricket match last night');
    expect(answer.intent).toBe('unknown');
    expect(answer.text).toMatch(/could not match/i);
    expect(answer.bullets.join(' ')).toMatch(/not a general chatbot/i);
  });

  it('respects allergens when finding recipes', async () => {
    const answer = ask('dinner idea');
    const { RECIPE_CATALOG, deriveRecipeAllergens } = await import('@/lib/content/recipes');
    for (const source of answer.sources.filter((s) => s.kind === 'recipe')) {
      const recipe = RECIPE_CATALOG.find((r) => r.name === source.label);
      if (recipe) expect(deriveRecipeAllergens(recipe)).not.toContain('peanut');
    }
    expect(answer.disclaimer).toMatch(/allergen filtering/i);
  });

  it('builds a shorter session from the real plan', () => {
    const answer = ask('i only have 20 minutes today');
    expect(answer.intent).toBe('shorter_session');
    expect(answer.text).toMatch(/20-minute/i);
  });
});

describe('memory', () => {
  it('records a dislike and feeds it into the next plan', () => {
    const plan = plans.getActivePlan(userId)!;
    const target = plan.days.flatMap((d) => d.exercises)[0]!;
    const answer = fitbrain.ask({
      userId,
      plan: 'pro',
      query: `i don't like ${target.name}`,
    });
    expect(answer.intent).toBe('set_preference');
    expect(plans.getPreference<string[]>(userId, 'disliked_exercises', [])).toContain(
      target.exerciseId,
    );

    const draft = plans.buildPlanDraft(userId, { weekStart: '2026-11-02' });
    const ids = draft.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
    expect(ids).not.toContain(target.exerciseId);
  });

  it('records a favourite', () => {
    const answer = fitbrain.ask({ userId, plan: 'pro', query: 'goblet squat is a favourite' });
    expect(answer.intent).toBe('set_preference');
    expect(plans.getPreference<string[]>(userId, 'favourite_exercises', [])).toContain(
      'goblet-squat',
    );
  });

  it('exposes stored memory and lets it be forgotten', () => {
    const memory = fitbrain.listMemory(userId);
    expect(memory.some((m) => m.key === 'favourite_exercises')).toBe(true);
    fitbrain.removeFromListPreference(userId, 'favourite_exercises', 'goblet-squat');
    expect(plans.getPreference<string[]>(userId, 'favourite_exercises', [])).not.toContain(
      'goblet-squat',
    );
    fitbrain.forgetMemory(userId, 'disliked_exercises');
    expect(plans.getPreference<string[]>(userId, 'disliked_exercises', [])).toEqual([]);
  });
});

describe('entitlements', () => {
  it('limits assistant actions on the free plan', () => {
    let blocked = false;
    for (let i = 0; i < 15; i += 1) {
      const answer = fitbrain.ask({ userId, plan: 'free', query: 'explain my plan' });
      if (answer.text.toLowerCase().includes('part of gymos pro') || answer.text.includes('limit')) {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it('does not limit pro accounts', () => {
    for (let i = 0; i < 20; i += 1) {
      const answer = fitbrain.ask({ userId, plan: 'pro', query: 'explain my plan' });
      expect(answer.intent).toBe('explain_plan');
    }
  });
});
