'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser, audit, revokeAllSessions, destroyCurrentSession } from '@/lib/auth/session';
import {
  buildPlanDraft,
  savePlan,
  replacePlannedExercise,
  removePlannedExercise,
  addPlannedExercise,
  updatePlannedExerciseDose,
  setPreference,
  getPreference,
  setRevisionStatus,
} from '@/lib/services/plans';
import {
  materialiseWeek,
  startSession,
  logSet,
  deleteLoggedSet,
  completeSession,
  skipSession,
  rescheduleSession,
  substituteInSession,
} from '@/lib/services/sessions';
import {
  createGymProfile,
  setProfileEquipment,
  activateGymProfile,
  renameGymProfile,
  deleteGymProfile,
  toggleEquipmentAvailability,
  createCustomEquipment,
} from '@/lib/services/equipment';
import { propose, applyProposal, revertSession } from '@/lib/services/realitysync';
import {
  saveNutritionPrefs,
  buildMealPlanDraft,
  saveMealPlan,
  swapMeal,
  setMealStatus,
  generateGroceryList,
  toggleGroceryItem,
  addGroceryItem,
  deleteGroceryItem,
  shareGroceryList,
  unshareGroceryList,
  deleteGroceryList,
  upsertPantryItem,
  deletePantryItem,
  recordIngredientPrice,
} from '@/lib/services/nutrition';
import {
  addActivity,
  deleteActivity,
  recordBiometric,
  deleteAllBiometrics,
} from '@/lib/services/progress';
import {
  upsertProfile,
  setConsent,
  changePassword,
  recordExport,
  buildExport,
  deleteAccount,
  devSetPlan,
  markNotificationRead,
  type ConsentKind,
} from '@/lib/services/account';
import { forgetMemory, removeFromListPreference } from '@/lib/services/fitbrain';

export interface ActionState {
  error?: string;
  success?: string;
}

/** Wraps an action so a thrown service error becomes a readable message. */
async function run(fn: () => void | Promise<void>, success: string): Promise<ActionState> {
  try {
    await fn();
    return { success };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

/* ------------------------------------------------------------------- plans */

/** Void-returning variants for plain `<form action={...}>` usage. */
export async function regeneratePlanFormAction(): Promise<void> {
  await regeneratePlanAction();
}

export async function materialiseWeekFormAction(): Promise<void> {
  await materialiseWeekAction();
}

export async function generateMealPlanFormAction(): Promise<void> {
  await generateMealPlanAction();
}

export async function generateGroceryListFormAction(): Promise<void> {
  await generateGroceryListAction();
}

export async function regeneratePlanAction(): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => {
    const draft = buildPlanDraft(user.id);
    savePlan(user.id, draft, { name: `Plan ${new Date().toISOString().slice(0, 10)}` });
    materialiseWeek(user.id);
  }, 'New plan generated. Your completed workouts are untouched.');
  revalidatePath('/workouts');
  revalidatePath('/dashboard');
  return result;
}

export async function replaceExerciseAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      replacePlannedExercise(
        user.id,
        String(formData.get('plannedExerciseId')),
        String(formData.get('exerciseId')),
        String(formData.get('reason') ?? ''),
      ),
    'Exercise swapped.',
  );
  revalidatePath('/workouts/plan');
  return result;
}

export async function removeExerciseAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => removePlannedExercise(user.id, String(formData.get('plannedExerciseId'))),
    'Exercise removed from the plan.',
  );
  revalidatePath('/workouts/plan');
  return result;
}

export async function addExerciseAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      addPlannedExercise(user.id, String(formData.get('workoutDayId')), String(formData.get('exerciseId')), {
        sets: Number(formData.get('sets') ?? 3),
        repsLow: Number(formData.get('repsLow') ?? 8),
        repsHigh: Number(formData.get('repsHigh') ?? 12),
        restSeconds: Number(formData.get('restSeconds') ?? 60),
      }),
    'Exercise added.',
  );
  revalidatePath('/workouts/plan');
  return result;
}

export async function updateDoseAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      updatePlannedExerciseDose(user.id, String(formData.get('plannedExerciseId')), {
        sets: Number(formData.get('sets')),
        repsLow: formData.get('repsLow') ? Number(formData.get('repsLow')) : null,
        repsHigh: formData.get('repsHigh') ? Number(formData.get('repsHigh')) : null,
        restSeconds: Number(formData.get('restSeconds')),
      }),
    'Updated.',
  );
  revalidatePath('/workouts/plan');
  return result;
}

