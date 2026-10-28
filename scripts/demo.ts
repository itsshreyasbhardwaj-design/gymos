/**
 * Creates a clearly-labelled demo account with realistic data so the app can be
 * explored without hand-entering a month of workouts.
 *
 * Everything written here is fictional and the account is named so it cannot be
 * mistaken for a real user's records.
 */
import { registerUser, upsertProfile, completeOnboarding, devSetPlan, setConsent } from '../lib/services/account';
import { createGymProfile, activateGymProfile, listGymProfiles } from '../lib/services/equipment';
import { buildPlanDraft, savePlan, setPreference } from '../lib/services/plans';
import {
  materialiseWeek,
  listSessions,
  startSession,
  logSet,
  completeSession,
  getSession,
} from '../lib/services/sessions';
import { saveNutritionPrefs, buildMealPlanDraft, saveMealPlan, generateGroceryList, upsertPantryItem } from '../lib/services/nutrition';
import { addActivity } from '../lib/services/progress';
import { addDays, mondayOf } from '../lib/engines/nutrition';
import { db } from '../lib/db/client';
import { users } from '../lib/db/schema';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '../lib/auth/ids';
import { seedWellness } from './demo-wellness';

const DEMO_EMAIL = 'demo@gymos.local';
const DEMO_PASSWORD = 'sample-data-tiger-47';

