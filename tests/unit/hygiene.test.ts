/**
 * Personal Hygiene OS — pure engine tests.
 *
 * Covers the cadence maths for all three cadences, the never-done case, the
 * everyNDays boundaries, supply runway (including the honest "unknown"), and the
 * safety rule that no output is a score or grade and no copy shames anyone.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  addDays,
  dayOfWeek,
  dueTaskCount,
  dueTasks,
  nextDueDate,
  resolveSchedule,
  routineSummary,
  supplyRunway,
  supplyRunways,
  todayListCounts,
  upcomingSchedule,
  RESTOCK_SOON_DAYS,
  type CheckinInput,
  type RoutineInput,
  type SupplyInput,
  type TaskInput,
} from '@/lib/engines/hygiene';

/** 2026-10-26 is a Monday (dayOfWeek 1). Every test anchors on it. */
const MONDAY = '2026-10-26';

const routine = (over: Partial<RoutineInput> = {}): RoutineInput => ({
  id: 'r1',
  name: 'Morning routine',
  category: 'general',
  cadence: 'daily',
  daysOfWeek: [],
  everyNDays: null,
  active: true,
  ...over,
});

const task = (id: string, orderIndex = 0, routineId = 'r1'): TaskInput => ({
  id,
  routineId,
  orderIndex,
  label: `Task ${id}`,
});

const checkin = (date: string, completedTaskIds: string[], over: Partial<CheckinInput> = {}): CheckinInput => ({
  routineId: 'r1',
  date,
  completedTaskIds,
  snoozedUntil: null,
  ...over,
});

const supply = (over: Partial<SupplyInput> = {}): SupplyInput => ({
  id: 's1',
  name: 'Toothpaste',
  category: 'general',
  runningLow: false,
  lastReplacedAt: null,
  replaceEveryDays: null,
  ...over,
});

/* ------------------------------------------------------------ date helpers */