/* ---------------------------------------------------------------- sessions */

export async function startSessionAction(sessionId: string): Promise<void> {
  const user = await requireUser();
  startSession(user.id, sessionId);
  redirect(`/workouts/session/${sessionId}`);
}

export async function logSetAction(input: {
  sessionId: string;
  exerciseId: string;
  setIndex: number;
  reps?: number | null;
  weightGrams?: number | null;
  durationSeconds?: number | null;
  rpe?: number | null;
  skipped?: boolean;
}): Promise<ActionState> {
  const user = await requireUser();
  return run(() => logSet(user.id, input.sessionId, input), 'Set saved.');
}

export async function deleteSetAction(
  sessionId: string,
  exerciseId: string,
  setIndex: number,
): Promise<ActionState> {
  const user = await requireUser();
  return run(() => deleteLoggedSet(user.id, sessionId, exerciseId, setIndex), 'Set removed.');
}

export async function completeSessionAction(input: {
  sessionId: string;
  durationSeconds?: number;
  notes?: string;
  difficulty?: 'too_easy' | 'about_right' | 'hard' | 'too_hard';
  recovery?: 'fresh' | 'ok' | 'tired' | 'very_tired';
  enjoyment?: number;
  discomfortReported?: boolean;
  discomfortNote?: string;
  idempotencyKey?: string;
}): Promise<{ error?: string; milestones?: string[] }> {
  const user = await requireUser();
  try {
    const result = completeSession(user.id, input.sessionId, {
      durationSeconds: input.durationSeconds,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      feedback: {
        difficulty: input.difficulty,
        recovery: input.recovery,
        enjoyment: input.enjoyment,
        discomfortReported: input.discomfortReported,
        discomfortNote: input.discomfortNote,
      },
    });
    revalidatePath('/dashboard');
    revalidatePath('/workouts');
    revalidatePath('/progress');
    return { milestones: result.milestones.map((m) => m.label) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not finish the workout.' };
  }
}

export async function substituteInSessionAction(input: {
  sessionId: string;
  fromExerciseId: string;
  toExerciseId: string;
  reason: string;
}): Promise<ActionState> {
  const user = await requireUser();
  return run(
    () =>
      void substituteInSession(
        user.id,
        input.sessionId,
        input.fromExerciseId,
        input.toExerciseId,
        input.reason,
      ),
    'Swapped for this session.',
  );
}

export async function skipSessionAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => skipSession(user.id, String(formData.get('sessionId')), String(formData.get('reason') ?? '')),
    'Session skipped. Nothing is added to your other days.',
  );
  revalidatePath('/dashboard');
  revalidatePath('/calendar');
  return result;
}

export async function rescheduleSessionAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => rescheduleSession(user.id, String(formData.get('sessionId')), String(formData.get('date'))),
    'Session moved.',
  );
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  return result;
}

export async function materialiseWeekAction(): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => void materialiseWeek(user.id), 'Week scheduled.');
  revalidatePath('/calendar');
  return result;
}

/* -------------------------------------------------------------- RealitySync */

export async function proposeAdaptationAction(input: {
  kind: 'equipment' | 'time' | 'unavailable' | 'difficulty' | 'missed' | 'schedule';
  sessionId?: string;
  gymProfileId?: string;
  minutes?: number;
  equipmentTypeId?: string;
  newDays?: number[];
}) {
  const user = await requireUser();
  try {
    const proposal = propose(user.id, user.plan, input as never);
    return { proposal };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not build a proposal.' };
  }
}

export async function applyAdaptationAction(input: {
  proposal: unknown;
  sessionId?: string;
}): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => void applyProposal(user.id, user.plan, input.proposal as never, { sessionId: input.sessionId }),
    'Change applied. You can revert it from the session.',
  );
  revalidatePath('/dashboard');
  revalidatePath('/workouts');
  revalidatePath('/calendar');
  return result;
}

export async function revertSessionAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => revertSession(user.id, String(formData.get('sessionId'))),
    'Session restored to the original plan.',
  );
  revalidatePath('/workouts');
  return result;
}

export async function setRevisionStatusAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      setRevisionStatus(
        user.id,
        String(formData.get('revisionId')),
        String(formData.get('status')) as never,
      ),
    'Updated.',
  );
  revalidatePath('/workouts/history');
  return result;
}

/* --------------------------------------------------------------- equipment */

