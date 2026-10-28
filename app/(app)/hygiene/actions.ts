'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import {
  addTask,
  checkInRoutine,
  checkInTask,
  createRoutine,
  createSupply,
  deleteRoutine,
  deleteSupply,
  deleteTask,
  markSupplyReplaced,
  setRoutineActive,
  setSupplyRunningLow,
  snoozeRoutine,
  todayIso,
  uncheckTask,
  updateRoutine,
  updateSupply,
} from '@/lib/services/hygiene';

/** Same shape as app/(app)/actions.ts, duplicated deliberately: that file is shared. */
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

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

function optionalText(data: FormData, key: string): string | undefined {
  const value = data.get(key);
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value;
}

function days(data: FormData): number[] {
  return data
    .getAll('daysOfWeek')
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

/* ------------------------------------------------------------------ patching */

/*
 * An edit form sends only the fields it shows, so "absent" and "present but blank"
 * are different instructions: absent means leave the stored value alone, blank means
 * the user cleared the field on purpose. The services distinguish the two by
 * `undefined` vs `null`, so the readers below never turn a missing field into a null
 * — doing that is what silently wiped a supply's dates.
 */

function patchText(data: FormData, key: string): string | undefined {
  if (!data.has(key)) return undefined;
  const value = data.get(key);
  return typeof value === 'string' ? value : undefined;
}

function patchNumber(data: FormData, key: string): number | null | undefined {
  const raw = patchText(data, key);
  if (raw === undefined) return undefined;
  return raw.trim() === '' ? null : Number(raw);
}

function patchDate(data: FormData, key: string): string | null | undefined {
  const raw = patchText(data, key);
  if (raw === undefined) return undefined;
  return raw.trim() === '' ? null : raw.trim();
}

/**
 * A checkbox group sends nothing at all when every box is cleared, which is
 * indistinguishable from a form that has no day picker. The edit form therefore
 * declares the picker with a hidden `daysOfWeekSent` marker; without it the stored
 * days are left alone rather than being emptied.
 */
function patchDays(data: FormData): number[] | undefined {
  if (!data.has('daysOfWeekSent')) return undefined;
  return days(data);
}

function refresh(): void {
  revalidatePath('/hygiene');
  revalidatePath('/dashboard');
}

/* ------------------------------------------------------------------ routines */

export async function createRoutineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const taskLabels = formData
    .getAll('taskLabel')
    .map((v) => String(v).trim())
    .filter((label) => label.length > 0);
  const result = await run(
    () =>
      void createRoutine(user.id, user.plan, {
        name: text(formData, 'name'),
        category: optionalText(formData, 'category'),
        cadence: text(formData, 'cadence') || 'daily',
        daysOfWeek: days(formData),
        everyNDays: optionalText(formData, 'everyNDays')
          ? Number(text(formData, 'everyNDays'))
          : null,
        reminderTime: optionalText(formData, 'reminderTime') ?? null,
        notes: text(formData, 'notes'),
        tasks: taskLabels.map((label) => ({ label })),
      }),
    'Routine saved.',
  );
  refresh();
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
        name: patchText(formData, 'name'),
        category: patchText(formData, 'category'),
        cadence: patchText(formData, 'cadence'),
        daysOfWeek: patchDays(formData),
        everyNDays: patchNumber(formData, 'everyNDays'),
        notes: patchText(formData, 'notes'),
      }),
    'Routine updated.',
  );
  refresh();
  return result;
}

export async function setRoutineActiveAction(
  routineId: string,
  active: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => setRoutineActive(user.id, routineId, active),
    active ? 'Routine switched back on.' : 'Routine paused. Its history is kept.',
  );
  refresh();
  return result;
}

export async function deleteRoutineAction(routineId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => deleteRoutine(user.id, routineId),
    'Routine and its check-ins deleted.',
  );
  refresh();
  return result;
}

/* --------------------------------------------------------------------- tasks */

export async function addTaskAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      void addTask(user.id, text(formData, 'routineId'), {
        label: text(formData, 'label'),
        notes: text(formData, 'notes'),
      }),
    'Task added.',
  );
  refresh();
  return result;
}

export async function deleteTaskAction(taskId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteTask(user.id, taskId), 'Task removed.');
  refresh();
  return result;
}

/* ----------------------------------------------------------------- check-ins */

export async function checkInTaskAction(taskId: string, date?: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => void checkInTask(user.id, taskId, { date: date ?? todayIso() }),
    'Ticked.',
  );
  refresh();
  return result;
}

export async function uncheckTaskAction(taskId: string, date?: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => uncheckTask(user.id, taskId, date ?? todayIso()), 'Un-ticked.');
  refresh();
  return result;
}

export async function checkInRoutineAction(routineId: string, date?: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => void checkInRoutine(user.id, routineId, { date: date ?? todayIso() }),
    'Whole routine ticked.',
  );
  refresh();
  return result;
}

export async function snoozeRoutineAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => snoozeRoutine(user.id, text(formData, 'routineId'), text(formData, 'until')),
    'Set aside until the date you chose.',
  );
  refresh();
  return result;
}

/* ------------------------------------------------------------------ supplies */

export async function createSupplyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      void createSupply(user.id, {
        name: text(formData, 'name'),
        category: optionalText(formData, 'category'),
        lastReplacedAt: optionalText(formData, 'lastReplacedAt') ?? null,
        replaceEveryDays: optionalText(formData, 'replaceEveryDays')
          ? Number(text(formData, 'replaceEveryDays'))
          : null,
        notes: text(formData, 'notes'),
      }),
    'Supply added.',
  );
  refresh();
  return result;
}

export async function updateSupplyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      updateSupply(user.id, text(formData, 'supplyId'), {
        name: patchText(formData, 'name'),
        category: patchText(formData, 'category'),
        lastReplacedAt: patchDate(formData, 'lastReplacedAt'),
        replaceEveryDays: patchNumber(formData, 'replaceEveryDays'),
        notes: patchText(formData, 'notes'),
      }),
    'Supply updated.',
  );
  refresh();
  return result;
}

export async function setSupplyRunningLowAction(
  supplyId: string,
  runningLow: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => setSupplyRunningLow(user.id, supplyId, runningLow),
    runningLow ? 'Marked as running low.' : 'Running-low flag cleared.',
  );
  refresh();
  return result;
}

export async function markSupplyReplacedAction(
  supplyId: string,
  date?: string,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => markSupplyReplaced(user.id, supplyId, date ?? todayIso()),
    'Replacement date recorded.',
  );
  refresh();
  return result;
}

export async function deleteSupplyAction(supplyId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteSupply(user.id, supplyId), 'Supply removed.');
  refresh();
  return result;
}