describe('date helpers are deterministic and UTC', () => {
  it('uses the 0=Sunday convention the rest of GymOS uses', () => {
    expect(dayOfWeek('2026-10-25')).toBe(0); // Sunday
    expect(dayOfWeek(MONDAY)).toBe(1);
    expect(dayOfWeek('2026-10-31')).toBe(6); // Saturday
  });

  it('adds days across a month boundary', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('rejects anything that is not an ISO date', () => {
    expect(() => addDays('26-10-2026', 1)).toThrow();
  });
});

/* -------------------------------------------------------------- cadence */

describe('resolveSchedule', () => {
  it('maps daily to a one-day interval', () => {
    expect(resolveSchedule(routine())).toEqual({ kind: 'interval', everyNDays: 1 });
  });

  it('maps weekly with named days to those days, sorted and de-duplicated', () => {
    expect(resolveSchedule(routine({ cadence: 'weekly', daysOfWeek: [4, 1, 1] }))).toEqual({
      kind: 'days_of_week',
      days: [1, 4],
    });
  });

  it('maps weekly with no named days to a seven-day interval', () => {
    expect(resolveSchedule(routine({ cadence: 'weekly' }))).toEqual({
      kind: 'interval',
      everyNDays: 7,
    });
  });

  it('maps custom to its interval, and reports "none" when nothing was supplied', () => {
    expect(resolveSchedule(routine({ cadence: 'custom', everyNDays: 3 }))).toEqual({
      kind: 'interval',
      everyNDays: 3,
    });
    expect(resolveSchedule(routine({ cadence: 'custom' }))).toEqual({ kind: 'none' });
  });

  it('ignores out-of-range or non-integer weekday numbers', () => {
    expect(resolveSchedule(routine({ cadence: 'weekly', daysOfWeek: [1, 9, -2, 2.5] }))).toEqual({
      kind: 'days_of_week',
      days: [1],
    });
  });
});

describe('nextDueDate — daily', () => {
  const daily = routine();

  it('is due today when it has never been done', () => {
    expect(nextDueDate(daily, null, MONDAY)).toBe(MONDAY);
  });

  it('is due tomorrow once today is done', () => {
    expect(nextDueDate(daily, MONDAY, MONDAY)).toBe('2026-10-27');
  });

  it('never returns a date in the past', () => {
    expect(nextDueDate(daily, '2026-10-01', MONDAY)).toBe(MONDAY);
  });
});

describe('nextDueDate — weekly', () => {
  const weekly = routine({ cadence: 'weekly', daysOfWeek: [1, 4] }); // Mon + Thu

  it('is due today when today is one of the chosen days and it is not done', () => {
    expect(nextDueDate(weekly, null, MONDAY)).toBe(MONDAY);
  });

  it('moves to the next chosen day once today is done', () => {
    expect(nextDueDate(weekly, MONDAY, MONDAY)).toBe('2026-10-29'); // Thursday
  });

  it('skips to the next chosen day when today is not one of them', () => {
    expect(nextDueDate(weekly, null, '2026-10-27')).toBe('2026-10-29');
  });

  it('wraps into the following week from a Friday', () => {
    expect(nextDueDate(weekly, null, '2026-10-30')).toBe('2026-11-02'); // next Monday
  });

  it('falls back to a seven-day interval when no days were chosen', () => {
    const bare = routine({ cadence: 'weekly' });
    expect(nextDueDate(bare, null, MONDAY)).toBe(MONDAY);
    expect(nextDueDate(bare, MONDAY, MONDAY)).toBe('2026-11-02');
  });
});

describe('nextDueDate — custom everyNDays', () => {
  const every3 = routine({ cadence: 'custom', everyNDays: 3 });

  it('is due immediately when it has never been done', () => {
    expect(nextDueDate(every3, null, MONDAY)).toBe(MONDAY);
  });

  it('is three days after the last completion', () => {
    expect(nextDueDate(every3, MONDAY, MONDAY)).toBe('2026-10-29');
  });

  it('clamps to today once the interval has elapsed', () => {
    expect(nextDueDate(every3, '2026-10-01', MONDAY)).toBe(MONDAY);
  });

  it('returns null when a custom cadence has no interval and no days', () => {
    expect(nextDueDate(routine({ cadence: 'custom' }), MONDAY, MONDAY)).toBeNull();
  });

  it('uses the chosen weekdays when a custom cadence has days but no interval', () => {
    const custom = routine({ cadence: 'custom', daysOfWeek: [3] }); // Wednesday
    expect(nextDueDate(custom, null, MONDAY)).toBe('2026-10-28');
  });

  it('floors a fractional interval rather than inventing a fractional day', () => {
    expect(nextDueDate(routine({ cadence: 'custom', everyNDays: 2.9 }), MONDAY, MONDAY)).toBe(
      '2026-10-28',
    );
  });
});

/* ------------------------------------------------------------- dueTasks */

describe('dueTasks — everyNDays boundaries', () => {
  const custom = routine({ cadence: 'custom', everyNDays: 3 });
  const tasks = [task('t1')];

  const viewFor = (lastDone: string | null, today = MONDAY) =>
    dueTasks([custom], tasks, lastDone ? [checkin(lastDone, ['t1'])] : [], today)[0]!;

  it('is due immediately when never done', () => {
    const view = viewFor(null);
    expect(view.status).toBe('due');
    expect(view.due).toBe(true);
    expect(view.lastCompletedOn).toBeNull();
    expect(view.daysSinceLastCompleted).toBeNull();
    expect(view.outstandingTaskIds).toEqual(['t1']);
  });

  it('is not due at daysSinceLast = everyNDays - 1', () => {
    const view = viewFor(addDays(MONDAY, -2));
    expect(view.daysSinceLastCompleted).toBe(2);
    expect(view.status).toBe('not_scheduled_today');
    expect(view.due).toBe(false);
    expect(view.nextDueOn).toBe('2026-10-27');
  });

  it('is due exactly at daysSinceLast = everyNDays', () => {
    const view = viewFor(addDays(MONDAY, -3));
    expect(view.daysSinceLastCompleted).toBe(3);
    expect(view.status).toBe('due');
    expect(view.due).toBe(true);
    expect(view.daysPastInterval).toBe(0);
  });

  it('reports whole days past the interval beyond the boundary', () => {
    const view = viewFor(addDays(MONDAY, -5));
    expect(view.status).toBe('due');
    expect(view.daysPastInterval).toBe(2);
    expect(view.detail).toContain('2 days past the interval you set');
  });

  it('counts as done for the day once the single task is ticked', () => {
    const view = viewFor(MONDAY);
    expect(view.status).toBe('done_today');
    expect(view.due).toBe(false);
    expect(view.nextDueOn).toBe('2026-10-29');
  });
});

describe('dueTasks — a ticked routine stays on today list so a tick can be undone', () => {
  const tasks = [task('t1'), task('t2', 1)];

  it('keeps a single-task routine listed from its very first tick', () => {
    const view = dueTasks([routine()], [task('t1')], [checkin(MONDAY, ['t1'])], MONDAY)[0]!;
    expect(view.status).toBe('done_today');
    expect(view.due).toBe(false); // nothing left to tick
    expect(view.onTodayList).toBe(true); // but the checkboxes must stay reachable
    expect(view.tasks.map((t) => t.doneToday)).toEqual([true]);
  });

  it('keeps a fully ticked multi-task routine listed', () => {
    const view = dueTasks([routine()], tasks, [checkin(MONDAY, ['t1', 't2'])], MONDAY)[0]!;
    expect(view.status).toBe('done_today');
    expect(view.onTodayList).toBe(true);
  });

  it('keeps a routine listed when it was ticked today but is not scheduled today', () => {
    // Ticked by hand on a day the cadence does not fall on: still undoable.
    const view = dueTasks(
      [routine({ cadence: 'weekly', daysOfWeek: [4] })],
      [task('t1')],
      [checkin(MONDAY, ['t1'])],
      MONDAY,
    )[0]!;
    expect(view.status).toBe('done_today');
    expect(view.onTodayList).toBe(true);
  });

  it('still lists a routine with something left to tick', () => {
    const partly = dueTasks([routine()], tasks, [checkin(MONDAY, ['t1'])], MONDAY)[0]!;
    expect(partly.onTodayList).toBe(true);
    const untouched = dueTasks([routine()], tasks, [], MONDAY)[0]!;
    expect(untouched.onTodayList).toBe(true);
  });

  it('leaves off a routine that is neither due nor touched today', () => {
    const notToday = dueTasks(
      [routine({ cadence: 'weekly', daysOfWeek: [4] })],
      [task('t1')],
      [],
      MONDAY,
    )[0]!;
    expect(notToday.status).toBe('not_scheduled_today');
    expect(notToday.onTodayList).toBe(false);

    const snoozed = dueTasks(
      [routine()],
      [task('t1')],
      [checkin(MONDAY, [], { snoozedUntil: addDays(MONDAY, 2) })],
      MONDAY,
    )[0]!;
    expect(snoozed.status).toBe('snoozed');
    expect(snoozed.onTodayList).toBe(false);

    const noTasks = dueTasks([routine()], [], [], MONDAY)[0]!;
    expect(noTasks.onTodayList).toBe(false);
  });

  it('drops back off the list once yesterday\'s ticks are no longer today\'s', () => {
    const view = dueTasks(
      [routine({ cadence: 'weekly', daysOfWeek: [4] })],
      [task('t1')],
      [checkin(MONDAY, ['t1'])],
      addDays(MONDAY, 1),
    )[0]!;
    expect(view.onTodayList).toBe(false);
  });
});

/**
 * The header above the tick list and the list itself must describe the same thing.
 * `due` goes false on a routine's final tick while `onTodayList` stays true, so a
 * header counting `due` rows read "0 routines scheduled for <date>" with the ticked
 * cards still on screen. These assert the counts at the level the wording is built
 * from, which is the level the page now reads.
 */
describe('todayListCounts', () => {
  const twoTasks = [task('t1'), task('t2', 1)];

  it('keeps a fully ticked routine in the count, rather than reporting an empty day', () => {
    const views = dueTasks([routine()], twoTasks, [checkin(MONDAY, ['t1', 't2'])], MONDAY);
    expect(views[0]!.due).toBe(false); // nothing outstanding …
    expect(views[0]!.onTodayList).toBe(true); // … but the card is on screen

    const counts = todayListCounts(views, MONDAY);
    expect(counts.onList).toBe(1);
    expect(counts.stillToTick).toBe(0);
    expect(counts.tasksStillToTick).toBe(0);
    expect(counts.tasksTicked).toBe(2);
    expect(counts.note).toBe('1 routine on the list for 2026-10-26, nothing left to tick.');
    // The regression this replaces: a count of `due` rows only.
    expect(counts.note).not.toMatch(/\b0 routines?\b/);
    expect(counts.note).not.toBe('Nothing on the list for 2026-10-26.');
  });

  it('states what is outstanding and what is already ticked on a part-ticked list', () => {
    const views = dueTasks(
      [routine(), routine({ id: 'r2', name: 'Evening routine' })],
      [task('t1'), task('t2', 1), task('t3', 0, 'r2')],
      [checkin(MONDAY, ['t3'], { routineId: 'r2' })],
      MONDAY,
    );
    const counts = todayListCounts(views, MONDAY);
    expect(counts.onList).toBe(2);
    expect(counts.stillToTick).toBe(1);
    expect(counts.tasksStillToTick).toBe(2);
    expect(counts.tasksTicked).toBe(1);
    expect(counts.note).toBe(
      '1 of 2 routines on the list for 2026-10-26 still to tick, 1 task already ticked.',
    );
  });

  it('counts a routine with some of its own tasks ticked as still to tick', () => {
    const views = dueTasks([routine()], twoTasks, [checkin(MONDAY, ['t1'])], MONDAY);
    const counts = todayListCounts(views, MONDAY);
    expect(counts.stillToTick).toBe(1);
    expect(counts.tasksStillToTick).toBe(1);
    expect(counts.note).toBe(
      '1 routine on the list for 2026-10-26 to tick, 1 task already ticked.',
    );
  });

  it('says nothing has been ticked yet without inventing a tally', () => {
    const counts = todayListCounts(dueTasks([routine()], twoTasks, [], MONDAY), MONDAY);
    expect(counts.tasksTicked).toBe(0);
    expect(counts.note).toBe('1 routine on the list for 2026-10-26 to tick.');
  });

  it('reports a day with nothing on the list as exactly that', () => {
    const views = dueTasks(
      [routine({ cadence: 'weekly', daysOfWeek: [4] })], // TODAY is a Monday
      [task('t1')],
      [],
      MONDAY,
    );
    const counts = todayListCounts(views, MONDAY);
    expect(counts.onList).toBe(0);
    expect(counts.stillToTick).toBe(0);
    expect(counts.tasksStillToTick).toBe(0);
    expect(counts.tasksTicked).toBe(0);
    expect(counts.note).toBe('Nothing on the list for 2026-10-26.');
    expect(todayListCounts([], MONDAY).note).toBe('Nothing on the list for 2026-10-26.');
  });

  it('leaves the outstanding figure exactly as the dashboard computes it', () => {
    const views = dueTasks(
      [routine(), routine({ id: 'r2', name: 'B' }), routine({ id: 'r3', name: 'C' })],
      [task('t1'), task('t2', 1), task('t3', 0, 'r2'), task('t4', 0, 'r3')],
      [checkin(MONDAY, ['t3'], { routineId: 'r2' }), checkin(MONDAY, ['t1'])],
      MONDAY,
    );
    // `tasksStillToTick` is the same honest count the "to tick today" figure has
    // always been: ticking something off the list must not inflate it.
    expect(todayListCounts(views, MONDAY).tasksStillToTick).toBe(
      dueTaskCount(views.filter((v) => v.due)),
    );
  });

  it('turns the header green only when a list existed and is finished', () => {
    // A constant tone passed every test in this module before this existed, so an empty
    // day could be painted green again without anything failing.
    expect(todayListCounts(dueTasks([routine()], twoTasks, [], MONDAY), MONDAY).tone).toBe('warn');
    expect(
      todayListCounts(dueTasks([routine()], twoTasks, [checkin(MONDAY, ['t1'])], MONDAY), MONDAY)
        .tone,
    ).toBe('warn');
    expect(
      todayListCounts(
        dueTasks([routine()], twoTasks, [checkin(MONDAY, ['t1', 't2'])], MONDAY),
        MONDAY,
      ).tone,
    ).toBe('ok');

    // The case that matters: nothing was asked of the user today, so nothing is
    // congratulated. Not 'ok'.
    expect(todayListCounts([], MONDAY).tone).toBe('neutral');
    const notToday = dueTasks(
      [routine({ cadence: 'weekly', daysOfWeek: [4] })],
      [task('t1')],
      [],
      MONDAY,
    );
    expect(todayListCounts(notToday, MONDAY).tone).toBe('neutral');
  });

  it('never reports a proportion, a streak or a score', () => {
    const counts = todayListCounts(
      dueTasks([routine()], twoTasks, [checkin(MONDAY, ['t1'])], MONDAY),
      MONDAY,
    );
    // An exact shape, so a new derived figure has to be added here deliberately rather
    // than appearing unnoticed. `tone` is a presentation choice over these same counts,
    // not a new measurement — see the tone test above for what it is allowed to say.
    expect(Object.keys(counts).sort()).toEqual([
      'note',
      'onList',
      'stillToTick',
      'tasksStillToTick',
      'tasksTicked',
      'tone',
    ]);
    expect(counts.note).not.toMatch(
      /%|percent|streak|score|grade|complete|completion|perfect|well done|keep it up/i,
    );
    // "N of M still to tick" is an outstanding count, which is the point of the header.
    // What it must never become is a completion fraction read the other way round.
    expect(counts.note).not.toMatch(/\b\d+ of \d+ (routines?|tasks?) (done|complete|ticked)\b/i);
  });

  it('refuses a today that is not a real date rather than printing it', () => {
    expect(() => todayListCounts([], '2026-02-30')).toThrow();
    expect(() => todayListCounts([], '26-10-2026')).toThrow();
  });
});

describe('dueTasks — daily and weekly', () => {
  it('treats a daily routine as due every day until it is ticked', () => {
    const view = dueTasks(
      [routine()],
      [task('t1'), task('t2', 1)],
      [checkin(addDays(MONDAY, -1), ['t1', 't2'])],
      MONDAY,
    )[0]!;
    expect(view.status).toBe('due');
    expect(view.outstandingTaskIds).toEqual(['t1', 't2']);
    expect(view.daysSinceLastCompleted).toBe(1);
  });

  it('reports a partially ticked day without judging it', () => {
    const view = dueTasks([routine()], [task('t1'), task('t2', 1)], [checkin(MONDAY, ['t1'])], MONDAY)[0]!;
    expect(view.status).toBe('partly_done_today');
    expect(view.due).toBe(true);
    expect(view.completedTodayTaskIds).toEqual(['t1']);
    expect(view.outstandingTaskIds).toEqual(['t2']);
    expect(view.detail).toContain('1 of 2 still to tick today');
  });

  it('leaves a weekly routine off the list on a day it does not fall on', () => {
    const weekly = routine({ cadence: 'weekly', daysOfWeek: [4] }); // Thursday only
    const view = dueTasks([weekly], [task('t1')], [], MONDAY)[0]!;
    expect(view.status).toBe('not_scheduled_today');
    expect(view.nextDueOn).toBe('2026-10-29');
  });

  it('requires every task to be ticked before a day counts as a completion', () => {
    const view = dueTasks(
      [routine({ cadence: 'custom', everyNDays: 2 })],
      [task('t1'), task('t2', 1)],
      [checkin(addDays(MONDAY, -1), ['t1'])], // only one of two
      MONDAY,
    )[0]!;
    expect(view.lastCompletedOn).toBeNull();
    expect(view.status).toBe('due');
  });

  it('respects a snooze, and returns to the list afterwards', () => {
    const snoozed = dueTasks(
      [routine()],
      [task('t1')],
      [checkin(MONDAY, [], { snoozedUntil: addDays(MONDAY, 2) })],
      MONDAY,
    )[0]!;
    expect(snoozed.status).toBe('snoozed');
    expect(snoozed.due).toBe(false);

    const after = dueTasks(
      [routine()],
      [task('t1')],
      [checkin(MONDAY, [], { snoozedUntil: addDays(MONDAY, 2) })],
      addDays(MONDAY, 3),
    )[0]!;
    expect(after.status).toBe('due');
  });

  it('says a routine has no tasks rather than claiming it is complete', () => {
    const view = dueTasks([routine()], [], [], MONDAY)[0]!;
    expect(view.status).toBe('no_tasks_yet');
    expect(view.due).toBe(false);
    expect(view.lastCompletedOn).toBeNull();
  });

  it('says so when a custom cadence has nothing to schedule from', () => {
    const view = dueTasks([routine({ cadence: 'custom' })], [task('t1')], [], MONDAY)[0]!;
    expect(view.status).toBe('no_cadence_set');
    expect(view.nextDueOn).toBeNull();
  });

  it('skips inactive routines and ignores future-dated check-ins', () => {
    expect(dueTasks([routine({ active: false })], [task('t1')], [], MONDAY)).toEqual([]);
    const view = dueTasks(
      [routine({ cadence: 'custom', everyNDays: 5 })],
      [task('t1')],
      [checkin(addDays(MONDAY, 3), ['t1'])],
      MONDAY,
    )[0]!;
    expect(view.lastCompletedOn).toBeNull();
  });

  it('counts outstanding tasks across routines', () => {
    const views = dueTasks(
      [routine(), routine({ id: 'r2', name: 'Evening routine' })],
      [task('t1'), task('t2', 1), task('t3', 0, 'r2')],
      [],
      MONDAY,
    );
    expect(dueTaskCount(views)).toBe(3);
  });

  it('is a pure function of its arguments', () => {
    const routines = [routine()];
    const tasks = [task('t1')];
    const checkins = [checkin(addDays(MONDAY, -1), ['t1'])];
    const a = dueTasks(routines, tasks, checkins, MONDAY);
    const b = dueTasks(routines, tasks, checkins, MONDAY);
    expect(a).toEqual(b);
    expect(checkins[0]!.completedTaskIds).toEqual(['t1']); // inputs untouched
  });
});

describe('upcomingSchedule', () => {
  it('lists the next scheduled date per routine, excluding today', () => {
    const views = dueTasks(
      [routine({ cadence: 'weekly', daysOfWeek: [4] }), routine({ id: 'r2', name: 'B', cadence: 'custom', everyNDays: 2 })],
      [task('t1'), task('t2', 0, 'r2')],
      [checkin(MONDAY, ['t2'], { routineId: 'r2' })],
      MONDAY,
    );
    const upcoming = upcomingSchedule(views, MONDAY, 7);
    expect(upcoming.map((u) => u.date)).toEqual(['2026-10-28', '2026-10-29']);
  });

  it('leaves out routines with no tasks and unschedulable ones', () => {
    const views = dueTasks([routine(), routine({ id: 'r2', name: 'B', cadence: 'custom' })], [task('t2', 0, 'r2')], [], MONDAY);
    expect(upcomingSchedule(views, MONDAY, 7)).toEqual([]);
  });

  it('does not advertise a date the user has set the routine aside for', () => {
    // Thursday routine, set aside until the Friday after it: that Thursday is a date
    // the user has already decided about, so "Coming up" must not list it.
    const views = dueTasks(
      [routine({ cadence: 'weekly', daysOfWeek: [4] })],
      [task('t1')],
      [checkin(MONDAY, [], { snoozedUntil: '2026-10-30' })],
      MONDAY,
    );
    expect(views[0]!.status).toBe('snoozed');
    expect(views[0]!.nextDueOn).toBe('2026-10-29');
    expect(views[0]!.snoozedUntil).toBe('2026-10-30');
    expect(upcomingSchedule(views, MONDAY, 7)).toEqual([]);
  });

  it('advertises the first date after the snooze expires', () => {
    // Set aside only until the Wednesday: the Thursday is beyond it and stands.
    const views = dueTasks(
      [routine({ cadence: 'weekly', daysOfWeek: [4] })],
      [task('t1')],
      [checkin(MONDAY, [], { snoozedUntil: '2026-10-28' })],
      MONDAY,
    );
    expect(upcomingSchedule(views, MONDAY, 7).map((u) => u.date)).toEqual(['2026-10-29']);
  });

  it('still lists an un-snoozed routine scheduled for the same day', () => {
    const views = dueTasks(
      [
        routine({ cadence: 'weekly', daysOfWeek: [4] }),
        routine({ id: 'r2', name: 'B', cadence: 'weekly', daysOfWeek: [4] }),
      ],
      [task('t1'), task('t2', 0, 'r2')],
      [checkin(MONDAY, [], { snoozedUntil: '2026-10-30' })], // r1 only
      MONDAY,
    );
    expect(upcomingSchedule(views, MONDAY, 7).map((u) => u.routineId)).toEqual(['r2']);
  });
});

/* -------------------------------------------------------------- supplies */

describe('supplyRunway', () => {
  it('computes days left from the user\'s own interval', () => {
    const view = supplyRunway(
      supply({ lastReplacedAt: addDays(MONDAY, -10), replaceEveryDays: 30 }),
      MONDAY,
    );
    expect(view.basis).toBe('typical_usage');
    expect(view.daysLeft).toBe(20);
    expect(view.dueOn).toBe(addDays(MONDAY, 20));
    expect(view.restock).toBe(false);
    expect(view.restockReason).toBe('none');
  });

  it('flags a restock inside the head-room window', () => {
    const view = supplyRunway(
      supply({ lastReplacedAt: addDays(MONDAY, -(30 - RESTOCK_SOON_DAYS)), replaceEveryDays: 30 }),
      MONDAY,
    );
    expect(view.daysLeft).toBe(RESTOCK_SOON_DAYS);
    expect(view.restock).toBe(true);
    expect(view.restockReason).toBe('due_soon');
  });

  it('does not flag one day outside the head-room window', () => {
    const view = supplyRunway(
      supply({ lastReplacedAt: addDays(MONDAY, -(30 - RESTOCK_SOON_DAYS - 1)), replaceEveryDays: 30 }),
      MONDAY,
    );
    expect(view.daysLeft).toBe(RESTOCK_SOON_DAYS + 1);
    expect(view.restock).toBe(false);
  });

  it('states the due date plainly on the day it falls, rather than "about 0 days left"', () => {
    const view = supplyRunway(
      supply({ lastReplacedAt: addDays(MONDAY, -30), replaceEveryDays: 30 }),
      MONDAY,
    );
    expect(view.daysLeft).toBe(0);
    expect(view.dueOn).toBe(MONDAY);
    expect(view.restock).toBe(true);
    expect(view.restockReason).toBe('due_soon');
    expect(view.note).toBe('Due today, on the 30-day interval you set.');
    expect(view.note).not.toContain('0 days left');
  });

  it('reports a negative runway as past due rather than clamping it to zero', () => {
    const view = supplyRunway(
      supply({ lastReplacedAt: addDays(MONDAY, -40), replaceEveryDays: 30 }),
      MONDAY,
    );
    expect(view.daysLeft).toBe(-10);
    expect(view.restockReason).toBe('past_due');
    expect(view.note).toContain('10 days ago');
  });

  it('returns unknown — never zero — when the interval is missing', () => {
    const view = supplyRunway(supply({ lastReplacedAt: addDays(MONDAY, -10) }), MONDAY);
    expect(view.basis).toBe('unknown');
    expect(view.daysLeft).toBeNull();
    expect(view.dueOn).toBeNull();
    expect(view.restock).toBe(false);
    expect(view.note).toContain('cannot work out');
  });

  it('returns unknown when the replacement date is missing', () => {
    const view = supplyRunway(supply({ replaceEveryDays: 30 }), MONDAY);
    expect(view.basis).toBe('unknown');
    expect(view.daysLeft).toBeNull();
    expect(view.note).toContain('the date you last replaced it');
  });

  it('honours the user\'s own running-low flag even with no interval', () => {
    const view = supplyRunway(supply({ runningLow: true }), MONDAY);
    expect(view.restock).toBe(true);
    expect(view.restockReason).toBe('user_marked');
    expect(view.runningLow).toBe(true);
    expect(view.daysLeft).toBeNull();
  });

  it('ignores a nonsense interval instead of computing from it', () => {
    const view = supplyRunway(
      supply({ lastReplacedAt: MONDAY, replaceEveryDays: 0 }),
      MONDAY,
    );
    expect(view.basis).toBe('unknown');
  });

  it('sorts restock items first, then by the soonest due date', () => {
    const views = supplyRunways(
      [
        supply({ id: 'a', name: 'A', lastReplacedAt: MONDAY, replaceEveryDays: 60 }),
        supply({ id: 'b', name: 'B', runningLow: true }),
        supply({ id: 'c', name: 'C', lastReplacedAt: addDays(MONDAY, -59), replaceEveryDays: 60 }),
      ],
      MONDAY,
    );
    expect(views.map((v) => v.supplyId)).toEqual(['c', 'b', 'a']);
  });
});

/* --------------------------------------------------------------- summary */

describe('routineSummary', () => {
  const checkins = [
    checkin(MONDAY, ['t1', 't2']),
    checkin(addDays(MONDAY, -1), ['t1']),
    checkin(addDays(MONDAY, -20), ['t1']), // outside a 14-day window
    checkin(addDays(MONDAY, -2), [], { routineId: 'r2' }), // nothing ticked
  ];

  it('counts ticks and days inside the window only', () => {
    const summary = routineSummary(checkins, 14, MONDAY);
    expect(summary.windowDays).toBe(14);
    expect(summary.windowStart).toBe(addDays(MONDAY, -13));
    expect(summary.windowEnd).toBe(MONDAY);
    expect(summary.taskTicks).toBe(3);
    expect(summary.daysWithAnyCheckin).toBe(2);
    expect(summary.routinesTouched).toBe(1);
  });

  it('reports per-routine counts and the last date recorded', () => {
    const row = routineSummary(checkins, 14, MONDAY).perRoutine[0]!;
    expect(row.routineId).toBe('r1');
    expect(row.taskTicks).toBe(3);
    expect(row.daysRecorded).toBe(2);
    expect(row.lastRecordedOn).toBe(MONDAY);
  });

  it('states plainly, and forward-looking, when nothing was recorded', () => {
    const summary = routineSummary([], 14, MONDAY);
    expect(summary.taskTicks).toBe(0);
    expect(summary.perRoutine).toEqual([]);
    expect(summary.note).toBe(
      'Nothing recorded in the last 14 days. Ticking a single task today starts the record off again.',
    );
  });

  it('is deterministic for the same inputs', () => {
    expect(routineSummary(checkins, 7, MONDAY)).toEqual(routineSummary(checkins, 7, MONDAY));
  });
});

/* ----------------------------------------------------------------- SAFETY */

/**
 * The engine must not produce a cleanliness score, a grade, a rating, a rank or a
 * streak, and must not produce copy that shames the person. These two tests walk
 * every value the engine returns for a deliberately bad-looking history — a routine
 * not done for weeks, a supply long overdue, an empty window — and fail if either
 * rule is broken.
 */
const SCORE_LIKE_KEY = /score|grade|rating|rank|streak|consistency|percent|attractive|beauty|physique|bodyfat|body_fat/i;

const SHAMING_WORDS = [
  'dirty',
  'filthy',
  'gross',
  'smelly',
  'unhygienic',
  'disgusting',
  'shame',
  'ashamed',
  'lazy',
  'slob',
  'guilt',
  'fail',
  'neglect',
  'excuse',
  'discipline',
  'streak',
  'score',
  'grade',
  'rating',
  'rank',
  'attractive',
  'beauty',
  'ugly',
  'flaw',
  'body fat',
  'physique',
  'looksmax',
  'slacking',
  'slipped',
  'embarrass',
  'unacceptable',
  'do better',
  'let yourself',
  'you should have',
  'bad habit',
  'broke your',
];

function collect(value: unknown, keys: string[], strings: string[]): void {
  if (typeof value === 'string') {
    strings.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, keys, strings);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collect(child, keys, strings);
    }
  }
}