export async function createGymProfileAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(() => {
    createGymProfile(user.id, user.plan, {
      name: String(formData.get('name') ?? 'New setup'),
      environment: String(formData.get('environment') ?? 'home'),
      presetKey: String(formData.get('presetKey') ?? '') || undefined,
      notes: String(formData.get('notes') ?? ''),
    });
  }, 'Equipment profile created.');
  revalidatePath('/equipment');
  return result;
}

export async function saveProfileEquipmentAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const ids = formData.getAll('equipment').map(String);
  const result = await run(
    () => setProfileEquipment(user.id, String(formData.get('profileId')), ids),
    'Equipment updated. Your plans will use it from the next generation.',
  );
  revalidatePath('/equipment');
  return result;
}

export async function activateProfileAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => activateGymProfile(user.id, String(formData.get('profileId'))),
    'Active location changed.',
  );
  revalidatePath('/equipment');
  revalidatePath('/dashboard');
  return result;
}

export async function renameProfileAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      renameGymProfile(
        user.id,
        String(formData.get('profileId')),
        String(formData.get('name')),
        String(formData.get('notes') ?? ''),
      ),
    'Saved.',
  );
  revalidatePath('/equipment');
  return result;
}

export async function deleteProfileAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => deleteGymProfile(user.id, String(formData.get('profileId'))),
    'Profile deleted.',
  );
  revalidatePath('/equipment');
  return result;
}

export async function toggleEquipmentAction(
  profileId: string,
  equipmentTypeId: string,
  available: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => toggleEquipmentAvailability(user.id, profileId, equipmentTypeId, available),
    available ? 'Marked available.' : 'Marked unavailable.',
  );
  revalidatePath('/equipment');
  return result;
}

export async function createCustomEquipmentAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(() => {
    createCustomEquipment(user.id, user.plan, {
      name: String(formData.get('name')),
      category: String(formData.get('category') ?? 'mobility_other'),
      description: String(formData.get('description') ?? ''),
    });
  }, 'Custom equipment added.');
  revalidatePath('/equipment');
  return result;
}

/* --------------------------------------------------------------- nutrition */

export async function saveNutritionPrefsAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(() => {
    saveNutritionPrefs(user.id, (user.ageBand ?? 'adult_18_plus') as never, {
      diet: String(formData.get('diet') ?? 'no_preference') as never,
      cuisines: formData.getAll('cuisines').map(String),
      allergenIds: formData.getAll('allergens').map(String),
      dislikedIngredientIds: formData.getAll('dislikes').map(String),
      cookingSkill: String(formData.get('cookingSkill') ?? 'beginner') as never,
      maxPrepMinutes: Number(formData.get('maxPrepMinutes') ?? 45),
      householdSize: Number(formData.get('householdSize') ?? 1),
      includeSnacks: formData.get('includeSnacks') === 'on',
      medicalDietaryNote: String(formData.get('medicalDietaryNote') ?? ''),
    });
  }, 'Food preferences saved.');
  revalidatePath('/nutrition');
  return result;
}

export async function generateMealPlanAction(): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => {
    const draft = buildMealPlanDraft(user.id, user.plan);
    saveMealPlan(user.id, draft);
  }, 'Meal plan created.');
  revalidatePath('/nutrition/meal-plan');
  return result;
}

export async function swapMealAction(plannedMealId: string, recipeId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => swapMeal(user.id, plannedMealId, recipeId), 'Meal swapped.');
  revalidatePath('/nutrition/meal-plan');
  return result;
}

export async function setMealStatusAction(
  plannedMealId: string,
  status: 'planned' | 'cooked' | 'skipped',
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => setMealStatus(user.id, plannedMealId, status), 'Updated.');
  revalidatePath('/nutrition/meal-plan');
  return result;
}

export async function generateGroceryListAction(): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => {
    generateGroceryList(user.id, user.plan, {});
  }, 'Grocery list created from your meal plan.');
  revalidatePath('/nutrition/groceries');
  return result;
}

export async function toggleGroceryItemAction(itemId: string, purchased: boolean) {
  const user = await requireUser();
  const result = await run(() => toggleGroceryItem(user.id, itemId, purchased), 'Updated.');
  revalidatePath('/nutrition/groceries');
  return result;
}

