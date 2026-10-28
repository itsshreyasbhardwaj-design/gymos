'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { parseObservedOutcome } from '@/lib/engines/care';
import {
  createRoutine,
  updateRoutine,
  deleteRoutine,
  moveRoutineStep,
  addRoutineStep,
  deleteRoutineStep,
  logRoutineDone,
  unlogRoutine,
  createAppointment,
  updateAppointment,
  deleteAppointment,
} from '@/lib/services/grooming';
import {
  createProduct,
  updateProduct,
  deleteProduct,
  upsertJournalEntry,
  deleteJournalEntry,
  startPatchTest,
  observePatchTest,
  deletePatchTest,
} from '@/lib/services/skincare';

/**
 * Server actions for the grooming and skincare pages.
 *
 * Same shape as app/(app)/actions.ts: a thrown service error becomes a readable
 * message, and nothing is written outside the service layer.
 */

export interface ActionState {
  error?: string;
  success?: string;
}

async function run(fn: () => void | Promise<void>, success: string): Promise<ActionState> {
  try {
    await fn();
    return { success };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

const GROOMING_PATHS = ['/grooming', '/grooming/routines'] as const;

function revalidateGrooming(): void {
  for (const path of GROOMING_PATHS) revalidatePath(path);
}

function revalidateSkincare(): void {
  revalidatePath('/skincare');
  revalidatePath('/grooming');
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function optionalText(formData: FormData, key: string): string | null {
  const value = text(formData, key).trim();
  return value.length > 0 ? value : null;
}

function numberOrNull(formData: FormData, key: string): number | null {
  const raw = text(formData, key).trim();
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function checked(formData: FormData, key: string): boolean {
  return text(formData, key) === 'on' || text(formData, key) === 'true';
}

function days(formData: FormData): number[] {
  return formData
    .getAll('daysOfWeek')
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

function list(formData: FormData, key: string): string[] {
  return text(formData, key)
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Parallel `stepLabel` / `stepProductId` / `stepNotes` fields, in form order. */
function steps(formData: FormData) {
  const labels = formData.getAll('stepLabel').map((v) => String(v));
  const productIds = formData.getAll('stepProductId').map((v) => String(v));
  const notes = formData.getAll('stepNotes').map((v) => String(v));
  return labels.map((label, index) => ({
    label,
    productId: productIds[index] ? productIds[index]! : null,
    notes: notes[index] ?? '',
  }));
}

/* ---------------------------------------------------------------- routines */

export async function createRoutineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      void createRoutine(user.id, user.plan, {
        name: text(formData, 'name'),
        slot: text(formData, 'slot') || 'morning',
        daysOfWeek: days(formData),
        notes: text(formData, 'notes'),
        steps: steps(formData),
      }),
    'Routine saved.',
  );
  revalidateGrooming();
  return result;
}

export async function updateRoutineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      updateRoutine(user.id, text(formData, 'routineId'), {
        name: text(formData, 'name'),
        slot: text(formData, 'slot') || 'morning',
        daysOfWeek: days(formData),
        notes: text(formData, 'notes'),
        active: checked(formData, 'active'),
      }),
    'Routine updated.',
  );
  revalidateGrooming();
  return result;
}

export async function setRoutineActiveAction(
  routineId: string,
  active: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => updateRoutine(user.id, routineId, { active }),
    active ? 'Routine switched on.' : 'Routine paused. Nothing has been deleted.',
  );
  revalidateGrooming();
  return result;
}

export async function deleteRoutineAction(routineId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteRoutine(user.id, routineId), 'Routine deleted.');
  revalidateGrooming();
  return result;
}

export async function moveRoutineStepAction(
  stepId: string,
  direction: 'up' | 'down',
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => moveRoutineStep(user.id, stepId, direction),
    direction === 'up' ? 'Step moved up.' : 'Step moved down.',
  );
  revalidateGrooming();
  return result;
}

export async function addRoutineStepAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      void addRoutineStep(user.id, text(formData, 'routineId'), {
        label: text(formData, 'label'),
        productId: optionalText(formData, 'productId'),
        notes: text(formData, 'notes'),
      }),
    'Step added.',
  );
  revalidateGrooming();
  return result;
}

export async function deleteRoutineStepAction(stepId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteRoutineStep(user.id, stepId), 'Step removed.');
  revalidateGrooming();
  return result;
}

/* -------------------------------------------------------------------- logs */

export async function logRoutineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      void logRoutineDone(user.id, text(formData, 'routineId'), {
        date: text(formData, 'date'),
        completedStepIds: formData.getAll('completedStepIds').map((v) => String(v)),
        note: text(formData, 'note'),
      }),
    'Logged for today.',
  );
  revalidateGrooming();
  return result;
}

export async function markRoutineDoneAction(
  routineId: string,
  date: string,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => void logRoutineDone(user.id, routineId, { date }),
    'Logged for today.',
  );
  revalidateGrooming();
  return result;
}

export async function unlogRoutineAction(routineId: string, date: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => unlogRoutine(user.id, routineId, date), 'Log removed.');
  revalidateGrooming();
  return result;
}

