/**
 * Personal Hygiene OS — pure scheduling engine.
 *
 * No I/O, no database, no service imports. Every function takes `today` (an ISO
 * `YYYY-MM-DD` date in UTC) as a parameter so the same inputs always produce the
 * same output and the tests never depend on the wall clock.
 *
 * COPY AND OUTPUT RULE — this engine never produces a cleanliness score, a grade,
 * a rating, a rank, a percentage "completion" figure or a streak, and it never
 * produces copy that judges the person. Only counts, dates and intervals leave this
 * file. When a routine was not done, the wording states the fact and the next date
 * and stops there: no guilt, no "you broke your streak", no comment on the person.
 * This rule is enforced by tests/unit/hygiene.test.ts, which fails if an output key
 * looks like a score or an output string contains shaming vocabulary.
 *
 * Day-of-week numbers follow the rest of GymOS: 0 = Sunday … 6 = Saturday, in UTC.
 */

export type HygieneCadence = 'daily' | 'weekly' | 'custom';

/** How often something recurs. In the schema this lives on the routine, not the task. */
export interface CadenceSpec {
  cadence: HygieneCadence;
  /** 0 = Sunday … 6 = Saturday. Empty means "no specific days chosen". */
  daysOfWeek: number[];
  everyNDays: number | null;
}

export interface RoutineInput extends CadenceSpec {
  id: string;
  name: string;
  category: string;
  active: boolean;
}

export interface TaskInput {
  id: string;
  routineId: string;
  orderIndex: number;
  label: string;
}

export interface CheckinInput {
  routineId: string;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  completedTaskIds: string[];
  /** ISO `YYYY-MM-DD`, or null. A routine is left alone until after this date. */
  snoozedUntil: string | null;
}

/**
 * Why a routine is or is not on today's list. Every value is a fact about the
 * schedule, never an assessment of the person.
 */
export type DueStatus =
  | 'due'
  | 'done_today'
  | 'partly_done_today'
  | 'snoozed'
  | 'not_scheduled_today'
  | 'no_cadence_set'
  | 'no_tasks_yet';

export interface DueTaskView {
  id: string;
  label: string;
  orderIndex: number;
  doneToday: boolean;
}