export async function addGroceryItemAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      addGroceryItem(user.id, String(formData.get('listId')), {
        customName: String(formData.get('customName') ?? ''),
        quantity: formData.get('quantity') ? Number(formData.get('quantity')) : undefined,
        unit: String(formData.get('unit') ?? '') || undefined,
      }),
    'Item added.',
  );
  revalidatePath('/nutrition/groceries');
  return result;
}

export async function deleteGroceryItemAction(itemId: string) {
  const user = await requireUser();
  const result = await run(() => deleteGroceryItem(user.id, itemId), 'Item removed.');
  revalidatePath('/nutrition/groceries');
  return result;
}

export async function shareGroceryListAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  try {
    const token = shareGroceryList(user.id, String(formData.get('listId')));
    revalidatePath('/nutrition/groceries');
    return { success: `Share link created: /share/groceries/${token}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not share the list.' };
  }
}

export async function unshareGroceryListAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => unshareGroceryList(user.id, String(formData.get('listId'))),
    'Sharing turned off.',
  );
  revalidatePath('/nutrition/groceries');
  return result;
}

export async function deleteGroceryListAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => deleteGroceryList(user.id, String(formData.get('listId'))),
    'List deleted.',
  );
  revalidatePath('/nutrition/groceries');
  return result;
}

export async function addPantryItemAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(() => {
    upsertPantryItem(user.id, user.plan, {
      ingredientId: String(formData.get('ingredientId')),
      quantity: Number(formData.get('quantity') ?? 0),
      unit: String(formData.get('unit') ?? 'g'),
      bestBefore: String(formData.get('bestBefore') ?? '') || null,
      notes: String(formData.get('notes') ?? ''),
    });
  }, 'Pantry updated.');
  revalidatePath('/nutrition/pantry');
  return result;
}

export async function deletePantryItemAction(id: string) {
  const user = await requireUser();
  const result = await run(() => deletePantryItem(user.id, id), 'Removed from pantry.');
  revalidatePath('/nutrition/pantry');
  return result;
}

export async function recordPriceAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      recordIngredientPrice(user.id, {
        ingredientId: String(formData.get('ingredientId')),
        pricePaise: Math.round(Number(formData.get('rupees') ?? 0) * 100),
        perQuantity: Number(formData.get('perQuantity') ?? 1),
        unit: String(formData.get('unit') ?? 'g'),
      }),
    'Price recorded. Future lists will use it.',
  );
  revalidatePath('/nutrition/groceries');
  return result;
}

/* ---------------------------------------------------------------- progress */

export async function addActivityAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      addActivity(user.id, {
        kind: String(formData.get('kind') ?? 'walk') as never,
        date: String(formData.get('date') ?? new Date().toISOString().slice(0, 10)),
        minutes: formData.get('minutes') ? Number(formData.get('minutes')) : undefined,
        distanceMeters: formData.get('distanceKm')
          ? Math.round(Number(formData.get('distanceKm')) * 1000)
          : undefined,
        steps: formData.get('steps') ? Number(formData.get('steps')) : undefined,
        notes: String(formData.get('notes') ?? ''),
      }),
    'Activity recorded.',
  );
  revalidatePath('/progress');
  return result;
}

export async function deleteActivityAction(id: string) {
  const user = await requireUser();
  const result = await run(() => deleteActivity(user.id, id), 'Activity removed.');
  revalidatePath('/progress');
  return result;
}

export async function recordBiometricAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () =>
      recordBiometric(user.id, {
        date: String(formData.get('date') ?? new Date().toISOString().slice(0, 10)),
        kind: String(formData.get('kind') ?? 'steps') as never,
        value: Number(formData.get('value') ?? 0),
        unit: String(formData.get('unit') ?? 'count'),
      }),
    'Recorded.',
  );
  revalidatePath('/progress');
  return result;
}

export async function deleteBiometricsAction(): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => {
    deleteAllBiometrics(user.id);
  }, 'All biometric records deleted.');
  revalidatePath('/settings/privacy');
  return result;
}

/* ----------------------------------------------------------------- account */

export async function saveProfileAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(() => {
    upsertProfile(user.id, {
      displayName: String(formData.get('displayName') ?? ''),
      experience: String(formData.get('experience') ?? 'new') as never,
      interests: formData.getAll('interests').map(String),
      trainingDays: formData.getAll('trainingDays').map(Number),
      sessionMinutes: Number(formData.get('sessionMinutes') ?? 45),
      scheduleFlexibility: String(formData.get('scheduleFlexibility') ?? 'some') as never,
      environment: String(formData.get('environment') ?? 'home'),
      limitations: formData.getAll('limitations').map(String),
      units: String(formData.get('units') ?? 'metric') as never,
      timezone: String(formData.get('timezone') ?? 'Asia/Kolkata'),
      accessibility: {
        reduceMotion: formData.get('reduceMotion') === 'on',
        largeText: formData.get('largeText') === 'on',
        highContrast: formData.get('highContrast') === 'on',
      },
    });
  }, 'Profile saved.');
  revalidatePath('/settings/profile');
  revalidatePath('/dashboard');
  return result;
}

export async function setConsentAction(kind: ConsentKind, granted: boolean): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => {
    setConsent(user.id, kind, granted);
  }, granted ? 'Consent recorded.' : 'Consent withdrawn.');
  revalidatePath('/settings/privacy');
  return result;
}

export async function changePasswordAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  try {
    await changePassword(
      user.id,
      String(formData.get('currentPassword')),
      String(formData.get('newPassword')),
    );
    revokeAllSessions(user.id, user.sessionId);
    await audit('auth.password_changed', { userId: user.id });
    return { success: 'Password changed. Other signed-in sessions were signed out.' };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not change the password.' };
  }
}

export async function revokeOtherSessionsAction(): Promise<ActionState> {
  const user = await requireUser();
  const count = revokeAllSessions(user.id, user.sessionId);
  await audit('auth.sessions_revoked', { userId: user.id, meta: { count } });
  revalidatePath('/settings/security');
  return { success: `${count} other session(s) signed out.` };
}

export async function exportDataAction(): Promise<{ error?: string; json?: string }> {
  const user = await requireUser();
  try {
    recordExport(user.id);
    await audit('privacy.export', { userId: user.id });
    return { json: JSON.stringify(buildExport(user.id), null, 2) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Export failed.' };
  }
}

export async function deleteAccountAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  if (String(formData.get('confirm')) !== 'DELETE') {
    return { error: 'Type DELETE exactly to confirm.' };
  }
  await audit('privacy.account_deleted', { userId: user.id });
  deleteAccount(user.id);
  await destroyCurrentSession();
  redirect('/?deleted=1');
}

export async function devSetPlanAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const plan = String(formData.get('plan')) === 'pro' ? 'pro' : 'free';
  const result = await run(() => {
    devSetPlan(user.id, plan);
  }, `Development plan switched to ${plan}. No payment was involved.`);
  revalidatePath('/settings/subscription');
  revalidatePath('/dashboard');
  return result;
}

export async function markNotificationReadAction(id: string): Promise<void> {
  const user = await requireUser();
  markNotificationRead(user.id, id);
  revalidatePath('/dashboard');
}

/* ---------------------------------------------------------------- fitbrain */

export async function forgetMemoryAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => forgetMemory(user.id, String(formData.get('key'))),
    'Forgotten.',
  );
  revalidatePath('/fitbrain/memory');
  return result;
}

export async function removePreferenceItemAction(_prev: ActionState, formData: FormData) {
  const user = await requireUser();
  const result = await run(
    () => removeFromListPreference(user.id, String(formData.get('key')), String(formData.get('value'))),
    'Updated.',
  );
  revalidatePath('/fitbrain/memory');
  return result;
}

export async function toggleFavouriteExerciseAction(exerciseId: string): Promise<ActionState> {
  const user = await requireUser();
  const current = new Set(getPreference<string[]>(user.id, 'favourite_exercises', []));
  const nowFavourite = !current.has(exerciseId);
  if (nowFavourite) current.add(exerciseId);
  else current.delete(exerciseId);
  setPreference(user.id, 'favourite_exercises', [...current], 'user');
  revalidatePath(`/exercises/${exerciseId}`);
  return { success: nowFavourite ? 'Added to favourites.' : 'Removed from favourites.' };
}

export async function toggleDislikedExerciseAction(exerciseId: string): Promise<ActionState> {
  const user = await requireUser();
  const current = new Set(getPreference<string[]>(user.id, 'disliked_exercises', []));
  const nowDisliked = !current.has(exerciseId);
  if (nowDisliked) current.add(exerciseId);
  else current.delete(exerciseId);
  setPreference(user.id, 'disliked_exercises', [...current], 'user');
  revalidatePath(`/exercises/${exerciseId}`);
  return {
    success: nowDisliked
      ? 'Noted — this will be left out of future plans.'
      : 'This can appear in plans again.',
  };
}