async function main() {
  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalized, normalizeEmail(DEMO_EMAIL)))
    .get();
  if (existing) {
    console.log(`Demo account already exists (${DEMO_EMAIL}). Delete it from Settings → Privacy to recreate.`);
    return;
  }

  const userId = await registerUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    acceptTerms: true,
  });
  console.log(`created demo user ${userId}`);

  upsertProfile(userId, {
    displayName: 'Demo Account (sample data)',
    ageBand: 'adult_18_plus',
    experience: 'some',
    interests: ['general_fitness', 'strength_skills', 'cardiovascular'],
    trainingDays: [1, 3, 5],
    sessionMinutes: 45,
    scheduleFlexibility: 'some',
    environment: 'commercial_gym',
    activities: ['badminton'],
    limitations: [],
    timezone: 'Asia/Kolkata',
  });
  completeOnboarding(userId);
  devSetPlan(userId, 'pro');
  setConsent(userId, 'household_planning', true);

  createGymProfile(userId, 'pro', {
    name: 'Main Gym',
    environment: 'commercial_gym',
    presetKey: 'commercial_gym',
    notes: 'Sample commercial gym inventory.',
  });
  createGymProfile(userId, 'pro', {
    name: 'Home',
    environment: 'home',
    presetKey: 'minimal_home',
    notes: 'Dumbbells, bands and a mat.',
  });
  createGymProfile(userId, 'pro', {
    name: 'Travel',
    environment: 'travel',
    presetKey: 'travel',
    notes: 'Hotel room kit.',
  });
  const profiles = listGymProfiles(userId);
  const main = profiles.find((p) => p.name === 'Main Gym');
  if (main) activateGymProfile(userId, main.id);
  console.log(`created ${profiles.length} equipment profiles`);

  setPreference(userId, 'favourite_exercises', ['goblet-squat', 'lat-pulldown-ex'], 'onboarding');
  setPreference(userId, 'disliked_exercises', ['burpee-placeholder'], 'onboarding');

  // Plans for the last three weeks plus this week, so progress charts have data.
  const thisMonday = mondayOf(new Date().toISOString().slice(0, 10));
  for (let weekOffset = 3; weekOffset >= 0; weekOffset -= 1) {
    const weekStart = addDays(thisMonday, -7 * weekOffset);
    const draft = buildPlanDraft(userId, { weekStart });
    savePlan(userId, draft, { name: `Week of ${weekStart}` });
    materialiseWeek(userId, weekStart);
  }

  const today = new Date().toISOString().slice(0, 10);
  const sessions = listSessions(userId, { from: addDays(thisMonday, -21), to: today });
  let completed = 0;
  let setsLogged = 0;

  for (const summary of sessions) {
    if (summary.scheduledDate >= today) continue;
    // Skip roughly one session in six so "missed" handling has something to show.
    if (completed % 6 === 5) {
      completed += 1;
      continue;
    }
    startSession(userId, summary.id);
    const session = getSession(userId, summary.id);
    const weekIndex = Math.floor(
      (Date.parse(summary.scheduledDate) - Date.parse(addDays(thisMonday, -21))) / (7 * 86400000),
    );
    for (const ex of session.exercises) {
      for (let setIndex = 1; setIndex <= ex.sets; setIndex += 1) {
        if (ex.durationSeconds) {
          logSet(userId, summary.id, {
            exerciseId: ex.exerciseId,
            setIndex,
            durationSeconds: ex.durationSeconds + weekIndex * 3,
            rpe: 6,
          });
        } else {
          const reps = (ex.repsLow ?? 8) + ((setIndex + weekIndex) % 3);
          logSet(userId, summary.id, {
            exerciseId: ex.exerciseId,
            setIndex,
            reps,
            // Fictional but internally consistent loads that progress gently.
            weightGrams: loadFor(ex.exerciseId, weekIndex),
            rpe: 7,
          });
        }
        setsLogged += 1;
      }
    }
    completeSession(userId, summary.id, {
      durationSeconds: 45 * 60,
      feedback: {
        difficulty: completed % 4 === 0 ? 'hard' : 'about_right',
        recovery: completed % 5 === 0 ? 'tired' : 'ok',
        enjoyment: 4,
      },
    });
    completed += 1;
  }
  console.log(`logged ${setsLogged} sets across ${completed} past sessions`);

  for (let i = 1; i <= 14; i += 1) {
    if (i % 3 === 0) continue;
    addActivity(userId, {
      kind: i % 4 === 0 ? 'cycle' : 'walk',
      date: addDays(today, -i),
      minutes: 25 + (i % 3) * 10,
      steps: i % 4 === 0 ? undefined : 4000 + i * 150,
      notes: 'Sample activity record',
    });
  }

  saveNutritionPrefs(userId, 'adult_18_plus', {
    diet: 'vegetarian',
    cuisines: ['bengali', 'north_indian', 'home_style'],
    allergenIds: ['peanut'],
    dislikedIngredientIds: ['brinjal'],
    cookingSkill: 'intermediate',
    maxPrepMinutes: 45,
    householdSize: 2,
    includeSnacks: true,
  });
  const mealDraft = buildMealPlanDraft(userId, 'pro', { weekStart: thisMonday });
  const mealPlanId = saveMealPlan(userId, mealDraft);
  upsertPantryItem(userId, 'pro', { ingredientId: 'rice-basmati', quantity: 1000, unit: 'g' });
  upsertPantryItem(userId, 'pro', { ingredientId: 'toor-dal', quantity: 500, unit: 'g' });
  upsertPantryItem(userId, 'pro', { ingredientId: 'onion', quantity: 800, unit: 'g' });
  const listId = generateGroceryList(userId, 'pro', { mealPlanId });
  console.log(`meal plan ${mealPlanId} and grocery list ${listId} created`);

  seedWellness(userId, today);

  console.log('\n--- demo account ---');
  console.log(`email:    ${DEMO_EMAIL}`);
  console.log(`password: ${DEMO_PASSWORD}`);
  console.log('plan:     Pro (development grant, no payment involved)');
  console.log('All data in this account is fictional sample data.');
  console.log('Photo and voice consents are OFF, so no media is stored. Turn them on in');
  console.log('Settings → Media privacy if you want to try the journal or the recorder.');
}

/** Internally consistent fictional loads, in grams, that progress a little weekly. */
function loadFor(exerciseId: string, weekIndex: number): number | null {
  const base: Record<string, number> = {
    'barbell-back-squat': 60000,
    'barbell-bench-press': 45000,
    'barbell-row': 40000,
    'romanian-deadlift-barbell': 55000,
    'romanian-deadlift-dumbbell': 20000,
    'dumbbell-bench-press': 18000,
    'dumbbell-shoulder-press': 12000,
    'goblet-squat': 20000,
    'leg-press': 90000,
    'lat-pulldown-ex': 40000,
    'seated-row-machine-ex': 40000,
    'dumbbell-row': 22000,
    'dumbbell-curl': 10000,
    'cable-curl': 15000,
    'triceps-pushdown': 20000,
    'lateral-raise-dumbbell': 6000,
    'leg-extension-machine': 35000,
    'seated-leg-curl-machine': 30000,
    'hip-thrust-barbell': 50000,
    'bulgarian-split-squat': 12000,
  };
  const value = base[exerciseId];
  if (!value) return null;
  return value + weekIndex * 2500;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