export interface DueRoutineView {
  routineId: string;
  routineName: string;
  category: string;
  cadence: HygieneCadence;
  status: DueStatus;
  /** True only when there is at least one task still to tick today. */
  due: boolean;
  /**
   * True when this routine belongs on today's list at all: either something is still
   * to tick, or something was already ticked today.
   *
   * `due` goes false the instant the last task is ticked, which is correct for a
   * "what is left" count but wrong for the list itself — a routine that disappears
   * on its final tick takes its checkboxes with it and a mistaken tick can never be
   * undone. This flag keeps the routine on today's list once it has been touched.
   * It records only that today's row exists, not how often it is ticked: there is no
   * run, no total and no streak behind it.
   */
  onTodayList: boolean;
  tasks: DueTaskView[];
  outstandingTaskIds: string[];
  completedTodayTaskIds: string[];
  totalTasks: number;
  lastCompletedOn: string | null;
  daysSinceLastCompleted: number | null;
  nextDueOn: string | null;
  /** Whole days past the interval. 0 for day-of-week schedules and when on time. */
  daysPastInterval: number;
  snoozedUntil: string | null;
  /** Plain statement of the schedule position. Never a judgement. */
  detail: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Days since the Unix epoch, in UTC. Throws on anything that is not `YYYY-MM-DD`. */
export function toDayNumber(iso: string): number {
  if (!ISO_DATE.test(iso)) throw new Error(`Not an ISO date: "${iso}"`);
  const ms = Date.parse(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new Error(`Not a real date: "${iso}"`);
  return Math.round(ms / MS_PER_DAY);
}

export function fromDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** 0 = Sunday … 6 = Saturday, in UTC. */
export function dayOfWeek(iso: string): number {
  // 1970-01-01 was a Thursday, which is 4 in the 0=Sunday convention.
  return (((toDayNumber(iso) + 4) % 7) + 7) % 7;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return toDayNumber(toIso) - toDayNumber(fromIso);
}

export function isValidDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const ms = Date.parse(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === iso;
}

/* ------------------------------------------------------------------ cadence */

type Schedule =
  | { kind: 'interval'; everyNDays: number }
  | { kind: 'days_of_week'; days: number[] }
  | { kind: 'none' };

/**
 * Resolves a cadence into one of two schedule shapes, or `none` when the user has
 * not supplied enough to schedule anything. `none` is reported honestly rather than
 * silently defaulting to daily.
 */
export function resolveSchedule(spec: CadenceSpec): Schedule {
  const days = normaliseDays(spec.daysOfWeek);
  switch (spec.cadence) {
    case 'daily':
      return { kind: 'interval', everyNDays: 1 };
    case 'weekly':
      // Named days win; without them, weekly means "every 7 days from the last time".
      return days.length > 0 ? { kind: 'days_of_week', days } : { kind: 'interval', everyNDays: 7 };
    case 'custom': {
      if (spec.everyNDays != null && Number.isFinite(spec.everyNDays) && spec.everyNDays >= 1) {
        return { kind: 'interval', everyNDays: Math.floor(spec.everyNDays) };
      }
      if (days.length > 0) return { kind: 'days_of_week', days };
      return { kind: 'none' };
    }
    default:
      return { kind: 'none' };
  }
}

function normaliseDays(days: number[] | null | undefined): number[] {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
    (a, b) => a - b,
  );
}

/**
 * The next date on or after `today` on which this cadence wants attention.
 *
 * `task` carries the cadence. In the GymOS schema the cadence lives on the routine
 * row, so callers pass the routine (or a task joined to its routine) — the parameter
 * is named `task` because that is the scheduling unit from the user's point of view.
 *
 * Rules:
 *  - never done before  → due today (an interval cannot have elapsed from nothing),
 *  - interval cadences  → `lastDoneOn + everyNDays`, but never earlier than today,
 *  - day-of-week        → the next listed weekday, starting today if today is listed
 *                         and today is not already done,
 *  - no cadence set     → null, and the caller says so instead of inventing a date.
 */
export function nextDueDate(
  task: CadenceSpec,
  lastDoneOn: string | null,
  today: string,
): string | null {
  const schedule = resolveSchedule(task);
  if (schedule.kind === 'none') return null;
  const todayNum = toDayNumber(today);

  if (schedule.kind === 'interval') {
    if (lastDoneOn == null) return today;
    const target = toDayNumber(lastDoneOn) + schedule.everyNDays;
    return fromDayNumber(Math.max(target, todayNum));
  }

  // Day-of-week: start today unless today is already accounted for.
  const start =
    lastDoneOn != null && toDayNumber(lastDoneOn) >= todayNum
      ? toDayNumber(lastDoneOn) + 1
      : todayNum;
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = start + offset;
    if (schedule.days.includes(dayOfWeek(fromDayNumber(candidate)))) {
      return fromDayNumber(candidate);
    }
  }
  return null;
}

/* ----------------------------------------------------------------- dueTasks */

/**
 * What is due now, per routine, with the individual tasks still to tick.
 *
 * `recentCheckins` may contain any window of history; only rows on or before
 * `today` are considered, and a routine counts as completed on a date when every one
 * of its tasks appears in that date's `completedTaskIds`.
 */
