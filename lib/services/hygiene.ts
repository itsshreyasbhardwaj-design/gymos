import 'server-only';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  hygieneRoutines,
  hygieneTasks,
  hygieneCheckins,
  personalCareSupplies,
  HYGIENE_CADENCES,
} from '@/lib/db/schema';
import { newId } from '@/lib/auth/ids';
import {
  addDays,
  dueTasks,
  dueTaskCount,
  isValidDate,
  routineSummary,
  supplyRunways,
  upcomingSchedule,
  type CheckinInput,
  type DueRoutineView,
  type HygieneCadence,
  type RoutineInput,
  type RoutineSummaryView,
  type SupplyRunwayView,
  type TaskInput,
} from '@/lib/engines/hygiene';
import { requireEntitlement } from './entitlements';
import { NotFoundError } from './equipment';
import { ValidationError } from './account';
import type { Plan } from '@/lib/engines/entitlements';

/**
 * Personal Hygiene OS — the only layer that touches SQL or authorisation.
 *
 * Two rules hold everywhere below:
 *   1. Ownership is in the SQL predicate. Routines and supplies carry `userId`
 *      directly; tasks do not, so every task read and write joins to the routine and
 *      filters on `hygiene_routines.user_id`. Nothing is fetched and then filtered
 *      in JavaScript.
 *   2. Nothing here stores or derives an appearance judgement. The tables hold
 *      routine names, task labels, dates, and the user's own "running low" flag —
 *      there is no cleanliness score, no grade and no column that could hold one.
 */

const MAX_NAME = 80;
const MAX_LABEL = 120;
const MAX_NOTES = 500;
const MAX_TASKS_PER_ROUTINE = 40;

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function requireDate(value: string, field: string): string {
  if (!isValidDate(value)) throw new ValidationError('Enter a real date (YYYY-MM-DD).', field);
  return value;
}

function cleanName(value: string, field: string): string {
  const name = value.trim().slice(0, MAX_NAME);
  if (name.length === 0) throw new ValidationError('Give this a name you will recognise.', field);
  return name;
}

function cleanLabel(value: string, field = 'label'): string {
  const label = value.trim().slice(0, MAX_LABEL);
  if (label.length === 0) throw new ValidationError('A task needs a label.', field);
  return label;
}

function cleanDays(days: number[] | undefined): number[] {
  if (!days) return [];
  for (const day of days) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new ValidationError('Days of the week must be 0 (Sunday) to 6 (Saturday).', 'daysOfWeek');
    }
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

function cleanCadence(
  cadence: string,
  daysOfWeek: number[],
  everyNDays: number | null | undefined,
): { cadence: HygieneCadence; daysOfWeek: number[]; everyNDays: number | null } {
  if (!(HYGIENE_CADENCES as readonly string[]).includes(cadence)) {
    throw new ValidationError('Choose daily, weekly or a custom interval.', 'cadence');
  }
  const kind = cadence as HygieneCadence;
  let interval: number | null = null;
  if (everyNDays != null && `${everyNDays}` !== '') {
    const n = Math.floor(Number(everyNDays));
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      throw new ValidationError('A custom interval must be between 1 and 365 days.', 'everyNDays');
    }
    interval = n;
  }
  if (kind === 'custom' && interval == null && daysOfWeek.length === 0) {
    throw new ValidationError(
      'A custom cadence needs either an interval in days or the days of the week it falls on.',
      'everyNDays',
    );
  }
  return { cadence: kind, daysOfWeek, everyNDays: kind === 'custom' ? interval : null };
}

/* ------------------------------------------------------------------ reads */

export interface RoutineWithTasks {
  id: string;
  name: string;
  category: string;
  cadence: HygieneCadence;
  daysOfWeek: number[];
  everyNDays: number | null;
  reminderTime: string | null;
  active: boolean;
  notes: string;
  createdAt: string;
  tasks: { id: string; label: string; notes: string; orderIndex: number }[];
}

