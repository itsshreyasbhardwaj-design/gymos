/**
 * Personal Hygiene OS — service-layer integration tests against a real database.
 *
 * Covers ownership isolation on routines, tasks, check-ins and supplies, check-in
 * idempotency, the `care_routines` entitlement gate, and the rule that a task
 * cannot be checked in by anyone other than the routine's owner.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();

let account: typeof import('@/lib/services/account');
let hygiene: typeof import('@/lib/services/hygiene');
let equipmentSvc: typeof import('@/lib/services/equipment');
let entitlementEngine: typeof import('@/lib/engines/entitlements');
let hygieneEngine: typeof import('@/lib/engines/hygiene');
let dbClient: typeof import('@/lib/db/client');
let schema: typeof import('@/lib/db/schema');
let drizzle: typeof import('drizzle-orm');

let ownerId: string;
let strangerId: string;
let freeUserId: string;

const TODAY = '2026-10-26'; // a Monday

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  hygiene = await import('@/lib/services/hygiene');
  equipmentSvc = await import('@/lib/services/equipment');
  entitlementEngine = await import('@/lib/engines/entitlements');
  hygieneEngine = await import('@/lib/engines/hygiene');
  dbClient = await import('@/lib/db/client');
  schema = await import('@/lib/db/schema');
  drizzle = await import('drizzle-orm');

  ownerId = await account.registerUser({
    email: 'hygiene-owner@example.com',
    password: 'hygiene-owner-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(ownerId, { displayName: 'Owner', ageBand: 'adult_18_plus' });
  account.devSetPlan(ownerId, 'pro');

  strangerId = await account.registerUser({
    email: 'hygiene-stranger@example.com',
    password: 'hygiene-stranger-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(strangerId, { displayName: 'Stranger', ageBand: 'adult_18_plus' });
  account.devSetPlan(strangerId, 'pro');

  freeUserId = await account.registerUser({
    email: 'hygiene-free@example.com',
    password: 'hygiene-free-long-secret',
    acceptTerms: true,
  });
  // A teen account: this module has no media and no consent gate, so it must work.
  account.upsertProfile(freeUserId, { displayName: 'Free', ageBand: 'teen_13_17' });
}, 60_000);

afterAll(() => temp.cleanup());

/* ------------------------------------------------------------------ basics */

describe('routine and task CRUD', () => {
  let routineId: string;

  it('creates a routine with ordered tasks', () => {
    routineId = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Morning routine',
      category: 'oral',
      cadence: 'daily',
      tasks: [{ label: 'Brush teeth' }, { label: 'Floss' }, { label: '   ' }],
    });
    const routine = hygiene.getRoutine(ownerId, routineId);
    expect(routine.name).toBe('Morning routine');
    expect(routine.cadence).toBe('daily');
    expect(routine.tasks.map((t) => t.label)).toEqual(['Brush teeth', 'Floss']);
    expect(routine.tasks.map((t) => t.orderIndex)).toEqual([0, 1]);
  });

  it('appends a task after the existing ones', () => {
    const taskId = hygiene.addTask(ownerId, routineId, { label: 'Mouthwash' });
    const routine = hygiene.getRoutine(ownerId, routineId);
    expect(routine.tasks.at(-1)).toMatchObject({ id: taskId, label: 'Mouthwash', orderIndex: 2 });
  });

  it('reorders tasks and keeps any id it was not given', () => {
    const before = hygiene.getRoutine(ownerId, routineId).tasks;
    hygiene.reorderTasks(ownerId, routineId, [before[2]!.id, before[0]!.id]);
    const after = hygiene.getRoutine(ownerId, routineId).tasks;
    expect(after.map((t) => t.label)).toEqual(['Mouthwash', 'Brush teeth', 'Floss']);
  });

  it('rejects an empty name and an impossible cadence', () => {
    expect(() =>
      hygiene.createRoutine(ownerId, 'pro', { name: '   ', cadence: 'daily' }),
    ).toThrow(hygiene.ValidationError);
    expect(() =>
      hygiene.createRoutine(ownerId, 'pro', { name: 'Bad', cadence: 'fortnightly' }),
    ).toThrow(hygiene.ValidationError);
    // A custom cadence with neither an interval nor days cannot be scheduled.
    expect(() =>
      hygiene.createRoutine(ownerId, 'pro', { name: 'Bad', cadence: 'custom' }),
    ).toThrow(hygiene.ValidationError);
  });

  it('stores the cadence fields a custom routine needs', () => {
    const id = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Bedding',
      cadence: 'custom',
      everyNDays: 14,
      tasks: [{ label: 'Change sheets' }],
    });
    const routine = hygiene.getRoutine(ownerId, id);
    expect(routine.everyNDays).toBe(14);
    expect(routine.daysOfWeek).toEqual([]);
    hygiene.deleteRoutine(ownerId, id);
  });

  it('pauses a routine without losing its history', () => {
    hygiene.setRoutineActive(ownerId, routineId, false);
    expect(hygiene.listRoutines(ownerId, { activeOnly: true }).map((r) => r.id)).not.toContain(
      routineId,
    );
    hygiene.setRoutineActive(ownerId, routineId, true);
    expect(hygiene.getRoutine(ownerId, routineId).active).toBe(true);
  });

  it('removes a deleted task id from the check-in history', () => {
    const id = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Temporary',
      cadence: 'daily',
      tasks: [{ label: 'Keep' }, { label: 'Drop' }],
    });
    const tasks = hygiene.getRoutine(ownerId, id).tasks;
    hygiene.checkInRoutine(ownerId, id, { date: TODAY });
    expect(hygiene.listCheckins(ownerId, { routineId: id })[0]!.completedTaskIds).toHaveLength(2);
    hygiene.deleteTask(ownerId, tasks[1]!.id);
    expect(hygiene.listCheckins(ownerId, { routineId: id })[0]!.completedTaskIds).toEqual([
      tasks[0]!.id,
    ]);
    hygiene.deleteRoutine(ownerId, id);
  });
});