export function dueTasks(
  routines: RoutineInput[],
  tasks: TaskInput[],
  recentCheckins: CheckinInput[],
  today: string,
): DueRoutineView[] {
  const todayNum = toDayNumber(today);
  const tasksByRoutine = new Map<string, TaskInput[]>();
  for (const task of tasks) {
    const list = tasksByRoutine.get(task.routineId);
    if (list) list.push(task);
    else tasksByRoutine.set(task.routineId, [task]);
  }
  for (const list of tasksByRoutine.values()) {
    list.sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  }

  const checkinsByRoutine = new Map<string, CheckinInput[]>();
  for (const checkin of recentCheckins) {
    if (!isValidDate(checkin.date) || toDayNumber(checkin.date) > todayNum) continue;
    const list = checkinsByRoutine.get(checkin.routineId);
    if (list) list.push(checkin);
    else checkinsByRoutine.set(checkin.routineId, [checkin]);
  }

  const views: DueRoutineView[] = [];

  for (const routine of routines) {
    if (!routine.active) continue;
    const routineTasks = tasksByRoutine.get(routine.id) ?? [];
    const history = (checkinsByRoutine.get(routine.id) ?? [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    const todayCheckin = history.find((c) => c.date === today) ?? null;
    const doneToday = new Set(todayCheckin?.completedTaskIds ?? []);

    const lastCompletedOn = lastFullCompletion(history, routineTasks, today);
    const daysSinceLastCompleted =
      lastCompletedOn == null ? null : todayNum - toDayNumber(lastCompletedOn);
    const nextDueOn = nextDueDate(routine, lastCompletedOn, today);
    const schedule = resolveSchedule(routine);
    const daysPastInterval =
      schedule.kind === 'interval' && daysSinceLastCompleted != null
        ? Math.max(0, daysSinceLastCompleted - schedule.everyNDays)
        : 0;

    const taskViews: DueTaskView[] = routineTasks.map((t) => ({
      id: t.id,
      label: t.label,
      orderIndex: t.orderIndex,
      doneToday: doneToday.has(t.id),
    }));
    const outstanding = taskViews.filter((t) => !t.doneToday).map((t) => t.id);
    const completedToday = taskViews.filter((t) => t.doneToday).map((t) => t.id);

    const snoozedUntil = activeSnooze(history, today);
    const scheduledToday = nextDueOn === today;

    const status = resolveStatus({
      hasTasks: routineTasks.length > 0,
      scheduleKind: schedule.kind,
      scheduledToday,
      snoozed: snoozedUntil != null,
      outstanding: outstanding.length,
      completedToday: completedToday.length,
    });

    views.push({
      routineId: routine.id,
      routineName: routine.name,
      category: routine.category,
      cadence: routine.cadence,
      status,
      due: status === 'due' || status === 'partly_done_today',
      onTodayList:
        status === 'due' || status === 'partly_done_today' || completedToday.length > 0,
      tasks: taskViews,
      outstandingTaskIds: outstanding,
      completedTodayTaskIds: completedToday,
      totalTasks: routineTasks.length,
      lastCompletedOn,
      daysSinceLastCompleted,
      nextDueOn,
      daysPastInterval,
      snoozedUntil,
      detail: describe({
        status,
        schedule,
        lastCompletedOn,
        daysSinceLastCompleted,
        nextDueOn,
        daysPastInterval,
        snoozedUntil,
        outstanding: outstanding.length,
        total: routineTasks.length,
      }),
    });
  }

  views.sort(
    (a, b) =>
      Number(b.due) - Number(a.due) ||
      b.daysPastInterval - a.daysPastInterval ||
      a.routineName.localeCompare(b.routineName),
  );
  return views;
}

function resolveStatus(input: {
  hasTasks: boolean;
  scheduleKind: Schedule['kind'];
  scheduledToday: boolean;
  snoozed: boolean;
  outstanding: number;
  completedToday: number;
}): DueStatus {
  if (!input.hasTasks) return 'no_tasks_yet';
  if (input.outstanding === 0) return 'done_today';
  if (input.snoozed) return 'snoozed';
  if (input.scheduleKind === 'none') return 'no_cadence_set';
  if (!input.scheduledToday) return 'not_scheduled_today';
  return input.completedToday > 0 ? 'partly_done_today' : 'due';
}

/** The most recent date on or before `today` on which every task was ticked. */
function lastFullCompletion(
  history: CheckinInput[],
  routineTasks: TaskInput[],
  today: string,
): string | null {
  // A routine with no tasks yet cannot be "completed": there is nothing to tick.
  if (routineTasks.length === 0) return null;
  const todayNum = toDayNumber(today);
  const required = routineTasks.map((t) => t.id);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const checkin = history[i];
    if (!checkin || toDayNumber(checkin.date) > todayNum) continue;
    const done = new Set(checkin.completedTaskIds);
    if (required.every((id) => done.has(id))) return checkin.date;
  }
  return null;
}

function activeSnooze(history: CheckinInput[], today: string): string | null {
  let latest: string | null = null;
  for (const checkin of history) {
    const until = checkin.snoozedUntil;
    if (!until || !isValidDate(until)) continue;
    if (toDayNumber(until) < toDayNumber(today)) continue;
    if (latest == null || until > latest) latest = until;
  }
  return latest;
}

/**
 * Neutral, factual wording for one routine's schedule position.
 *
 * Deliberately contains no judgement of the person, no streak language and no
 * score. "Not recorded since <date>" is as evaluative as this gets.
 */
function describe(input: {
  status: DueStatus;
  schedule: Schedule;
  lastCompletedOn: string | null;
  daysSinceLastCompleted: number | null;
  nextDueOn: string | null;
  daysPastInterval: number;
  snoozedUntil: string | null;
  outstanding: number;
  total: number;
}): string {
  const last =
    input.lastCompletedOn == null
      ? 'Not recorded yet.'
      : `Last recorded in full on ${input.lastCompletedOn}.`;

  switch (input.status) {
    case 'no_tasks_yet':
      return 'No tasks added to this routine yet. Add one and it will appear here.';
    case 'done_today':
      return `All ${input.total} task${input.total === 1 ? '' : 's'} ticked today.`;
    case 'partly_done_today':
      return `${input.outstanding} of ${input.total} still to tick today. ${last}`;
    case 'snoozed':
      return `Set aside until ${input.snoozedUntil}. ${last}`;
    case 'no_cadence_set':
      return 'No repeat interval set, so GymOS is not scheduling this. Pick a cadence to put it on the list.';
    case 'not_scheduled_today':
      return input.nextDueOn
        ? `Next on ${input.nextDueOn} (${DAY_NAMES[dayOfWeek(input.nextDueOn)]}). ${last}`
        : last;
    case 'due':
      if (input.daysPastInterval > 0) {
        return `Due today, ${input.daysPastInterval} day${
          input.daysPastInterval === 1 ? '' : 's'
        } past the interval you set. ${last}`;
      }
      return `Due today. ${last}`;
    default:
      return last;
  }
}

/** Convenience count for a dashboard header. */
export function dueTaskCount(views: DueRoutineView[]): number {
  return views.reduce((total, view) => total + view.outstandingTaskIds.length, 0);
}

/** The counts behind the "to tick today" header. See `todayListCounts`. */
export interface TodayListCounts {
  /** Routines the tick list renders: still to tick, plus already ticked today. */
  onList: number;
  /** Of those, the ones with at least one task still to tick. */
  stillToTick: number;
  /** Tasks still to tick today, across the whole list. */
  tasksStillToTick: number;
  /** Tasks ticked today, across the whole list. */
  tasksTicked: number;
  /** Plain statement of what the list holds. Never a score, grade or streak. */
  note: string;
  /**
   * How the header should read, decided here so it is testable.
   *
   * 'ok' means "there was a list and it is all ticked". A day with nothing on the list
   * is 'neutral', NOT 'ok' — painting an empty day green would be the app congratulating
   * someone for a day it never asked anything of them, which is the same dishonesty as a
   * streak, just quieter.
   */
  tone: 'warn' | 'ok' | 'neutral';
}

/**
 * What today's tick list holds, taken from the very views that list renders.
 *
 * The header and the list underneath it have to be describing the same thing. The
 * list renders every routine with `onTodayList` set — what is still to tick plus
 * what has already been ticked today, so a tick can be undone — while a header
 * counting only `due` rows read "0 routines scheduled for <date>" with those ticked
 * cards still on screen. So this counts `onTodayList`, and reports the outstanding
 * half of it separately instead of folding the two together.
 *
 * Counts and a date, nothing else: no proportion of the list completed, no streak,
 * no score. `tasksStillToTick` stays the honest outstanding figure, and a day with
 * nothing on the list is reported as exactly that rather than as a day finished.
 */
export function todayListCounts(views: DueRoutineView[], today: string): TodayListCounts {
  if (!isValidDate(today)) throw new Error(`Not a real date: "${today}"`);
  const onList = views.filter((v) => v.onTodayList);
  const stillToTick = onList.filter((v) => v.due);
  const tasksStillToTick = dueTaskCount(stillToTick);
  const tasksTicked = onList.reduce((total, v) => total + v.completedTodayTaskIds.length, 0);
  const routines = `routine${onList.length === 1 ? '' : 's'}`;

  // Used only while something is still outstanding; "3 of 3" would be a clumsy way
  // of saying that nothing on the list has been touched yet.
  const outstanding =
    stillToTick.length === onList.length
      ? `${onList.length} ${routines} on the list for ${today} to tick`
      : `${stillToTick.length} of ${onList.length} ${routines} on the list for ${today} still to tick`;

  const note =
    onList.length === 0
      ? `Nothing on the list for ${today}.`
      : stillToTick.length === 0
        ? `${onList.length} ${routines} on the list for ${today}, nothing left to tick.`
        : tasksTicked === 0
          ? `${outstanding}.`
          : `${outstanding}, ${tasksTicked} task${tasksTicked === 1 ? '' : 's'} already ticked.`;

  return {
    onList: onList.length,
    stillToTick: stillToTick.length,
    tasksStillToTick,
    tasksTicked,
    note,
    tone: tasksStillToTick > 0 ? 'warn' : onList.length > 0 ? 'ok' : 'neutral',
  };
}

/* -------------------------------------------------------------- supplies */

export interface SupplyInput {
  id: string;
  name: string;
  category: string;
  /** The user's own "running low" flag. Self-reported, never inferred from a photo. */
  runningLow: boolean;
  lastReplacedAt: string | null;
  /** The user's own typical replacement interval, in days. */
  replaceEveryDays: number | null;
}

export interface SupplyRunwayView {
  supplyId: string;
  name: string;
  category: string;
  /** Echoed back unchanged: the user's own flag, never inferred by GymOS. */
  runningLow: boolean;
  /**
   * Whole days of stock left on the user's own stated interval. Null — not zero —
   * when there is nothing to compute it from.
   */
  daysLeft: number | null;
  /** 'typical_usage' means the user told us the interval; nothing is ever guessed. */
  basis: 'typical_usage' | 'unknown';
  dueOn: string | null;
  restock: boolean;
  restockReason: 'user_marked' | 'past_due' | 'due_soon' | 'none';
  note: string;
}

/** Days of head-room at which a supply joins the restock list. */
export const RESTOCK_SOON_DAYS = 3;

/**
 * Days of stock left for one supply, and whether it should go on the restock list.
 *
 * GymOS stores no quantity or measured usage rate for personal-care supplies, so
 * the runway is computed from exactly two self-reported numbers: when the user last
 * replaced the item and how long it typically lasts them. Without both, the runway
 * is reported as `unknown` with `daysLeft: null` — it is never estimated, and
 * "unknown" is never rendered as zero.
 */
export function supplyRunway(supply: SupplyInput, today: string): SupplyRunwayView {
  const interval =
    supply.replaceEveryDays != null &&
    Number.isFinite(supply.replaceEveryDays) &&
    supply.replaceEveryDays >= 1
      ? Math.floor(supply.replaceEveryDays)
      : null;
  const lastReplaced =
    supply.lastReplacedAt && isValidDate(supply.lastReplacedAt) ? supply.lastReplacedAt : null;

  const base = {
    supplyId: supply.id,
    name: supply.name,
    category: supply.category,
    runningLow: supply.runningLow,
  };

  if (interval == null || lastReplaced == null) {
    const missing =
      interval == null && lastReplaced == null
        ? 'a replacement date and how long it usually lasts'
        : interval == null
          ? 'how long it usually lasts you'
          : 'the date you last replaced it';
    return {
      ...base,
      daysLeft: null,
      basis: 'unknown',
      dueOn: null,
      restock: supply.runningLow,
      restockReason: supply.runningLow ? 'user_marked' : 'none',
      note: supply.runningLow
        ? `You marked this as running low. Add ${missing} and GymOS can work out the next date for you.`
        : `GymOS cannot work out how long this will last: it needs ${missing}. Until then, mark it running low yourself when you notice.`,
    };
  }

  const dueOn = addDays(lastReplaced, interval);
  const daysLeft = daysBetween(today, dueOn);
  const pastDue = daysLeft < 0;
  const dueSoon = daysLeft >= 0 && daysLeft <= RESTOCK_SOON_DAYS;
  const restockReason: SupplyRunwayView['restockReason'] = supply.runningLow
    ? 'user_marked'
    : pastDue
      ? 'past_due'
      : dueSoon
        ? 'due_soon'
        : 'none';

  // Zero days left is the due date itself, not an amount of head-room: saying
  // "about 0 days left" would be both odd and vaguer than the fact. It gets the
  // plain statement instead, and the "About N days left" wording is reserved for
  // the cases where there genuinely is some head-room to describe.
  const note = supply.runningLow
    ? `You marked this as running low. On your own ${interval}-day interval it is due on ${dueOn}.`
    : pastDue
      ? `Due on ${dueOn}, ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago, on the ${interval}-day interval you set.`
      : daysLeft === 0
        ? `Due today, on the ${interval}-day interval you set.`
        : `About ${daysLeft} day${daysLeft === 1 ? '' : 's'} left on the ${interval}-day interval you set (due ${dueOn}).`;

  return {
    ...base,
    daysLeft,
    basis: 'typical_usage',
    dueOn,
    restock: restockReason !== 'none',
    restockReason,
    note,
  };
}

/** Every supply's runway, restock items first, then by the soonest due date. */
export function supplyRunways(supplies: SupplyInput[], today: string): SupplyRunwayView[] {
  return supplies
    .map((s) => supplyRunway(s, today))
    .sort(
      (a, b) =>
        Number(b.restock) - Number(a.restock) ||
        (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    );
}

/* ------------------------------------------------------------- summary */

export interface RoutineSummaryRow {
  routineId: string;
  /** Distinct dates in the window with at least one task ticked. */
  daysRecorded: number;
  /** Total task ticks in the window. A count of actions, not a score. */
  taskTicks: number;
  lastRecordedOn: string | null;
}

export interface RoutineSummaryView {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  /** Distinct dates in the window with at least one tick, across all routines. */
  daysWithAnyCheckin: number;
  taskTicks: number;
  routinesTouched: number;
  perRoutine: RoutineSummaryRow[];
  /** Matter-of-fact and forward-looking. Never a score, grade, streak or judgement. */
  note: string;
}

/**
 * Neutral counts over a trailing window.
 *
 * COPY RULE (restated here because this is the function that produces user-facing
 * wording): this returns counts and dates only. There is deliberately no score, no
 * grade, no percentage, no streak and no "consistency" figure, because a hygiene
 * record is not a performance to be marked. When nothing was recorded, the note says
 * so plainly and points forward; it does not tell the person off, imply they are
 * unclean, or reference a lost streak.
 *
 * `today` is a parameter (rather than read from the clock) so the window is
 * deterministic and testable; it is the inclusive last day of the window.
 */
export function routineSummary(
  checkins: CheckinInput[],
  windowDays: number,
  today: string,
): RoutineSummaryView {
  const span = Math.max(1, Math.floor(windowDays));
  const endNum = toDayNumber(today);
  const startNum = endNum - (span - 1);
  const windowStart = fromDayNumber(startNum);

  const inWindow = checkins.filter((c) => {
    if (!isValidDate(c.date)) return false;
    const num = toDayNumber(c.date);
    return num >= startNum && num <= endNum && c.completedTaskIds.length > 0;
  });

  const dates = new Set<string>();
  const perRoutineMap = new Map<string, RoutineSummaryRow>();
  let taskTicks = 0;

  for (const checkin of inWindow) {
    dates.add(checkin.date);
    taskTicks += checkin.completedTaskIds.length;
    const row = perRoutineMap.get(checkin.routineId) ?? {
      routineId: checkin.routineId,
      daysRecorded: 0,
      taskTicks: 0,
      lastRecordedOn: null,
    };
    row.daysRecorded += 1;
    row.taskTicks += checkin.completedTaskIds.length;
    if (row.lastRecordedOn == null || checkin.date > row.lastRecordedOn) {
      row.lastRecordedOn = checkin.date;
    }
    perRoutineMap.set(checkin.routineId, row);
  }

  const perRoutine = [...perRoutineMap.values()].sort(
    (a, b) => b.taskTicks - a.taskTicks || a.routineId.localeCompare(b.routineId),
  );

  const note =
    inWindow.length === 0
      ? `Nothing recorded in the last ${span} days. Ticking a single task today starts the record off again.`
      : `${taskTicks} task${taskTicks === 1 ? '' : 's'} ticked on ${dates.size} day${
          dates.size === 1 ? '' : 's'
        } across ${perRoutine.length} routine${perRoutine.length === 1 ? '' : 's'} in the last ${span} days.`;

  return {
    windowDays: span,
    windowStart,
    windowEnd: today,
    daysWithAnyCheckin: dates.size,
    taskTicks,
    routinesTouched: perRoutine.length,
    perRoutine,
    note,
  };
}

/**
 * The next `horizonDays` of scheduled routine dates, for an "upcoming" list.
 *
 * A routine the user has set aside is not advertised again while the snooze runs:
 * `snoozedUntil` is a decision about those dates, so a `nextDueOn` falling on or
 * before it is left out rather than shown and then ignored. (`totalTasks === 0` and
 * a null `nextDueOn` already exclude the `no_tasks_yet` and `no_cadence_set`
 * statuses, which have nothing to schedule in the first place.)
 */
export function upcomingSchedule(
  views: DueRoutineView[],
  today: string,
  horizonDays = 7,
): { date: string; routineId: string; routineName: string; taskCount: number }[] {
  const endNum = toDayNumber(today) + Math.max(0, Math.floor(horizonDays));
  const out: { date: string; routineId: string; routineName: string; taskCount: number }[] = [];
  for (const view of views) {
    if (view.totalTasks === 0) continue;
    const next = view.nextDueOn;
    if (!next) continue;
    if (next === today || toDayNumber(next) > endNum) continue;
    if (view.snoozedUntil != null && toDayNumber(next) <= toDayNumber(view.snoozedUntil)) continue;
    out.push({
      date: next,
      routineId: view.routineId,
      routineName: view.routineName,
      taskCount: view.totalTasks,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.routineName.localeCompare(b.routineName));
}