function everyEngineOutput(): { keys: string[]; strings: string[] } {
  const routines: RoutineInput[] = [
    routine(),
    routine({ id: 'r2', name: 'Weekly reset', cadence: 'weekly', daysOfWeek: [1, 4] }),
    routine({ id: 'r3', name: 'Bedding', cadence: 'custom', everyNDays: 14 }),
    routine({ id: 'r4', name: 'Unscheduled', cadence: 'custom' }),
    routine({ id: 'r5', name: 'No tasks' }),
  ];
  const tasks: TaskInput[] = [
    task('t1'),
    task('t2', 1),
    task('t3', 0, 'r2'),
    task('t4', 0, 'r3'),
    task('t5', 0, 'r4'),
  ];
  const checkins: CheckinInput[] = [
    checkin(addDays(MONDAY, -40), ['t1', 't2']),
    checkin(addDays(MONDAY, -40), ['t4'], { routineId: 'r3' }),
    checkin(MONDAY, ['t1']),
    checkin(MONDAY, [], { routineId: 'r2', snoozedUntil: addDays(MONDAY, 5) }),
  ];
  const views = dueTasks(routines, tasks, checkins, MONDAY);
  const supplies = supplyRunways(
    [
      supply({ id: 'a', name: 'Soap', lastReplacedAt: addDays(MONDAY, -400), replaceEveryDays: 30 }),
      supply({ id: 'b', name: 'Razor', runningLow: true }),
      supply({ id: 'c', name: 'Shampoo' }),
      supply({ id: 'd', name: 'Floss', lastReplacedAt: MONDAY, replaceEveryDays: 1 }),
      // Lands exactly on today: daysLeft === 0. Without this fixture the "never says
      // 0 days left" guard below passes whatever the engine's wording is.
      supply({ id: 'e', name: 'Soap refill', lastReplacedAt: addDays(MONDAY, -30), replaceEveryDays: 30 }),
    ],
    MONDAY,
  );
  const outputs: unknown[] = [
    views,
    supplies,
    upcomingSchedule(views, MONDAY, 7),
    todayListCounts(views, MONDAY),
    todayListCounts([], MONDAY),
    // A finished list too, so every wording this function can produce is swept.
    todayListCounts(dueTasks([routine()], [task('t1')], [checkin(MONDAY, ['t1'])], MONDAY), MONDAY),
    routineSummary(checkins, 14, MONDAY),
    routineSummary([], 30, MONDAY),
    routineSummary(checkins, 365, MONDAY),
  ];
  const keys: string[] = [];
  const strings: string[] = [];
  collect(outputs, keys, strings);
  return { keys, strings };
}