/* ------------------------------------------------------------ idempotency */

describe('check-in idempotency', () => {
  let routineId: string;
  let taskIds: string[];

  beforeAll(() => {
    routineId = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Idempotency routine',
      cadence: 'daily',
      tasks: [{ label: 'One' }, { label: 'Two' }],
    });
    taskIds = hygiene.getRoutine(ownerId, routineId).tasks.map((t) => t.id);
  });

  it('writes one row per routine per day however many times it is called', () => {
    hygiene.checkInTask(ownerId, taskIds[0]!, { date: TODAY });
    hygiene.checkInTask(ownerId, taskIds[0]!, { date: TODAY });
    hygiene.checkInTask(ownerId, taskIds[0]!, { date: TODAY });
    const rows = hygiene.listCheckins(ownerId, { routineId, from: TODAY, to: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completedTaskIds).toEqual([taskIds[0]]);
  });

  it('adds a second task to the same row rather than a second row', () => {
    hygiene.checkInTask(ownerId, taskIds[1]!, { date: TODAY });
    const rows = hygiene.listCheckins(ownerId, { routineId, from: TODAY, to: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completedTaskIds.slice().sort()).toEqual(taskIds.slice().sort());
  });

  it('is idempotent for the whole routine too', () => {
    hygiene.checkInRoutine(ownerId, routineId, { date: TODAY });
    hygiene.checkInRoutine(ownerId, routineId, { date: TODAY });
    const rows = hygiene.listCheckins(ownerId, { routineId, from: TODAY, to: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completedTaskIds).toHaveLength(2);
  });

  it('keeps separate rows for separate days', () => {
    hygiene.checkInTask(ownerId, taskIds[0]!, { date: '2026-10-27' });
    expect(hygiene.listCheckins(ownerId, { routineId }).length).toBe(2);
  });

  it('lets a mistaken tick be undone, and un-ticking twice is harmless', () => {
    hygiene.uncheckTask(ownerId, taskIds[0]!, TODAY);
    hygiene.uncheckTask(ownerId, taskIds[0]!, TODAY);
    const row = hygiene.listCheckins(ownerId, { routineId, from: TODAY, to: TODAY })[0]!;
    expect(row.completedTaskIds).toEqual([taskIds[1]]);
  });

  it('refuses a date that is not a real date', () => {
    expect(() => hygiene.checkInTask(ownerId, taskIds[0]!, { date: '2026-02-30' })).toThrow(
      hygiene.ValidationError,
    );
  });

  it('records a snooze on the same single row for the day', () => {
    hygiene.snoozeRoutine(ownerId, routineId, '2026-10-30', TODAY);
    const rows = hygiene.listCheckins(ownerId, { routineId, from: TODAY, to: TODAY });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snoozedUntil).toBe('2026-10-30');
  });
});