/** Every routine the user owns, with its ordered tasks. Ownership is in the SQL. */
export function listRoutines(userId: string, opts: { activeOnly?: boolean } = {}): RoutineWithTasks[] {
  const routines = db
    .select()
    .from(hygieneRoutines)
    .where(
      opts.activeOnly
        ? and(eq(hygieneRoutines.userId, userId), eq(hygieneRoutines.active, true))
        : eq(hygieneRoutines.userId, userId),
    )
    .orderBy(asc(hygieneRoutines.createdAt))
    .all();

  if (routines.length === 0) return [];

  // Child rows are read through a join on the parent's owner, never by id alone.
  const taskRows = db
    .select({
      id: hygieneTasks.id,
      routineId: hygieneTasks.routineId,
      label: hygieneTasks.label,
      notes: hygieneTasks.notes,
      orderIndex: hygieneTasks.orderIndex,
    })
    .from(hygieneTasks)
    .innerJoin(hygieneRoutines, eq(hygieneRoutines.id, hygieneTasks.routineId))
    .where(
      and(
        eq(hygieneRoutines.userId, userId),
        inArray(
          hygieneTasks.routineId,
          routines.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(hygieneTasks.orderIndex))
    .all();

  const byRoutine = new Map<string, RoutineWithTasks['tasks']>();
  for (const row of taskRows) {
    const list = byRoutine.get(row.routineId) ?? [];
    list.push({ id: row.id, label: row.label, notes: row.notes, orderIndex: row.orderIndex });
    byRoutine.set(row.routineId, list);
  }

  return routines.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    cadence: r.cadence,
    daysOfWeek: r.daysOfWeek,
    everyNDays: r.everyNDays,
    reminderTime: r.reminderTime,
    active: r.active,
    notes: r.notes,
    createdAt: r.createdAt,
    tasks: byRoutine.get(r.id) ?? [],
  }));
}

export function getRoutine(userId: string, routineId: string): RoutineWithTasks {
  const routine = db
    .select()
    .from(hygieneRoutines)
    .where(and(eq(hygieneRoutines.id, routineId), eq(hygieneRoutines.userId, userId)))
    .get();
  if (!routine) throw new NotFoundError('That routine does not exist.');
  const tasks = db
    .select({
      id: hygieneTasks.id,
      label: hygieneTasks.label,
      notes: hygieneTasks.notes,
      orderIndex: hygieneTasks.orderIndex,
    })
    .from(hygieneTasks)
    .innerJoin(hygieneRoutines, eq(hygieneRoutines.id, hygieneTasks.routineId))
    .where(and(eq(hygieneTasks.routineId, routineId), eq(hygieneRoutines.userId, userId)))
    .orderBy(asc(hygieneTasks.orderIndex))
    .all();
  return {
    id: routine.id,
    name: routine.name,
    category: routine.category,
    cadence: routine.cadence,
    daysOfWeek: routine.daysOfWeek,
    everyNDays: routine.everyNDays,
    reminderTime: routine.reminderTime,
    active: routine.active,
    notes: routine.notes,
    createdAt: routine.createdAt,
    tasks,
  };
}

export function listCheckins(
  userId: string,
  opts: { from?: string; to?: string; routineId?: string } = {},
) {
  const clauses = [eq(hygieneCheckins.userId, userId)];
  if (opts.from) clauses.push(gte(hygieneCheckins.date, requireDate(opts.from, 'from')));
  if (opts.to) clauses.push(lte(hygieneCheckins.date, requireDate(opts.to, 'to')));
  if (opts.routineId) clauses.push(eq(hygieneCheckins.routineId, opts.routineId));
  return db
    .select({
      id: hygieneCheckins.id,
      routineId: hygieneCheckins.routineId,
      date: hygieneCheckins.date,
      completedTaskIds: hygieneCheckins.completedTaskIds,
      snoozedUntil: hygieneCheckins.snoozedUntil,
      note: hygieneCheckins.note,
      createdAt: hygieneCheckins.createdAt,
    })
    .from(hygieneCheckins)
    .where(and(...clauses))
    .orderBy(desc(hygieneCheckins.date))
    .all();
}

/* -------------------------------------------------------------- routines */

export interface RoutineDraft {
  name: string;
  category?: string;
  cadence: string;
  daysOfWeek?: number[];
  everyNDays?: number | null;
  reminderTime?: string | null;
  notes?: string;
  tasks?: { label: string; notes?: string }[];
}