describe('SAFETY — the hygiene engine never scores or shames a person', () => {
  it('exposes no output field that is a score, grade, rating, rank or streak', () => {
    const { keys } = everyEngineOutput();
    expect(keys.length).toBeGreaterThan(50);
    const offenders = keys.filter((key) => SCORE_LIKE_KEY.test(key));
    expect(offenders, `score-like output keys: ${offenders.join(', ')}`).toEqual([]);
  });

  it('produces no copy containing shaming vocabulary', () => {
    const { strings } = everyEngineOutput();
    expect(strings.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const text of strings) {
      const lower = text.toLowerCase();
      for (const word of SHAMING_WORDS) {
        if (lower.includes(word)) offenders.push(`"${text}" contains "${word}"`);
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });

  it('describes a long-missed routine as a fact and a next date, nothing more', () => {
    const view = dueTasks(
      [routine({ cadence: 'custom', everyNDays: 7 })],
      [task('t1')],
      [checkin(addDays(MONDAY, -60), ['t1'])],
      MONDAY,
    )[0]!;
    expect(view.detail).toBe(
      'Due today, 53 days past the interval you set. Last recorded in full on 2026-08-27.',
    );
  });

  it('never reports an unknown supply runway as a number', () => {
    const { strings } = everyEngineOutput();
    expect(strings.some((s) => s.includes('0 days left'))).toBe(false);
    // The guard above is only worth anything if the fixtures reach daysLeft === 0,
    // which is the one case that could produce that wording. This proves they do.
    expect(strings).toContain('Due today, on the 30-day interval you set.');
    expect(supplyRunway(supply(), MONDAY).daysLeft).toBeNull();
  });
});

/* ------------------------------------------------- the page that renders it */

/**
 * `app/(app)/hygiene/page.tsx` is an async server component — it needs a session and
 * a database before it renders a node — so what it feeds the header is pinned from
 * the source instead. The header used to count `dashboard.dueNow` while the cards
 * beneath it came from `dashboard.todayList`: once every routine was ticked it read
 * "0 routines scheduled for <date>" above a screen full of ticked cards. These are
 * literal source checks, so the page keeps saying what the list below it shows.
 */
describe('the hygiene page header is built from the list it sits above', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app', '(app)', 'hygiene', 'page.tsx'),
    'utf8',
  );

  it('derives the header from todayListCounts over the views the list renders', () => {
    expect(source).toContain('todayListCounts(dashboard.due, dashboard.today)');
    expect(source).toContain('value={todayCounts.tasksStillToTick}');
    expect(source).toContain('hint={todayCounts.note}');
  });

  it('counts nothing the list below it leaves out', () => {
    // `dueNow` drops the routines already ticked today, which are exactly the rows
    // that made the old hint contradict the cards.
    expect(source).not.toContain('dueNow');
  });
});