/* -------------------------------------------------------- ownership isolation */

describe('ownership isolation', () => {
  let ownerRoutineId: string;
  let ownerTaskId: string;
  let ownerSupplyId: string;
  let strangerRoutineId: string;

  beforeAll(() => {
    ownerRoutineId = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Private routine',
      cadence: 'weekly',
      daysOfWeek: [1],
      tasks: [{ label: 'Private task' }],
    });
    ownerTaskId = hygiene.getRoutine(ownerId, ownerRoutineId).tasks[0]!.id;
    ownerSupplyId = hygiene.createSupply(ownerId, {
      name: 'Owner toothpaste',
      lastReplacedAt: '2026-10-01',
      replaceEveryDays: 30,
    });
    strangerRoutineId = hygiene.createRoutine(strangerId, 'pro', {
      name: 'Stranger routine',
      cadence: 'daily',
      tasks: [{ label: 'Stranger task' }],
    });
  });

  it('never lists another user\'s routines or supplies', () => {
    const strangerRoutines = hygiene.listRoutines(strangerId).map((r) => r.name);
    expect(strangerRoutines).toContain('Stranger routine');
    expect(strangerRoutines).not.toContain('Private routine');
    expect(hygiene.listSupplies(strangerId)).toHaveLength(0);
  });

  it('refuses to read a routine by id across users', () => {
    expect(() => hygiene.getRoutine(strangerId, ownerRoutineId)).toThrow(hygiene.NotFoundError);
    expect(() => hygiene.getRoutine(ownerId, strangerRoutineId)).toThrow(hygiene.NotFoundError);
  });

  it('refuses every write to a routine the caller does not own', () => {
    expect(() => hygiene.updateRoutine(strangerId, ownerRoutineId, { name: 'Hijacked' })).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.setRoutineActive(strangerId, ownerRoutineId, false)).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.deleteRoutine(strangerId, ownerRoutineId)).toThrow(hygiene.NotFoundError);
    expect(() => hygiene.addTask(strangerId, ownerRoutineId, { label: 'Injected' })).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.reorderTasks(strangerId, ownerRoutineId, [ownerTaskId])).toThrow(
      hygiene.NotFoundError,
    );
    expect(hygiene.getRoutine(ownerId, ownerRoutineId).name).toBe('Private routine');
    expect(hygiene.getRoutine(ownerId, ownerRoutineId).tasks).toHaveLength(1);
  });

  it('refuses every write to a task whose routine the caller does not own', () => {
    expect(() => hygiene.updateTask(strangerId, ownerTaskId, { label: 'Hijacked' })).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.deleteTask(strangerId, ownerTaskId)).toThrow(hygiene.NotFoundError);
    expect(hygiene.getRoutine(ownerId, ownerRoutineId).tasks[0]!.label).toBe('Private task');
  });

  it('a task cannot be checked in by a non-owner', () => {
    expect(() => hygiene.checkInTask(strangerId, ownerTaskId, { date: TODAY })).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.uncheckTask(strangerId, ownerTaskId, TODAY)).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.checkInRoutine(strangerId, ownerRoutineId, { date: TODAY })).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.snoozeRoutine(strangerId, ownerRoutineId, '2026-11-01', TODAY)).toThrow(
      hygiene.NotFoundError,
    );
    // Nothing was written for either user.
    const { db } = dbClient;
    const rows = db
      .select()
      .from(schema.hygieneCheckins)
      .where(drizzle.eq(schema.hygieneCheckins.routineId, ownerRoutineId))
      .all();
    expect(rows).toHaveLength(0);
  });

  it('never lets a check-in cross users even when the row exists', () => {
    hygiene.checkInTask(ownerId, ownerTaskId, { date: TODAY });
    expect(
      hygiene.listCheckins(strangerId, { routineId: ownerRoutineId, from: TODAY, to: TODAY }),
    ).toHaveLength(0);
    expect(
      hygiene.listCheckins(ownerId, { routineId: ownerRoutineId, from: TODAY, to: TODAY }),
    ).toHaveLength(1);
  });

  it('refuses every supply write across users', () => {
    expect(() => hygiene.updateSupply(strangerId, ownerSupplyId, { name: 'Hijacked' })).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.setSupplyRunningLow(strangerId, ownerSupplyId, true)).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.markSupplyReplaced(strangerId, ownerSupplyId, TODAY)).toThrow(
      hygiene.NotFoundError,
    );
    expect(() => hygiene.deleteSupply(strangerId, ownerSupplyId)).toThrow(hygiene.NotFoundError);
    expect(hygiene.listSupplies(ownerId).find((s) => s.id === ownerSupplyId)?.name).toBe(
      'Owner toothpaste',
    );
  });

  it('keeps the stranger\'s dashboard free of the owner\'s rows', () => {
    const dashboard = hygiene.hygieneDashboard(strangerId, { today: TODAY });
    const ids = dashboard.due.map((d) => d.routineId);
    expect(ids).not.toContain(ownerRoutineId);
    expect(JSON.stringify(dashboard)).not.toContain('Private routine');
    expect(JSON.stringify(dashboard)).not.toContain('Owner toothpaste');
  });
});