/** Creating a routine is the entitlement-gated write; ticking one never is. */
export function createRoutine(userId: string, plan: Plan, input: RoutineDraft): string {
  requireEntitlement(plan, userId, 'care_routines');
  const name = cleanName(input.name, 'name');
  const days = cleanDays(input.daysOfWeek);
  const cadence = cleanCadence(input.cadence, days, input.everyNDays);
  const labels = (input.tasks ?? [])
    .map((t) => ({ label: t.label.trim(), notes: (t.notes ?? '').slice(0, MAX_NOTES) }))
    .filter((t) => t.label.length > 0)
    .slice(0, MAX_TASKS_PER_ROUTINE)
    .map((t) => ({ label: cleanLabel(t.label), notes: t.notes }));

  const id = newId();
  db.transaction((tx) => {
    tx.insert(hygieneRoutines)
      .values({
        id,
        userId,
        name,
        category: (input.category ?? 'general').trim().slice(0, 40) || 'general',
        cadence: cadence.cadence,
        daysOfWeek: cadence.daysOfWeek,
        everyNDays: cadence.everyNDays,
        reminderTime: input.reminderTime?.trim() || null,
        active: true,
        notes: (input.notes ?? '').slice(0, MAX_NOTES),
      })
      .run();
    labels.forEach((task, index) => {
      tx.insert(hygieneTasks)
        .values({ id: newId(), routineId: id, orderIndex: index, label: task.label, notes: task.notes })
        .run();
    });
  });
  return id;
}

export function updateRoutine(
  userId: string,
  routineId: string,
  patch: Partial<RoutineDraft> & { active?: boolean },
): void {
  const existing = getRoutine(userId, routineId); // ownership check in SQL
  const days = patch.daysOfWeek === undefined ? existing.daysOfWeek : cleanDays(patch.daysOfWeek);
  const cadence = cleanCadence(
    patch.cadence ?? existing.cadence,
    days,
    patch.everyNDays === undefined ? existing.everyNDays : patch.everyNDays,
  );
  db.update(hygieneRoutines)
    .set({
      name: patch.name === undefined ? existing.name : cleanName(patch.name, 'name'),
      category:
        patch.category === undefined
          ? existing.category
          : patch.category.trim().slice(0, 40) || 'general',
      cadence: cadence.cadence,
      daysOfWeek: cadence.daysOfWeek,
      everyNDays: cadence.everyNDays,
      reminderTime:
        patch.reminderTime === undefined ? existing.reminderTime : patch.reminderTime?.trim() || null,
      notes: patch.notes === undefined ? existing.notes : patch.notes.slice(0, MAX_NOTES),
      active: patch.active === undefined ? existing.active : patch.active,
    })
    .where(and(eq(hygieneRoutines.id, routineId), eq(hygieneRoutines.userId, userId)))
    .run();
}

export function setRoutineActive(userId: string, routineId: string, active: boolean): void {
  getRoutine(userId, routineId);
  db.update(hygieneRoutines)
    .set({ active })
    .where(and(eq(hygieneRoutines.id, routineId), eq(hygieneRoutines.userId, userId)))
    .run();
}

export function deleteRoutine(userId: string, routineId: string): void {
  getRoutine(userId, routineId);
  db.delete(hygieneRoutines)
    .where(and(eq(hygieneRoutines.id, routineId), eq(hygieneRoutines.userId, userId)))
    .run();
}

/* ------------------------------------------------------------------ tasks */

