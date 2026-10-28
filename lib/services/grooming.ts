import 'server-only';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  groomingRoutines,
  groomingRoutineSteps,
  groomingRoutineLogs,
  groomingAppointments,
  skincareProducts,
  ROUTINE_SLOTS,
} from '@/lib/db/schema';
import { newId } from '@/lib/auth/ids';
import { requireEntitlement } from './entitlements';
import { NotFoundError } from './equipment';
import { ValidationError } from './account';
import {
  routineDueToday,
  routineAdherence,
  type AdherenceSummary,
  type DueVerdict,
  type RoutineSlot,
} from '@/lib/engines/care';
import type { Plan } from '@/lib/engines/entitlements';

/**
 * Grooming routines, their ordered steps, their logs, and appointments.
 *
 * Every read and write puts the owning user id in the SQL predicate. Child rows
 * (steps, logs) are reached through a join on their parent's `user_id`, so there is
 * no path that loads a row first and checks ownership afterwards.
 */

const MAX_NAME = 80;
const MAX_NOTES = 500;
const MAX_STEP_LABEL = 120;
const MAX_STEPS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, field: string): string {
  const date = value.slice(0, 10);
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD form.`, field);
  }
  return date;
}

function cleanDaysOfWeek(days: number[] | undefined): number[] {
  if (!days) return [];
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
}

function assertSlot(slot: string): RoutineSlot {
  if (!(ROUTINE_SLOTS as readonly string[]).includes(slot)) {
    throw new ValidationError(`"${slot}" is not a routine slot.`, 'slot');
  }
  return slot as RoutineSlot;
}

function nowIso(): string {
  return new Date().toISOString();
}

/* -------------------------------------------------------------------- types */

export interface RoutineStepView {
  id: string;
  orderIndex: number;
  label: string;
  productId: string | null;
  productName: string | null;
  notes: string;
}

export interface RoutineView {
  id: string;
  name: string;
  slot: RoutineSlot;
  daysOfWeek: number[];
  active: boolean;
  notes: string;
  createdAt: string;
  steps: RoutineStepView[];
}

export interface RoutineStepInput {
  label: string;
  /** A skincare product of the SAME user, or null. Ownership is verified. */
  productId?: string | null;
  notes?: string;
}

export interface RoutineInput {
  name: string;
  slot: string;
  daysOfWeek?: number[];
  notes?: string;
  active?: boolean;
  steps?: RoutineStepInput[];
}

/* ----------------------------------------------------------------- routines */

/** Ownership is checked in SQL on every read, not in application code afterwards. */
export function getRoutine(userId: string, routineId: string): RoutineView {
  const routine = db
    .select()
    .from(groomingRoutines)
    .where(and(eq(groomingRoutines.id, routineId), eq(groomingRoutines.userId, userId)))
    .get();
  if (!routine) throw new NotFoundError('That routine does not exist.');
  return { ...routine, slot: routine.slot, steps: stepsForOwnedRoutine(userId, routineId) };
}

/**
 * Steps for a routine, joined through the parent's `user_id` so a step id belonging
 * to someone else's routine simply does not come back.
 */
function stepsForOwnedRoutine(userId: string, routineId: string): RoutineStepView[] {
  return db
    .select({
      id: groomingRoutineSteps.id,
      orderIndex: groomingRoutineSteps.orderIndex,
      label: groomingRoutineSteps.label,
      productId: groomingRoutineSteps.productId,
      productName: skincareProducts.name,
      notes: groomingRoutineSteps.notes,
    })
    .from(groomingRoutineSteps)
    .innerJoin(groomingRoutines, eq(groomingRoutines.id, groomingRoutineSteps.routineId))
    .leftJoin(
      skincareProducts,
      and(
        eq(skincareProducts.id, groomingRoutineSteps.productId),
        eq(skincareProducts.userId, userId),
      ),
    )
    .where(
      and(eq(groomingRoutineSteps.routineId, routineId), eq(groomingRoutines.userId, userId)),
    )
    // Same order as the reorder and delete paths, `id` included: legacy rows can hold
    // tied order indices, and a read that broke the tie differently would show the
    // user one order while a move operated on another, so a press would appear to
    // move a step nobody pointed at.
    .orderBy(asc(groomingRoutineSteps.orderIndex), asc(groomingRoutineSteps.id))
    .all();
}

export function listRoutines(userId: string, opts: { includeInactive?: boolean } = {}): RoutineView[] {
  const clauses = [eq(groomingRoutines.userId, userId)];
  if (!opts.includeInactive) clauses.push(eq(groomingRoutines.active, true));
  const routines = db
    .select()
    .from(groomingRoutines)
    .where(and(...clauses))
    .orderBy(asc(groomingRoutines.createdAt))
    .all();
  if (routines.length === 0) return [];

  const steps = db
    .select({
      id: groomingRoutineSteps.id,
      routineId: groomingRoutineSteps.routineId,
      orderIndex: groomingRoutineSteps.orderIndex,
      label: groomingRoutineSteps.label,
      productId: groomingRoutineSteps.productId,
      productName: skincareProducts.name,
      notes: groomingRoutineSteps.notes,
    })
    .from(groomingRoutineSteps)
    .innerJoin(groomingRoutines, eq(groomingRoutines.id, groomingRoutineSteps.routineId))
    .leftJoin(
      skincareProducts,
      and(
        eq(skincareProducts.id, groomingRoutineSteps.productId),
        eq(skincareProducts.userId, userId),
      ),
    )
    .where(
      and(
        eq(groomingRoutines.userId, userId),
        inArray(
          groomingRoutineSteps.routineId,
          routines.map((r) => r.id),
        ),
      ),
    )
    // The tie is broken by `id` here as well: this is the read behind the up/down
    // buttons, so it has to agree with `moveRoutineStep` step for step.
    .orderBy(asc(groomingRoutineSteps.orderIndex), asc(groomingRoutineSteps.id))
    .all();

  const byRoutine = new Map<string, RoutineStepView[]>();
  for (const step of steps) {
    const list = byRoutine.get(step.routineId) ?? [];
    list.push({
      id: step.id,
      orderIndex: step.orderIndex,
      label: step.label,
      productId: step.productId,
      productName: step.productName,
      notes: step.notes,
    });
    byRoutine.set(step.routineId, list);
  }

  return routines.map((r) => ({ ...r, steps: byRoutine.get(r.id) ?? [] }));
}

/** Returns the product ids from `wanted` that this user actually owns. */
function ownedProductIds(userId: string, wanted: string[]): Set<string> {
  const ids = [...new Set(wanted)];
  if (ids.length === 0) return new Set();
  const rows = db
    .select({ id: skincareProducts.id })
    .from(skincareProducts)
    .where(and(eq(skincareProducts.userId, userId), inArray(skincareProducts.id, ids)))
    .all();
  return new Set(rows.map((r) => r.id));
}

/**
 * A step may name one of the user's own products. A product id belonging to anyone
 * else is rejected outright rather than quietly stored as null, so a mistyped id
 * cannot be used to probe which ids exist.
 */
function resolveStepProduct(userId: string, productId: string | null | undefined): string | null {
  if (!productId) return null;
  if (!ownedProductIds(userId, [productId]).has(productId)) {
    throw new NotFoundError('That product does not exist.');
  }
  return productId;
}

export function createRoutine(userId: string, plan: Plan, input: RoutineInput): string {
  requireEntitlement(plan, userId, 'care_routines');
  const name = input.name.trim();
  if (!name) throw new ValidationError('Give the routine a name.', 'name');
  const slot = assertSlot(input.slot);
  // Blank rows from the form are dropped here, not inside the insert loop: using the
  // form index for `orderIndex` while skipping blanks left gaps, and the next index
  // `addRoutineStep` picked could then collide with an existing step.
  const steps = (input.steps ?? [])
    .map((step) => ({ ...step, label: step.label.trim() }))
    .filter((step) => step.label.length > 0)
    .slice(0, MAX_STEPS);
  const productIds = steps.map((s) => s.productId).filter((id): id is string => Boolean(id));
  const owned = ownedProductIds(userId, productIds);
  for (const id of productIds) {
    if (!owned.has(id)) throw new NotFoundError('That product does not exist.');
  }

  const id = newId();
  db.transaction((tx) => {
    tx.insert(groomingRoutines)
      .values({
        id,
        userId,
        name: name.slice(0, MAX_NAME),
        slot,
        daysOfWeek: cleanDaysOfWeek(input.daysOfWeek),
        active: input.active ?? true,
        notes: (input.notes ?? '').slice(0, MAX_NOTES),
      })
      .run();
    steps.forEach((step, index) => {
      tx.insert(groomingRoutineSteps)
        .values({
          id: newId(),
          routineId: id,
          orderIndex: index,
          label: step.label.slice(0, MAX_STEP_LABEL),
          productId: step.productId ?? null,
          notes: (step.notes ?? '').slice(0, MAX_NOTES),
        })
        .run();
    });
  });
  return id;
}

export function updateRoutine(
  userId: string,
  routineId: string,
  input: Partial<Omit<RoutineInput, 'steps'>>,
): void {
  const existing = db
    .select({ id: groomingRoutines.id })
    .from(groomingRoutines)
    .where(and(eq(groomingRoutines.id, routineId), eq(groomingRoutines.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That routine does not exist.');

  const patch: Partial<typeof groomingRoutines.$inferInsert> = {};
  if (input.name != null) {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Give the routine a name.', 'name');
    patch.name = name.slice(0, MAX_NAME);
  }
  if (input.slot != null) patch.slot = assertSlot(input.slot);
  if (input.daysOfWeek != null) patch.daysOfWeek = cleanDaysOfWeek(input.daysOfWeek);
  if (input.notes != null) patch.notes = input.notes.slice(0, MAX_NOTES);
  if (input.active != null) patch.active = input.active;
  if (Object.keys(patch).length === 0) return;

  db.update(groomingRoutines)
    .set(patch)
    .where(and(eq(groomingRoutines.id, routineId), eq(groomingRoutines.userId, userId)))
    .run();
}

/**
 * Moves one step one place up or down inside its own routine.
 *
 * Step ids are preserved rather than re-created, because a routine log stores the
 * ids of the steps that were ticked off: replacing the rows would quietly orphan
 * those references. The surviving order is rewritten to 0, 1, 2 … in one
 * transaction, so a routine whose rows already had a gap or a duplicate index comes
 * out contiguous.
 */
export function moveRoutineStep(userId: string, stepId: string, direction: 'up' | 'down'): void {
  if (direction !== 'up' && direction !== 'down') {
    throw new ValidationError('A step moves up or down.', 'direction');
  }
  // Joined to the parent so a step on someone else's routine is simply not found.
  const step = db
    .select({ id: groomingRoutineSteps.id, routineId: groomingRoutineSteps.routineId })
    .from(groomingRoutineSteps)
    .innerJoin(groomingRoutines, eq(groomingRoutines.id, groomingRoutineSteps.routineId))
    .where(and(eq(groomingRoutineSteps.id, stepId), eq(groomingRoutines.userId, userId)))
    .get();
  if (!step) throw new NotFoundError('That step does not exist.');

  db.transaction((tx) => {
    const rows = tx
      .select({ id: groomingRoutineSteps.id })
      .from(groomingRoutineSteps)
      .where(eq(groomingRoutineSteps.routineId, step.routineId))
      .orderBy(asc(groomingRoutineSteps.orderIndex), asc(groomingRoutineSteps.id))
      .all();
    const from = rows.findIndex((row) => row.id === stepId);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from >= 0 && to >= 0 && to < rows.length) {
      const moved = rows[from]!;
      rows[from] = rows[to]!;
      rows[to] = moved;
    }
    // Written even when the step was already at that end, so one press of a button
    // that cannot move anything still compacts a list that arrived out of shape.
    rows.forEach((row, index) => {
      tx.update(groomingRoutineSteps)
        .set({ orderIndex: index })
        .where(eq(groomingRoutineSteps.id, row.id))
        .run();
    });
  });
}

export function addRoutineStep(userId: string, routineId: string, step: RoutineStepInput): string {
  const routine = db
    .select({ id: groomingRoutines.id })
    .from(groomingRoutines)
    .where(and(eq(groomingRoutines.id, routineId), eq(groomingRoutines.userId, userId)))
    .get();
  if (!routine) throw new NotFoundError('That routine does not exist.');
  const label = step.label.trim();
  if (!label) throw new ValidationError('Give the step a label.', 'label');

  // The count caps the list; the next order index comes from max(order_index) + 1,
  // because count(*) collides with an existing step whenever the stored indices have
  // a gap in them.
  const stats = db
    .select({
      count: sql<number>`count(*)`,
      maxIndex: sql<number | null>`max(${groomingRoutineSteps.orderIndex})`,
    })
    .from(groomingRoutineSteps)
    .where(eq(groomingRoutineSteps.routineId, routineId))
    .all();
  const current = stats[0]?.count ?? 0;
  const maxIndex = stats[0]?.maxIndex ?? null;
  if (current >= MAX_STEPS) {
    throw new ValidationError(`A routine holds at most ${MAX_STEPS} steps.`, 'steps');
  }

  const id = newId();
  db.insert(groomingRoutineSteps)
    .values({
      id,
      routineId,
      orderIndex: maxIndex == null ? 0 : maxIndex + 1,
      label: label.slice(0, MAX_STEP_LABEL),
      productId: resolveStepProduct(userId, step.productId),
      notes: (step.notes ?? '').slice(0, MAX_NOTES),
    })
    .run();
  return id;
}

export function deleteRoutineStep(userId: string, stepId: string): void {
  // Joined to the parent so a step on someone else's routine is simply not found.
  const step = db
    .select({ id: groomingRoutineSteps.id, routineId: groomingRoutineSteps.routineId })
    .from(groomingRoutineSteps)
    .innerJoin(groomingRoutines, eq(groomingRoutines.id, groomingRoutineSteps.routineId))
    .where(and(eq(groomingRoutineSteps.id, stepId), eq(groomingRoutines.userId, userId)))
    .get();
  if (!step) throw new NotFoundError('That step does not exist.');

  db.transaction((tx) => {
    tx.delete(groomingRoutineSteps).where(eq(groomingRoutineSteps.id, stepId)).run();
    const remaining = tx
      .select({ id: groomingRoutineSteps.id })
      .from(groomingRoutineSteps)
      .where(eq(groomingRoutineSteps.routineId, step.routineId))
      .orderBy(asc(groomingRoutineSteps.orderIndex), asc(groomingRoutineSteps.id))
      .all();
    remaining.forEach((row, index) => {
      tx.update(groomingRoutineSteps)
        .set({ orderIndex: index })
        .where(eq(groomingRoutineSteps.id, row.id))
        .run();
    });
  });
}

export function deleteRoutine(userId: string, routineId: string): void {
  const existing = db
    .select({ id: groomingRoutines.id })
    .from(groomingRoutines)
    .where(and(eq(groomingRoutines.id, routineId), eq(groomingRoutines.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That routine does not exist.');
  db.delete(groomingRoutines)
    .where(and(eq(groomingRoutines.id, routineId), eq(groomingRoutines.userId, userId)))
    .run();
}

/* --------------------------------------------------------------------- logs */

export interface RoutineLogView {
  id: string;
  routineId: string;
  date: string;
  completedStepIds: string[];
  note: string;
  createdAt: string;
}

export function listRoutineLogs(
  userId: string,
  opts: { routineId?: string; from?: string; to?: string; limit?: number } = {},
): RoutineLogView[] {
  const clauses = [eq(groomingRoutineLogs.userId, userId)];
  if (opts.routineId) clauses.push(eq(groomingRoutineLogs.routineId, opts.routineId));
  if (opts.from) clauses.push(gte(groomingRoutineLogs.date, assertIsoDate(opts.from, 'from')));
  if (opts.to) clauses.push(lte(groomingRoutineLogs.date, assertIsoDate(opts.to, 'to')));
  return db
    .select()
    .from(groomingRoutineLogs)
    .where(and(...clauses))
    .orderBy(desc(groomingRoutineLogs.date))
    .limit(opts.limit ?? 400)
    .all();
}

/**
 * Logs a routine as done for one day.
 *
 * Idempotent per routine per day: the table has a unique index on
 * (routine_id, date), and a second call for the same day updates that row instead of
 * creating a duplicate. So a double-tapped button cannot inflate a count.
 */
export function logRoutineDone(
  userId: string,
  routineId: string,
  input: { date: string; completedStepIds?: string[]; note?: string } ,
): string {
  const routine = db
    .select({ id: groomingRoutines.id })
    .from(groomingRoutines)
    .where(and(eq(groomingRoutines.id, routineId), eq(groomingRoutines.userId, userId)))
    .get();
  if (!routine) throw new NotFoundError('That routine does not exist.');

  const date = assertIsoDate(input.date, 'date');
  // Only step ids that belong to this routine are stored.
  const validStepIds = new Set(stepsForOwnedRoutine(userId, routineId).map((s) => s.id));
  const completedStepIds = [...new Set(input.completedStepIds ?? [])].filter((id) =>
    validStepIds.has(id),
  );
  const note = (input.note ?? '').slice(0, MAX_NOTES);

  const existing = db
    .select({ id: groomingRoutineLogs.id })
    .from(groomingRoutineLogs)
    .where(
      and(
        eq(groomingRoutineLogs.routineId, routineId),
        eq(groomingRoutineLogs.date, date),
        eq(groomingRoutineLogs.userId, userId),
      ),
    )
    .get();

  const id = existing?.id ?? newId();
  db.insert(groomingRoutineLogs)
    .values({ id, userId, routineId, date, completedStepIds, note })
    .onConflictDoUpdate({
      target: [groomingRoutineLogs.routineId, groomingRoutineLogs.date],
      set: { completedStepIds, note },
    })
    .run();
  return id;
}

export function unlogRoutine(userId: string, routineId: string, date: string): void {
  db.delete(groomingRoutineLogs)
    .where(
      and(
        eq(groomingRoutineLogs.userId, userId),
        eq(groomingRoutineLogs.routineId, routineId),
        eq(groomingRoutineLogs.date, assertIsoDate(date, 'date')),
      ),
    )
    .run();
}

/* ------------------------------------------------------------- appointments */

export interface AppointmentInput {
  title: string;
  kind?: string;
  scheduledAt: string;
  location?: string;
  notes?: string;
}

export function listAppointments(
  userId: string,
  opts: { from?: string; includeCompleted?: boolean; limit?: number } = {},
) {
  const clauses = [eq(groomingAppointments.userId, userId)];
  if (opts.from) clauses.push(gte(groomingAppointments.scheduledAt, opts.from));
  if (!opts.includeCompleted) clauses.push(eq(groomingAppointments.completed, false));
  return db
    .select()
    .from(groomingAppointments)
    .where(and(...clauses))
    .orderBy(asc(groomingAppointments.scheduledAt))
    .limit(opts.limit ?? 100)
    .all();
}

export function getAppointment(userId: string, appointmentId: string) {
  const row = db
    .select()
    .from(groomingAppointments)
    .where(
      and(eq(groomingAppointments.id, appointmentId), eq(groomingAppointments.userId, userId)),
    )
    .get();
  if (!row) throw new NotFoundError('That appointment does not exist.');
  return row;
}

export function createAppointment(userId: string, input: AppointmentInput): string {
  const title = input.title.trim();
  if (!title) throw new ValidationError('Give the appointment a title.', 'title');
  if (Number.isNaN(Date.parse(input.scheduledAt))) {
    throw new ValidationError('Pick a date and time for the appointment.', 'scheduledAt');
  }
  const id = newId();
  db.insert(groomingAppointments)
    .values({
      id,
      userId,
      title: title.slice(0, MAX_NAME),
      kind: (input.kind ?? 'other').slice(0, 40),
      scheduledAt: new Date(input.scheduledAt).toISOString(),
      location: (input.location ?? '').slice(0, 200),
      notes: (input.notes ?? '').slice(0, MAX_NOTES),
    })
    .run();
  return id;
}

export function updateAppointment(
  userId: string,
  appointmentId: string,
  input: Partial<AppointmentInput> & { completed?: boolean },
): void {
  const existing = db
    .select({ id: groomingAppointments.id })
    .from(groomingAppointments)
    .where(
      and(eq(groomingAppointments.id, appointmentId), eq(groomingAppointments.userId, userId)),
    )
    .get();
  if (!existing) throw new NotFoundError('That appointment does not exist.');

  const patch: Partial<typeof groomingAppointments.$inferInsert> = {};
  if (input.title != null) {
    const title = input.title.trim();
    if (!title) throw new ValidationError('Give the appointment a title.', 'title');
    patch.title = title.slice(0, MAX_NAME);
  }
  if (input.kind != null) patch.kind = input.kind.slice(0, 40);
  if (input.scheduledAt != null) {
    if (Number.isNaN(Date.parse(input.scheduledAt))) {
      throw new ValidationError('Pick a date and time for the appointment.', 'scheduledAt');
    }
    patch.scheduledAt = new Date(input.scheduledAt).toISOString();
  }
  if (input.location != null) patch.location = input.location.slice(0, 200);
  if (input.notes != null) patch.notes = input.notes.slice(0, MAX_NOTES);
  if (input.completed != null) patch.completed = input.completed;
  if (Object.keys(patch).length === 0) return;

  db.update(groomingAppointments)
    .set(patch)
    .where(
      and(eq(groomingAppointments.id, appointmentId), eq(groomingAppointments.userId, userId)),
    )
    .run();
}

export function deleteAppointment(userId: string, appointmentId: string): void {
  const existing = db
    .select({ id: groomingAppointments.id })
    .from(groomingAppointments)
    .where(
      and(eq(groomingAppointments.id, appointmentId), eq(groomingAppointments.userId, userId)),
    )
    .get();
  if (!existing) throw new NotFoundError('That appointment does not exist.');
  db.delete(groomingAppointments)
    .where(
      and(eq(groomingAppointments.id, appointmentId), eq(groomingAppointments.userId, userId)),
    )
    .run();
}

/* ----------------------------------------------------------------- hub view */

export interface RoutineDueView {
  routine: RoutineView;
  due: DueVerdict;
  adherence: AdherenceSummary;
  /**
   * The steps the user ticked in today's log, so the hub can show the checklist in the
   * state they left it. Empty when today has no log, or when they logged the routine
   * without naming steps — both of which are fine, and different from each other.
   */
  completedStepIds: string[];
}

/**
 * The grooming hub's data: which active routines the engine says are due today,
 * and a plain count of the last fortnight. All dates come from `today`, passed in by
 * the caller, so the engine stays deterministic.
 */
export function routinesDue(userId: string, today: string): RoutineDueView[] {
  const date = assertIsoDate(today, 'today');
  const routines = listRoutines(userId, { includeInactive: false });
  if (routines.length === 0) return [];
  const windowStart = new Date(Date.parse(`${date}T00:00:00Z`) - 27 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const logs = listRoutineLogs(userId, { from: windowStart, to: date });
  const todaysSteps = new Map(
    logs.filter((l) => l.date === date).map((l) => [l.routineId, l.completedStepIds]),
  );
  return routines.map((routine) => ({
    routine,
    completedStepIds: todaysSteps.get(routine.id) ?? [],
    due: routineDueToday(
      {
        id: routine.id,
        name: routine.name,
        slot: routine.slot,
        daysOfWeek: routine.daysOfWeek,
        active: routine.active,
      },
      date,
      logs.map((l) => ({ routineId: l.routineId, date: l.date })),
    ),
    adherence: routineAdherence(
      logs.filter((l) => l.routineId === routine.id).map((l) => ({ date: l.date })),
      14,
      date,
    ),
  }));
}

export function upcomingAppointments(userId: string, today: string, days = 30) {
  const date = assertIsoDate(today, 'today');
  const from = `${date}T00:00:00.000Z`;
  const to = new Date(Date.parse(from) + days * 86_400_000).toISOString();
  return db
    .select()
    .from(groomingAppointments)
    .where(
      and(
        eq(groomingAppointments.userId, userId),
        eq(groomingAppointments.completed, false),
        gte(groomingAppointments.scheduledAt, from),
        lte(groomingAppointments.scheduledAt, to),
      ),
    )
    .orderBy(asc(groomingAppointments.scheduledAt))
    .all();
}

export { nowIso };