/* ------------------------------------------------------------- entitlement */

describe('care_routines entitlement gate', () => {
  it('allows the free allowance and then refuses, without writing a row', () => {
    const limit = entitlementEngine.getEntitlement('free', 'care_routines').limitValue!;
    expect(limit).toBeGreaterThan(0);
    for (let i = 0; i < limit; i += 1) {
      hygiene.createRoutine(freeUserId, 'free', { name: `Routine ${i + 1}`, cadence: 'daily' });
    }
    expect(hygiene.listRoutines(freeUserId)).toHaveLength(limit);

    let thrown: unknown;
    try {
      hygiene.createRoutine(freeUserId, 'free', { name: 'One too many', cadence: 'daily' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(entitlementEngine.EntitlementError);
    expect((thrown as InstanceType<typeof entitlementEngine.EntitlementError>).feature).toBe(
      'care_routines',
    );
    expect(hygiene.listRoutines(freeUserId)).toHaveLength(limit);
  });

  it('counts only active routines, so pausing one frees the allowance', () => {
    const paused = hygiene.listRoutines(freeUserId)[0]!;
    hygiene.setRoutineActive(freeUserId, paused.id, false);
    const extraId = hygiene.createRoutine(freeUserId, 'free', {
      name: 'Replacement',
      cadence: 'daily',
    });
    expect(hygiene.getRoutine(freeUserId, extraId).name).toBe('Replacement');
    hygiene.deleteRoutine(freeUserId, extraId);
    hygiene.setRoutineActive(freeUserId, paused.id, true);
  });

  it('shares the allowance with grooming routines, as the matrix says', () => {
    const { db } = dbClient;
    // One grooming routine created directly: the limit is one allowance across both.
    db.insert(schema.groomingRoutines)
      .values({ id: 'grooming-shared-test', userId: freeUserId, name: 'Shared', active: true })
      .run();
    expect(() =>
      hygiene.createRoutine(freeUserId, 'free', { name: 'Blocked', cadence: 'daily' }),
    ).toThrow(entitlementEngine.EntitlementError);
    db.delete(schema.groomingRoutines)
      .where(drizzle.eq(schema.groomingRoutines.id, 'grooming-shared-test'))
      .run();
  });

  it('never gates ticking a routine behind a plan', () => {
    const routine = hygiene.listRoutines(freeUserId)[0]!;
    const taskId = hygiene.addTask(freeUserId, routine.id, { label: 'Free task' });
    expect(hygiene.checkInTask(freeUserId, taskId, { date: TODAY }).completedTaskIds).toEqual([
      taskId,
    ]);
    // Supplies are not gated either: running out of soap is not a paid feature.
    const supplyId = hygiene.createSupply(freeUserId, { name: 'Free soap' });
    expect(hygiene.listSupplies(freeUserId).map((s) => s.id)).toContain(supplyId);
  });
});

/* --------------------------------------------------------------- supplies */

describe('supplies', () => {
  it('computes a runway from the user\'s own numbers and flags a restock', () => {
    const id = hygiene.createSupply(ownerId, {
      name: 'Razor blades',
      lastReplacedAt: '2026-09-01',
      replaceEveryDays: 30,
    });
    const dashboard = hygiene.hygieneDashboard(ownerId, { today: TODAY });
    const row = dashboard.supplies.find((s) => s.supplyId === id)!;
    expect(row.basis).toBe('typical_usage');
    expect(row.daysLeft).toBe(-25);
    expect(row.restock).toBe(true);
    expect(dashboard.restock.map((s) => s.supplyId)).toContain(id);
  });

  it('reports unknown rather than a number when the user has given no interval', () => {
    const id = hygiene.createSupply(ownerId, { name: 'Unknown item' });
    const row = hygiene
      .hygieneDashboard(ownerId, { today: TODAY })
      .supplies.find((s) => s.supplyId === id)!;
    expect(row.basis).toBe('unknown');
    expect(row.daysLeft).toBeNull();
  });

  it('clears the running-low flag when the item is marked replaced', () => {
    const id = hygiene.createSupply(ownerId, { name: 'Shampoo', runningLow: true });
    hygiene.setSupplyRunningLow(ownerId, id, true);
    hygiene.markSupplyReplaced(ownerId, id, TODAY);
    const row = hygiene.listSupplies(ownerId).find((s) => s.id === id)!;
    expect(row.runningLow).toBe(false);
    expect(row.lastReplacedAt).toBe(TODAY);
  });

  it('rejects an impossible replacement interval', () => {
    expect(() =>
      hygiene.createSupply(ownerId, { name: 'Bad interval', replaceEveryDays: 0 }),
    ).toThrow(hygiene.ValidationError);
  });
});

/* ------------------------------------------------------- today's list */

describe("today's list", () => {
  it('keeps a fully ticked routine on the list so the tick can be undone', () => {
    const id = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Undoable routine',
      cadence: 'daily',
      tasks: [{ label: 'Only task' }],
    });
    const taskId = hygiene.getRoutine(ownerId, id).tasks[0]!.id;

    const before = hygiene.hygieneDashboard(ownerId, { today: TODAY });
    expect(before.todayList.map((r) => r.routineId)).toContain(id);

    // One tick finishes this single-task routine, so `dueNow` correctly drops it and
    // the "to tick today" count falls by exactly that one task.
    hygiene.checkInTask(ownerId, taskId, { date: TODAY });
    const after = hygiene.hygieneDashboard(ownerId, { today: TODAY });
    expect(after.dueNow.map((r) => r.routineId)).not.toContain(id);
    expect(after.outstandingTaskCount).toBe(before.outstandingTaskCount - 1);

    // …but the list the page renders keeps it, with its ticked checkbox.
    const row = after.todayList.find((r) => r.routineId === id)!;
    expect(row.status).toBe('done_today');
    expect(row.tasks).toEqual([
      expect.objectContaining({ id: taskId, doneToday: true }),
    ]);

    hygiene.uncheckTask(ownerId, taskId, TODAY);
    const undone = hygiene.hygieneDashboard(ownerId, { today: TODAY });
    expect(undone.dueNow.map((r) => r.routineId)).toContain(id);
    hygiene.deleteRoutine(ownerId, id);
  });

  it('keeps the header agreeing with the list once everything is ticked', () => {
    // The page builds its "tasks to tick today" header from these same rows, so the
    // wording is checked here against a real database rather than only in the engine.
    const id = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Header routine',
      cadence: 'daily',
      tasks: [{ label: 'Only task' }],
    });
    const taskId = hygiene.getRoutine(ownerId, id).tasks[0]!.id;
    hygiene.checkInTask(ownerId, taskId, { date: TODAY });

    const dashboard = hygiene.hygieneDashboard(ownerId, { today: TODAY });
    const counts = hygieneEngine.todayListCounts(dashboard.due, dashboard.today);
    expect(dashboard.todayList.map((r) => r.routineId)).toContain(id);
    expect(dashboard.dueNow.map((r) => r.routineId)).not.toContain(id);
    // The header counts every card on screen, not just the outstanding ones …
    expect(counts.onList).toBe(dashboard.todayList.length);
    // … while the figure itself stays the honest outstanding count.
    expect(counts.tasksStillToTick).toBe(dashboard.outstandingTaskCount);
    expect(counts.tasksTicked).toBeGreaterThan(0);
    expect(counts.note).toContain(`on the list for ${TODAY}`);
    expect(counts.note).not.toBe(`Nothing on the list for ${TODAY}.`);

    hygiene.deleteRoutine(ownerId, id);
  });

  it('leaves off a routine that is neither due nor ticked today', () => {
    const id = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Thursday only',
      cadence: 'weekly',
      daysOfWeek: [4], // TODAY is a Monday
      tasks: [{ label: 'Change towels' }],
    });
    expect(
      hygiene.hygieneDashboard(ownerId, { today: TODAY }).todayList.map((r) => r.routineId),
    ).not.toContain(id);
    hygiene.deleteRoutine(ownerId, id);
  });

  it('leaves a routine the user set aside out of the upcoming list', () => {
    const id = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Set aside routine',
      cadence: 'weekly',
      daysOfWeek: [4],
      tasks: [{ label: 'Change sheets' }],
    });
    const upcomingIds = () =>
      hygiene.hygieneDashboard(ownerId, { today: TODAY }).upcoming.map((u) => u.routineId);
    expect(upcomingIds()).toContain(id);

    hygiene.snoozeRoutine(ownerId, id, '2026-10-30', TODAY); // past the Thursday
    expect(upcomingIds()).not.toContain(id);
    hygiene.deleteRoutine(ownerId, id);
  });
});