/** Resolves a task id to its routine, but only if the caller owns that routine. */
function ownedTask(userId: string, taskId: string): { id: string; routineId: string } {
  const row = db
    .select({ id: hygieneTasks.id, routineId: hygieneTasks.routineId })
    .from(hygieneTasks)
    .innerJoin(hygieneRoutines, eq(hygieneRoutines.id, hygieneTasks.routineId))
    .where(and(eq(hygieneTasks.id, taskId), eq(hygieneRoutines.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That task does not exist.');
  return row;
}

export function addTask(
  userId: string,
  routineId: string,
  input: { label: string; notes?: string },
): string {
  const routine = getRoutine(userId, routineId);
  if (routine.tasks.length >= MAX_TASKS_PER_ROUTINE) {
    throw new ValidationError(
      `A routine holds up to ${MAX_TASKS_PER_ROUTINE} tasks. Split it into two routines instead.`,
      'label',
    );
  }
  const id = newId();
  const nextIndex = routine.tasks.reduce((max, t) => Math.max(max, t.orderIndex + 1), 0);
  db.insert(hygieneTasks)
    .values({
      id,
      routineId,
      orderIndex: nextIndex,
      label: cleanLabel(input.label),
      notes: (input.notes ?? '').slice(0, MAX_NOTES),
    })
    .run();
  return id;
}

/**
 * "This task id, and its routine belongs to this user", as one predicate.
 *
 * `hygiene_tasks` has no `user_id`: a task is owned through its routine. Writes use
 * this so ownership is enforced by the statement that changes the row, not only by a
 * check that ran before it.
 */
function ownTaskPredicate(userId: string, taskId: string) {
  return and(
    eq(hygieneTasks.id, taskId),
    inArray(
      hygieneTasks.routineId,
      db
        .select({ id: hygieneRoutines.id })
        .from(hygieneRoutines)
        .where(eq(hygieneRoutines.userId, userId)),
    ),
  );
}

export function updateTask(
  userId: string,
  taskId: string,
  patch: { label?: string; notes?: string },
): void {
  ownedTask(userId, taskId);
  const set: { label?: string; notes?: string } = {};
  if (patch.label !== undefined) set.label = cleanLabel(patch.label);
  if (patch.notes !== undefined) set.notes = patch.notes.slice(0, MAX_NOTES);
  if (Object.keys(set).length === 0) return;
  // `ownedTask` already refused a task that is not this user's, but the write repeats
  // the check in its own predicate: a task row carries no user_id, so ownership has to
  // travel through its routine, and the project's rule is that it travels in the SQL.
  db.update(hygieneTasks).set(set).where(ownTaskPredicate(userId, taskId)).run();
}

export function deleteTask(userId: string, taskId: string): void {
  const task = ownedTask(userId, taskId);
  db.transaction((tx) => {
    tx.delete(hygieneTasks).where(ownTaskPredicate(userId, taskId)).run();
    // Drop the id from any check-in that recorded it, so history never points at a
    // task that no longer exists.
    const rows = tx
      .select({ id: hygieneCheckins.id, completedTaskIds: hygieneCheckins.completedTaskIds })
      .from(hygieneCheckins)
      .where(and(eq(hygieneCheckins.userId, userId), eq(hygieneCheckins.routineId, task.routineId)))
      .all();
    for (const row of rows) {
      if (!row.completedTaskIds.includes(taskId)) continue;
      tx.update(hygieneCheckins)
        .set({ completedTaskIds: row.completedTaskIds.filter((id) => id !== taskId) })
        .where(and(eq(hygieneCheckins.id, row.id), eq(hygieneCheckins.userId, userId)))
        .run();
    }
  });
}

export function reorderTasks(userId: string, routineId: string, orderedTaskIds: string[]): void {
  const routine = getRoutine(userId, routineId);
  const owned = new Set(routine.tasks.map((t) => t.id));
  const wanted = orderedTaskIds.filter((id) => owned.has(id));
  const rest = routine.tasks.filter((t) => !wanted.includes(t.id)).map((t) => t.id);
  const final = [...wanted, ...rest];
  db.transaction((tx) => {
    final.forEach((id, index) => {
      tx.update(hygieneTasks)
        .set({ orderIndex: index })
        .where(and(eq(hygieneTasks.id, id), eq(hygieneTasks.routineId, routineId)))
        .run();
    });
  });
}

/* --------------------------------------------------------------- check-ins */

export interface CheckinRow {
  id: string;
  routineId: string;
  date: string;
  completedTaskIds: string[];
  snoozedUntil: string | null;
  note: string;
}

/** The one check-in row for a routine on a date, if the caller owns it. */
function existingCheckin(userId: string, routineId: string, date: string) {
  return db
    .select({
      id: hygieneCheckins.id,
      completedTaskIds: hygieneCheckins.completedTaskIds,
      snoozedUntil: hygieneCheckins.snoozedUntil,
      note: hygieneCheckins.note,
    })
    .from(hygieneCheckins)
    .where(
      and(
        eq(hygieneCheckins.userId, userId),
        eq(hygieneCheckins.routineId, routineId),
        eq(hygieneCheckins.date, date),
      ),
    )
    .get();
}

/**
 * Ticks one task for one day. Idempotent: the table has a unique index on
 * (routine, date), and a task id is added to that row's set at most once, so
 * calling this twice leaves exactly one row with exactly one entry.
 *
 * A non-owner cannot reach this: the task id is resolved through its routine's
 * `user_id`, and a mismatch raises NotFoundError before anything is written.
 */
export function checkInTask(
  userId: string,
  taskId: string,
  opts: { date?: string; note?: string } = {},
): CheckinRow {
  const task = ownedTask(userId, taskId);
  const date = requireDate(opts.date ?? todayIso(), 'date');
  const routineId = task.routineId;

  return db.transaction((tx) => {
    const current = tx
      .select({
        id: hygieneCheckins.id,
        completedTaskIds: hygieneCheckins.completedTaskIds,
        snoozedUntil: hygieneCheckins.snoozedUntil,
        note: hygieneCheckins.note,
      })
      .from(hygieneCheckins)
      .where(
        and(
          eq(hygieneCheckins.userId, userId),
          eq(hygieneCheckins.routineId, routineId),
          eq(hygieneCheckins.date, date),
        ),
      )
      .get();

    if (!current) {
      const id = newId();
      const note = (opts.note ?? '').slice(0, MAX_NOTES);
      tx.insert(hygieneCheckins)
        .values({ id, userId, routineId, date, completedTaskIds: [taskId], note })
        .run();
      return { id, routineId, date, completedTaskIds: [taskId], snoozedUntil: null, note };
    }

    const completed = current.completedTaskIds.includes(taskId)
      ? current.completedTaskIds
      : [...current.completedTaskIds, taskId];
    const note = opts.note === undefined ? current.note : opts.note.slice(0, MAX_NOTES);
    tx.update(hygieneCheckins)
      .set({ completedTaskIds: completed, note })
      .where(and(eq(hygieneCheckins.id, current.id), eq(hygieneCheckins.userId, userId)))
      .run();
    return {
      id: current.id,
      routineId,
      date,
      completedTaskIds: completed,
      snoozedUntil: current.snoozedUntil,
      note,
    };
  });
}

/** Un-ticks a task. Correcting a mistake must always be possible. */
export function uncheckTask(userId: string, taskId: string, date?: string): void {
  const task = ownedTask(userId, taskId);
  const on = requireDate(date ?? todayIso(), 'date');
  const current = existingCheckin(userId, task.routineId, on);
  if (!current) return;
  db.update(hygieneCheckins)
    .set({ completedTaskIds: current.completedTaskIds.filter((id) => id !== taskId) })
    .where(and(eq(hygieneCheckins.id, current.id), eq(hygieneCheckins.userId, userId)))
    .run();
}

/** Ticks every task of a routine for a date, in one idempotent write. */
export function checkInRoutine(
  userId: string,
  routineId: string,
  opts: { date?: string; note?: string } = {},
): CheckinRow {
  const routine = getRoutine(userId, routineId);
  const date = requireDate(opts.date ?? todayIso(), 'date');
  const all = routine.tasks.map((t) => t.id);
  const current = existingCheckin(userId, routineId, date);
  const note = (opts.note ?? current?.note ?? '').slice(0, MAX_NOTES);
  const completed = [...new Set([...(current?.completedTaskIds ?? []), ...all])];
  if (current) {
    db.update(hygieneCheckins)
      .set({ completedTaskIds: completed, note })
      .where(and(eq(hygieneCheckins.id, current.id), eq(hygieneCheckins.userId, userId)))
      .run();
    return {
      id: current.id,
      routineId,
      date,
      completedTaskIds: completed,
      snoozedUntil: current.snoozedUntil,
      note,
    };
  }
  const id = newId();
  db.insert(hygieneCheckins)
    .values({ id, userId, routineId, date, completedTaskIds: completed, note })
    .run();
  return { id, routineId, date, completedTaskIds: completed, snoozedUntil: null, note };
}

/**
 * Sets a routine aside until a date. Not a penalty and not a excuse to log: the
 * routine simply leaves today's list and comes back on the date chosen.
 */
export function snoozeRoutine(
  userId: string,
  routineId: string,
  until: string,
  date?: string,
): void {
  getRoutine(userId, routineId);
  const on = requireDate(date ?? todayIso(), 'date');
  const untilDate = requireDate(until, 'until');
  const current = existingCheckin(userId, routineId, on);
  if (current) {
    db.update(hygieneCheckins)
      .set({ snoozedUntil: untilDate })
      .where(and(eq(hygieneCheckins.id, current.id), eq(hygieneCheckins.userId, userId)))
      .run();
    return;
  }
  db.insert(hygieneCheckins)
    .values({
      id: newId(),
      userId,
      routineId,
      date: on,
      completedTaskIds: [],
      snoozedUntil: untilDate,
    })
    .run();
}

/* -------------------------------------------------------------- supplies */

export interface SupplyDraft {
  name: string;
  category?: string;
  runningLow?: boolean;
  lastReplacedAt?: string | null;
  replaceEveryDays?: number | null;
  notes?: string;
}

export function listSupplies(userId: string) {
  return db
    .select()
    .from(personalCareSupplies)
    .where(eq(personalCareSupplies.userId, userId))
    .orderBy(desc(personalCareSupplies.runningLow), asc(personalCareSupplies.name))
    .all();
}

function getSupply(userId: string, supplyId: string) {
  const row = db
    .select()
    .from(personalCareSupplies)
    .where(and(eq(personalCareSupplies.id, supplyId), eq(personalCareSupplies.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That supply does not exist.');
  return row;
}

function cleanInterval(value: number | null | undefined, field = 'replaceEveryDays'): number | null {
  if (value == null || `${value}` === '') return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    throw new ValidationError('A replacement interval must be between 1 and 3650 days.', field);
  }
  return n;
}

export function createSupply(userId: string, input: SupplyDraft): string {
  const id = newId();
  db.insert(personalCareSupplies)
    .values({
      id,
      userId,
      name: cleanName(input.name, 'name'),
      category: (input.category ?? 'general').trim().slice(0, 40) || 'general',
      runningLow: input.runningLow ?? false,
      lastReplacedAt: input.lastReplacedAt
        ? requireDate(input.lastReplacedAt, 'lastReplacedAt')
        : null,
      replaceEveryDays: cleanInterval(input.replaceEveryDays),
      notes: (input.notes ?? '').slice(0, MAX_NOTES),
    })
    .run();
  return id;
}

export function updateSupply(userId: string, supplyId: string, patch: Partial<SupplyDraft>): void {
  const existing = getSupply(userId, supplyId);
  db.update(personalCareSupplies)
    .set({
      name: patch.name === undefined ? existing.name : cleanName(patch.name, 'name'),
      category:
        patch.category === undefined
          ? existing.category
          : patch.category.trim().slice(0, 40) || 'general',
      runningLow: patch.runningLow === undefined ? existing.runningLow : patch.runningLow,
      lastReplacedAt:
        patch.lastReplacedAt === undefined
          ? existing.lastReplacedAt
          : patch.lastReplacedAt
            ? requireDate(patch.lastReplacedAt, 'lastReplacedAt')
            : null,
      replaceEveryDays:
        patch.replaceEveryDays === undefined
          ? existing.replaceEveryDays
          : cleanInterval(patch.replaceEveryDays),
      notes: patch.notes === undefined ? existing.notes : patch.notes.slice(0, MAX_NOTES),
    })
    .where(and(eq(personalCareSupplies.id, supplyId), eq(personalCareSupplies.userId, userId)))
    .run();
}

/** The user's own flag. GymOS never infers this from anything. */
export function setSupplyRunningLow(userId: string, supplyId: string, runningLow: boolean): void {
  getSupply(userId, supplyId);
  db.update(personalCareSupplies)
    .set({ runningLow })
    .where(and(eq(personalCareSupplies.id, supplyId), eq(personalCareSupplies.userId, userId)))
    .run();
}

export function markSupplyReplaced(userId: string, supplyId: string, date?: string): void {
  getSupply(userId, supplyId);
  db.update(personalCareSupplies)
    .set({ lastReplacedAt: requireDate(date ?? todayIso(), 'date'), runningLow: false })
    .where(and(eq(personalCareSupplies.id, supplyId), eq(personalCareSupplies.userId, userId)))
    .run();
}

export function deleteSupply(userId: string, supplyId: string): void {
  getSupply(userId, supplyId);
  db.delete(personalCareSupplies)
    .where(and(eq(personalCareSupplies.id, supplyId), eq(personalCareSupplies.userId, userId)))
    .run();
}

/* ------------------------------------------------------------- dashboard */

export interface HygieneDashboard {
  today: string;
  due: DueRoutineView[];
  dueNow: DueRoutineView[];
  /**
   * What the tick list renders: everything still to tick today, plus anything
   * already ticked today so the checkboxes stay on screen and a tick can be undone.
   */
  todayList: DueRoutineView[];
  outstandingTaskCount: number;
  upcoming: { date: string; routineId: string; routineName: string; taskCount: number }[];
  restock: SupplyRunwayView[];
  supplies: SupplyRunwayView[];
  summary: RoutineSummaryView;
  routineNames: Record<string, string>;
  routineCount: number;
  activeRoutineCount: number;
}

/**
 * Everything the dashboard renders, assembled from the user's own rows and the pure
 * engine. The service does the SQL and authorisation; the engine does the arithmetic.
 */
export function hygieneDashboard(
  userId: string,
  opts: { today?: string; windowDays?: number } = {},
): HygieneDashboard {
  const today = requireDate(opts.today ?? todayIso(), 'today');
  const windowDays = Math.max(1, Math.min(365, Math.floor(opts.windowDays ?? 14)));
  const routines = listRoutines(userId);

  const routineInputs: RoutineInput[] = routines.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    cadence: r.cadence,
    daysOfWeek: r.daysOfWeek,
    everyNDays: r.everyNDays,
    active: r.active,
  }));
  const taskInputs: TaskInput[] = routines.flatMap((r) =>
    r.tasks.map((t) => ({ id: t.id, routineId: r.id, orderIndex: t.orderIndex, label: t.label })),
  );

  // Reach back further than the summary window so an interval cadence can still
  // find its last completion.
  const history = listCheckins(userId, {
    from: addDays(today, -Math.max(windowDays, 400)),
    to: today,
  });
  const checkinInputs: CheckinInput[] = history.map((c) => ({
    routineId: c.routineId,
    date: c.date,
    completedTaskIds: c.completedTaskIds,
    snoozedUntil: c.snoozedUntil,
  }));

  const due = dueTasks(routineInputs, taskInputs, checkinInputs, today);
  const supplies = supplyRunways(
    listSupplies(userId).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      runningLow: s.runningLow,
      lastReplacedAt: s.lastReplacedAt,
      replaceEveryDays: s.replaceEveryDays,
    })),
    today,
  );

  return {
    today,
    due,
    dueNow: due.filter((d) => d.due),
    todayList: due.filter((d) => d.onTodayList),
    outstandingTaskCount: dueTaskCount(due.filter((d) => d.due)),
    upcoming: upcomingSchedule(due, today, 7),
    restock: supplies.filter((s) => s.restock),
    supplies,
    summary: routineSummary(checkinInputs, windowDays, today),
    routineNames: Object.fromEntries(routines.map((r) => [r.id, r.name])),
    routineCount: routines.length,
    activeRoutineCount: routines.filter((r) => r.active).length,
  };
}

/** Count of active routines, for the entitlement note on the page. */
export function activeRoutineCount(userId: string): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(hygieneRoutines)
    .where(and(eq(hygieneRoutines.userId, userId), eq(hygieneRoutines.active, true)))
    .get();
  return row?.c ?? 0;
}

export { NotFoundError, ValidationError };