/* ------------------------------------------------------------ appointments */

export async function createAppointmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      void createAppointment(user.id, {
        title: text(formData, 'title'),
        kind: text(formData, 'kind') || 'other',
        scheduledAt: text(formData, 'scheduledAt'),
        location: text(formData, 'location'),
        notes: text(formData, 'notes'),
      }),
    'Appointment saved.',
  );
  revalidateGrooming();
  return result;
}

export async function completeAppointmentAction(
  appointmentId: string,
  completed: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => updateAppointment(user.id, appointmentId, { completed }),
    completed ? 'Marked as done.' : 'Moved back to upcoming.',
  );
  revalidateGrooming();
  return result;
}

export async function deleteAppointmentAction(appointmentId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => deleteAppointment(user.id, appointmentId),
    'Appointment deleted.',
  );
  revalidateGrooming();
  return result;
}

/* ---------------------------------------------------------------- products */

export async function createProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const rupees = numberOrNull(formData, 'priceRupees');
  const result = await run(
    () =>
      void createProduct(user.id, {
        name: text(formData, 'name'),
        brand: text(formData, 'brand'),
        category: text(formData, 'category') || 'other',
        keyIngredients: list(formData, 'keyIngredients'),
        openedAt: optionalText(formData, 'openedAt'),
        expiresAt: optionalText(formData, 'expiresAt'),
        paoMonths: numberOrNull(formData, 'paoMonths'),
        // Rupees in the form, whole paise in the row. No float ever reaches the db.
        pricePaise: rupees == null ? null : Math.round(rupees * 100),
        notes: text(formData, 'notes'),
      }),
    'Product added.',
  );
  revalidateSkincare();
  return result;
}

export async function updateProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const rupees = numberOrNull(formData, 'priceRupees');
  const result = await run(
    () =>
      updateProduct(user.id, text(formData, 'productId'), {
        name: text(formData, 'name'),
        brand: text(formData, 'brand'),
        category: text(formData, 'category') || 'other',
        keyIngredients: list(formData, 'keyIngredients'),
        openedAt: optionalText(formData, 'openedAt'),
        expiresAt: optionalText(formData, 'expiresAt'),
        paoMonths: numberOrNull(formData, 'paoMonths'),
        pricePaise: rupees == null ? null : Math.round(rupees * 100),
        notes: text(formData, 'notes'),
      }),
    'Product updated.',
  );
  revalidateSkincare();
  return result;
}

export async function setProductRunningLowAction(
  productId: string,
  runningLow: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => updateProduct(user.id, productId, { runningLow }),
    runningLow ? 'Marked as running low.' : 'Running-low flag cleared.',
  );
  revalidateSkincare();
  return result;
}

export async function archiveProductAction(
  productId: string,
  archived: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => updateProduct(user.id, productId, { archived }),
    archived ? 'Moved out of your shelf.' : 'Back on your shelf.',
  );
  revalidateSkincare();
  return result;
}

export async function deleteProductAction(productId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteProduct(user.id, productId), 'Product deleted.');
  revalidateSkincare();
  return result;
}

/* ----------------------------------------------------------------- journal */

export async function saveJournalEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const comfort = numberOrNull(formData, 'comfort');
  const result = await run(
    () =>
      void upsertJournalEntry(user.id, {
        date: text(formData, 'date'),
        comfort: comfort == null ? null : Math.round(comfort),
        concerns: list(formData, 'concerns'),
        productIdsUsed: formData.getAll('productIdsUsed').map((v) => String(v)),
        note: text(formData, 'note'),
      }),
    'Journal entry saved.',
  );
  revalidateSkincare();
  return result;
}

export async function deleteJournalEntryAction(entryId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteJournalEntry(user.id, entryId), 'Entry deleted.');
  revalidateSkincare();
  return result;
}

/* ------------------------------------------------------------- patch tests */

export async function startPatchTestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const hours = numberOrNull(formData, 'windowHours');
  const result = await run(
    () =>
      void startPatchTest(user.id, {
        productId: text(formData, 'productId'),
        windowHours: hours == null ? undefined : Math.round(hours),
        note: text(formData, 'note'),
      }),
    'Patch test started. Nothing is concluded until you record what you see.',
  );
  revalidateSkincare();
  return result;
}

export async function observePatchTestAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  // An observation is what the USER says they saw. The allow-list lives in the
  // engine, where it is tested directly: a missing or unrecognised value comes back
  // null here and is refused, rather than being read as "no reaction".
  const outcome = parseObservedOutcome(formData.get('outcome'));
  if (outcome == null) {
    return {
      error:
        'Choose what you actually saw at the patch site. GymOS will not record "no reaction" for you.',
    };
  }
  const result = await run(
    () =>
      observePatchTest(user.id, text(formData, 'testId'), {
        outcome,
        note: text(formData, 'note'),
      }),
    'Recorded what you observed.',
  );
  revalidateSkincare();
  return result;
}

export async function deletePatchTestAction(testId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deletePatchTest(user.id, testId), 'Patch test deleted.');
  revalidateSkincare();
  return result;
}