/* ------------------------------------------------------- partial updates */

/**
 * The edit forms on the page send only the fields they show, so a patch must leave
 * everything else exactly as it was. These lock the service contract the hygiene
 * actions rely on: a field absent from the patch is untouched, and only an explicit
 * null clears one.
 */
describe('partial updates', () => {
  it('keeps a routine\'s cadence, days, interval and notes when only the name changes', () => {
    const id = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Before',
      category: 'oral',
      cadence: 'custom',
      everyNDays: 9,
      daysOfWeek: [2, 5],
      notes: 'Keep me',
      tasks: [{ label: 'Something' }],
    });
    hygiene.updateRoutine(ownerId, id, { name: 'After' });
    const routine = hygiene.getRoutine(ownerId, id);
    expect(routine.name).toBe('After');
    expect(routine.category).toBe('oral');
    expect(routine.cadence).toBe('custom');
    expect(routine.everyNDays).toBe(9);
    expect(routine.daysOfWeek).toEqual([2, 5]);
    expect(routine.notes).toBe('Keep me');
    expect(routine.active).toBe(true);
    expect(routine.tasks).toHaveLength(1);
    hygiene.deleteRoutine(ownerId, id);
  });

  it('empties a routine\'s chosen days only when an empty list is passed', () => {
    const id = hygiene.createRoutine(ownerId, 'pro', {
      name: 'Weekly',
      cadence: 'weekly',
      daysOfWeek: [1, 4],
    });
    hygiene.updateRoutine(ownerId, id, { name: 'Weekly still' });
    expect(hygiene.getRoutine(ownerId, id).daysOfWeek).toEqual([1, 4]);
    hygiene.updateRoutine(ownerId, id, { daysOfWeek: [] });
    expect(hygiene.getRoutine(ownerId, id).daysOfWeek).toEqual([]);
    hygiene.deleteRoutine(ownerId, id);
  });

  it('keeps a supply\'s replacement date and interval when only the name changes', () => {
    const id = hygiene.createSupply(ownerId, {
      name: 'Deodorant',
      category: 'body',
      lastReplacedAt: '2026-10-01',
      replaceEveryDays: 45,
      notes: 'The big one',
    });
    hygiene.updateSupply(ownerId, id, { name: 'Deodorant (large)' });
    const row = hygiene.listSupplies(ownerId).find((s) => s.id === id)!;
    expect(row.name).toBe('Deodorant (large)');
    expect(row.category).toBe('body');
    expect(row.lastReplacedAt).toBe('2026-10-01');
    expect(row.replaceEveryDays).toBe(45);
    expect(row.notes).toBe('The big one');
    hygiene.deleteSupply(ownerId, id);
  });

  it('clears a supply\'s date or interval only when null is passed for it', () => {
    const id = hygiene.createSupply(ownerId, {
      name: 'Razor cartridges',
      lastReplacedAt: '2026-10-01',
      replaceEveryDays: 45,
    });
    hygiene.updateSupply(ownerId, id, { replaceEveryDays: null });
    let row = hygiene.listSupplies(ownerId).find((s) => s.id === id)!;
    expect(row.replaceEveryDays).toBeNull();
    expect(row.lastReplacedAt).toBe('2026-10-01'); // untouched by the other patch

    // With the interval gone the runway is honestly unknown, not zero.
    const runway = hygiene
      .hygieneDashboard(ownerId, { today: TODAY })
      .supplies.find((s) => s.supplyId === id)!;
    expect(runway.basis).toBe('unknown');
    expect(runway.daysLeft).toBeNull();

    hygiene.updateSupply(ownerId, id, { lastReplacedAt: null });
    row = hygiene.listSupplies(ownerId).find((s) => s.id === id)!;
    expect(row.lastReplacedAt).toBeNull();
    hygiene.deleteSupply(ownerId, id);
  });
});

/* -------------------------------------------------------------- dashboard */

describe('dashboard', () => {
  it('is built only from the caller\'s rows and the pure engine', () => {
    const dashboard = hygiene.hygieneDashboard(ownerId, { today: TODAY, windowDays: 14 });
    expect(dashboard.today).toBe(TODAY);
    expect(dashboard.summary.windowDays).toBe(14);
    expect(dashboard.summary.windowEnd).toBe(TODAY);
    expect(dashboard.activeRoutineCount).toBe(hygiene.activeRoutineCount(ownerId));
    expect(dashboard.due.every((d) => dashboard.routineNames[d.routineId])).toBe(true);
  });

  it('holds no score, grade or rating anywhere in its payload', () => {
    const json = JSON.stringify(hygiene.hygieneDashboard(ownerId, { today: TODAY }));
    for (const banned of ['score', 'grade', 'rating', 'streak', 'attractive', 'bodyFat']) {
      expect(json.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it('works for a teen account with no consent granted and no media involved', () => {
    expect(account.getConsent(freeUserId, 'biometrics')).toBe(false);
    const dashboard = hygiene.hygieneDashboard(freeUserId, { today: TODAY });
    expect(dashboard.routineCount).toBeGreaterThan(0);
    expect(dashboard.today).toBe(TODAY);
  });

  it('deletes with the account, leaving no hygiene rows behind', () => {
    const { db } = dbClient;
    expect(
      db
        .select()
        .from(schema.hygieneRoutines)
        .where(drizzle.eq(schema.hygieneRoutines.userId, ownerId))
        .all().length,
    ).toBeGreaterThan(0);

    account.deleteAccount(ownerId);

    for (const [name, rows] of Object.entries({
      routines: db
        .select()
        .from(schema.hygieneRoutines)
        .where(drizzle.eq(schema.hygieneRoutines.userId, ownerId))
        .all(),
      checkins: db
        .select()
        .from(schema.hygieneCheckins)
        .where(drizzle.eq(schema.hygieneCheckins.userId, ownerId))
        .all(),
      supplies: db
        .select()
        .from(schema.personalCareSupplies)
        .where(drizzle.eq(schema.personalCareSupplies.userId, ownerId))
        .all(),
    })) {
      expect(rows.length, `${name} survived account deletion`).toBe(0);
    }
    // And no orphaned task rows.
    const routineIds = new Set(db.select().from(schema.hygieneRoutines).all().map((r) => r.id));
    for (const task of db.select().from(schema.hygieneTasks).all()) {
      expect(routineIds.has(task.routineId)).toBe(true);
    }
    // The other users are untouched.
    expect(hygiene.listRoutines(strangerId).length).toBeGreaterThan(0);
    expect(equipmentSvc.listGymProfiles(strangerId)).toEqual([]);
  });
});
