/**
 * Skincare and grooming engine.
 *
 * PURE: no I/O, no database, no imports from the service layer. Every function takes
 * `today` (an ISO-8601 date) explicitly, so the same inputs always produce the same
 * outputs and the tests do not depend on the clock.
 *
 * What this engine deliberately does NOT do:
 *  - it does not score, grade or rank anything about a person's appearance,
 *  - it does not estimate skin condition, body composition or "quality" of anything,
 *  - it does not diagnose. A patch test here reports only what the USER observed, and
 *    the words "safe", "allergic", "irritant", "acne", "eczema" and their relatives
 *    are not verdicts this engine is allowed to produce.
 *
 * Everything it returns is either arithmetic on dates the user typed in, or a plain
 * count of entries the user recorded.
 */

/* ------------------------------------------------------------------ date utils */

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MS_PER_DAY = 86_400_000;

/** Days from the ISO-8601 epoch, or null when the string is not a usable date. */
function epochDay(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  // Reject impossible dates such as 2026-02-30 rather than silently rolling them over.
  const back = new Date(utc);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return Math.floor(utc / MS_PER_DAY);
}

/** 'YYYY-MM-DD' for a day number, so returned dates match the stored format. */
function dayToIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Weekday with the JavaScript convention: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number | null {
  const day = epochDay(iso);
  if (day == null) return null;
  return new Date(day * MS_PER_DAY).getUTCDay();
}

export function dayName(weekday: number): string {
  return DAY_NAMES[((weekday % 7) + 7) % 7] ?? 'Unknown';
}

/**
 * Adds whole calendar months, clamping the day to the end of the target month so
 * "opened 31 January, 1-month PAO" becomes 28 (or 29) February rather than 3 March.
 */
function addMonthsIso(iso: string, months: number): string | null {
  const day = epochDay(iso);
  if (day == null) return null;
  const base = new Date(day * MS_PER_DAY);
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const dom = base.getUTCDate();
  const targetMonthIndex = month + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clamped = Math.min(dom, lastDayOfTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, clamped)).toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number | null {
  const a = epochDay(fromIso);
  const b = epochDay(toIso);
  if (a == null || b == null) return null;
  return b - a;
}

/* -------------------------------------------------------------- product expiry */

export type ExpiryState = 'fresh' | 'use_soon' | 'expired' | 'unknown';

/** Only the product fields this engine needs; the service passes whole rows. */
export interface ProductExpiryInput {
  name?: string;
  /** Printed best-before / expiry date, as the user typed it. */
  expiresAt?: string | null;
  /** The date the user opened the jar or bottle. */
  openedAt?: string | null;
  /** Period-after-opening in months, as printed on the packaging (the PAO figure). */
  paoMonths?: number | null;
}

export interface ExpiryVerdict {
  state: ExpiryState;
  /** Plain-language explanation of how the state was reached. */
  reason: string;
  /** The date the state was computed against, or null when nothing was computable. */
  effectiveDate: string | null;
  /** Which of the two inputs produced `effectiveDate`. */
  basis: 'printed_expiry' | 'period_after_opening' | 'none';
  /** Negative once the effective date has passed. */
  daysRemaining: number | null;
}

/** Inside this many days of the effective date a product is flagged 'use_soon'. */
export const USE_SOON_DAYS = 30;

/**
 * Works out whether a product is still within date.
 *
 * Two independent sources are considered and the EARLIER one wins, because a jar
 * opened nine months ago is past its period-after-opening even if the printed
 * expiry is years away. Both figures come from the user and from the packaging —
 * nothing here is inferred, and a product with neither is 'unknown', not 'fresh'.
 */
export function productExpiryState(
  product: ProductExpiryInput,
  today: string,
): ExpiryVerdict {
  const todayDay = epochDay(today);
  if (todayDay == null) {
    return {
      state: 'unknown',
      reason: `"${today}" is not a date this can be compared against.`,
      effectiveDate: null,
      basis: 'none',
      daysRemaining: null,
    };
  }

  const printed = epochDay(product.expiresAt) == null ? null : product.expiresAt!.slice(0, 10);
  const paoMonths =
    product.paoMonths != null && Number.isFinite(product.paoMonths) && product.paoMonths > 0
      ? Math.floor(product.paoMonths)
      : null;
  const paoDate =
    paoMonths != null && epochDay(product.openedAt) != null
      ? addMonthsIso(product.openedAt!, paoMonths)
      : null;

  const candidates: { date: string; basis: 'printed_expiry' | 'period_after_opening' }[] = [];
  if (printed) candidates.push({ date: printed, basis: 'printed_expiry' });
  if (paoDate) candidates.push({ date: paoDate, basis: 'period_after_opening' });

  if (candidates.length === 0) {
    const missing: string[] = [];
    if (!printed) missing.push('no expiry date recorded');
    if (paoMonths == null) missing.push('no period-after-opening months recorded');
    else if (epochDay(product.openedAt) == null) missing.push('no opened date recorded');
    return {
      state: 'unknown',
      reason: `Cannot tell: ${missing.join(' and ')}. Add either figure from the packaging and this will update.`,
      effectiveDate: null,
      basis: 'none',
      daysRemaining: null,
    };
  }

  candidates.sort((a, b) => a.date.localeCompare(b.date));
  const earliest = candidates[0]!;
  const remaining = daysBetween(today, earliest.date);
  if (remaining == null) {
    return {
      state: 'unknown',
      reason: 'The recorded dates could not be compared.',
      effectiveDate: null,
      basis: 'none',
      daysRemaining: null,
    };
  }

  const source =
    earliest.basis === 'printed_expiry'
      ? `the expiry date you recorded (${earliest.date})`
      : `${paoMonths} months after you opened it (${earliest.date})`;
  const alsoNote =
    candidates.length > 1 ? ` This is the earlier of the two dates on file.` : '';

  if (remaining < 0) {
    return {
      state: 'expired',
      reason: `Past ${source}, by ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? '' : 's'}.${alsoNote}`,
      effectiveDate: earliest.date,
      basis: earliest.basis,
      daysRemaining: remaining,
    };
  }
  if (remaining <= USE_SOON_DAYS) {
    return {
      state: 'use_soon',
      reason:
        remaining === 0
          ? `Reaches ${source} today.${alsoNote}`
          : `${remaining} day${remaining === 1 ? '' : 's'} left before ${source}.${alsoNote}`,
      effectiveDate: earliest.date,
      basis: earliest.basis,
      daysRemaining: remaining,
    };
  }
  return {
    state: 'fresh',
    reason: `${remaining} days left before ${source}.${alsoNote}`,
    effectiveDate: earliest.date,
    basis: earliest.basis,
    daysRemaining: remaining,
  };
}

/* ------------------------------------------------------------------- routines */

export type RoutineSlot = 'morning' | 'evening' | 'weekly' | 'custom';

export interface RoutineForDue {
  id: string;
  name?: string;
  slot: RoutineSlot;
  /** 0 = Sunday … 6 = Saturday. Empty means "no specific days chosen". */
  daysOfWeek: number[];
  active: boolean;
}

export interface RoutineLogForDue {
  routineId: string;
  /** 'YYYY-MM-DD'. */
  date: string;
}

export interface DueVerdict {
  due: boolean;
  /** Set when the routine has already been logged for `today`. */
  doneToday: boolean;
  reason: string;
  /** Days since the most recent log, or null when there is none in the supplied window. */
  daysSinceLastLog: number | null;
}

/**
 * Whether a routine is due on `today`, from its slot and chosen days.
 *
 * `recentLogs` may contain logs for any routine; only this routine's are used, and
 * only to answer "already done today?" and "how long since the last one?". A routine
 * that is paused is never due, and a routine already logged today is never due again.
 */
export function routineDueToday(
  routine: RoutineForDue,
  today: string,
  recentLogs: RoutineLogForDue[] = [],
): DueVerdict {
  const todayIso = today.slice(0, 10);
  const mine = recentLogs
    .filter((log) => log.routineId === routine.id)
    .map((log) => log.date.slice(0, 10))
    .filter((date) => epochDay(date) != null)
    .sort();
  const last = mine.length > 0 ? mine[mine.length - 1]! : null;
  const daysSinceLastLog = last ? daysBetween(last, todayIso) : null;
  const doneToday = last === todayIso;

  if (!routine.active) {
    return {
      due: false,
      doneToday,
      reason: 'This routine is paused. Turn it back on when you want it in your day.',
      daysSinceLastLog,
    };
  }
  if (doneToday) {
    return {
      due: false,
      doneToday: true,
      reason: 'Already logged today.',
      daysSinceLastLog,
    };
  }

  const weekday = weekdayOf(todayIso);
  if (weekday == null) {
    return {
      due: false,
      doneToday,
      reason: `"${today}" is not a date this can be compared against.`,
      daysSinceLastLog,
    };
  }

  const chosen = [...new Set(routine.daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  const onChosenDay = chosen.includes(weekday);
  const chosenLabel = chosen
    .sort((a, b) => a - b)
    .map((d) => dayName(d))
    .join(', ');

  if (routine.slot === 'morning' || routine.slot === 'evening') {
    if (chosen.length === 0) {
      return {
        due: true,
        doneToday: false,
        reason: `Every ${routine.slot}. Not logged yet today.`,
        daysSinceLastLog,
      };
    }
    return onChosenDay
      ? {
          due: true,
          doneToday: false,
          reason: `Set for ${dayName(weekday)} ${routine.slot}s. Not logged yet today.`,
          daysSinceLastLog,
        }
      : {
          due: false,
          doneToday: false,
          reason: `Set for ${chosenLabel}, and today is ${dayName(weekday)}.`,
          daysSinceLastLog,
        };
  }

  if (routine.slot === 'weekly') {
    if (chosen.length > 0) {
      return onChosenDay
        ? {
            due: true,
            doneToday: false,
            reason: `Weekly, on ${dayName(weekday)}. Not logged yet today.`,
            daysSinceLastLog,
          }
        : {
            due: false,
            doneToday: false,
            reason: `Weekly, on ${chosenLabel}. Today is ${dayName(weekday)}.`,
            daysSinceLastLog,
          };
    }
    if (daysSinceLastLog == null) {
      return {
        due: true,
        doneToday: false,
        reason: 'Weekly, with no day chosen and nothing logged yet.',
        daysSinceLastLog,
      };
    }
    return daysSinceLastLog >= 7
      ? {
          due: true,
          doneToday: false,
          reason: `Weekly, and the last log was ${daysSinceLastLog} days ago.`,
          daysSinceLastLog,
        }
      : {
          due: false,
          doneToday: false,
          reason: `Weekly, and you logged it ${daysSinceLastLog} day${daysSinceLastLog === 1 ? '' : 's'} ago.`,
          daysSinceLastLog,
        };
  }

  // 'custom': only the days the user picked. With none picked, GymOS will not guess.
  if (chosen.length === 0) {
    return {
      due: false,
      doneToday: false,
      reason: 'No days chosen for this routine, so GymOS does not schedule it. Pick the days you want it on.',
      daysSinceLastLog,
    };
  }
  return onChosenDay
    ? {
        due: true,
        doneToday: false,
        reason: `Set for ${dayName(weekday)}. Not logged yet today.`,
        daysSinceLastLog,
      }
    : {
        due: false,
        doneToday: false,
        reason: `Set for ${chosenLabel}, and today is ${dayName(weekday)}.`,
        daysSinceLastLog,
      };
}

/* ---------------------------------------------------------------- patch tests */

/**
 * Patch-test verdicts.
 *
 * These describe the STATE OF THE TEST and what the user said they saw. There is no
 * 'safe' value and no clinical value, by design: GymOS is not able to tell anyone
 * that a product is safe for their skin, and a patch test is not a diagnosis.
 */
export type PatchTestVerdictCode =
  | 'in_progress'
  | 'awaiting_your_observation'
  | 'no_reaction_observed'
  | 'reaction_observed'
  | 'observation_unclear';

/**
 * The three answers a user can record at a patch site, and the only three that may
 * ever be stored. 'pending' is not one of them: it is the state a test starts in,
 * never something the user said they saw.
 */
export const OBSERVED_OUTCOMES = ['no_reaction', 'reaction', 'unsure'] as const;

export type ObservedOutcome = (typeof OBSERVED_OUTCOMES)[number];

export interface PatchTestInput {
  startedAt: string;
  /** When the observation window closes — the earliest point the test can be read. */
  checkAt: string;
  outcome: 'pending' | ObservedOutcome;
  note?: string;
}

/**
 * Reads a submitted observation value against the allow-list.
 *
 * SAFETY: a missing, empty, non-string or unrecognised value is `null` — never
 * 'no_reaction'. "No reaction" is the one answer that could send someone back to a
 * product that hurt them, so it is recorded only when the user actually chose it.
 * Callers refuse a `null` and write nothing; coercing to a default here would put a
 * conclusion into the record that nobody ever observed.
 */
export function parseObservedOutcome(raw: unknown): ObservedOutcome | null {
  if (typeof raw !== 'string') return null;
  return (OBSERVED_OUTCOMES as readonly string[]).includes(raw) ? (raw as ObservedOutcome) : null;
}

export interface PatchTestVerdict {
  code: PatchTestVerdictCode;
  /** Short label for the UI. Never a diagnosis and never the word "safe". */
  label: string;
  /** What this does and does not mean, in plain language. */
  detail: string;
  windowClosed: boolean;
  hoursRemaining: number | null;
  /** True when the only responsible next step is a qualified professional. */
  seeProfessional: boolean;
}

function msAt(iso: string): number | null {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * A conservative reading of a patch test.
 *
 * Rules, in order:
 *  - a reaction the user recorded is always surfaced, even early, because stopping a
 *    product early is the safe direction,
 *  - before the window closes nothing else can be concluded: the verdict is
 *    'in_progress', never a clearance,
 *  - after the window closes the verdict still only repeats what the user observed.
 */
export function patchTestVerdict(test: PatchTestInput, today: string): PatchTestVerdict {
  const nowMs = msAt(today);
  const checkMs = msAt(test.checkAt);
  const windowClosed = nowMs != null && checkMs != null ? nowMs >= checkMs : false;
  const hoursRemaining =
    nowMs != null && checkMs != null && checkMs > nowMs
      ? Math.ceil((checkMs - nowMs) / 3_600_000)
      : null;

  if (test.outcome === 'reaction') {
    return {
      code: 'reaction_observed',
      label: 'You recorded a reaction',
      detail:
        'You noted a reaction at the patch site. GymOS cannot tell you what caused it or what it is — if it is painful, spreading or not settling, see a qualified professional (a doctor or dermatologist).',
      windowClosed,
      hoursRemaining,
      seeProfessional: true,
    };
  }

  if (!windowClosed) {
    return {
      code: 'in_progress',
      label: 'Test still running',
      detail:
        hoursRemaining != null
          ? `The observation window closes in about ${hoursRemaining} hour${hoursRemaining === 1 ? '' : 's'}. Nothing can be concluded before then.`
          : 'The observation window has not closed yet. Nothing can be concluded before then.',
      windowClosed: false,
      hoursRemaining,
      seeProfessional: false,
    };
  }

  if (test.outcome === 'unsure') {
    return {
      code: 'observation_unclear',
      label: 'You were not sure',
      detail:
        'You recorded that you could not tell. Nothing is concluded from an unclear observation — run the test again, or ask a qualified professional.',
      windowClosed: true,
      hoursRemaining: null,
      seeProfessional: false,
    };
  }

  if (test.outcome === 'no_reaction') {
    return {
      code: 'no_reaction_observed',
      label: 'No reaction observed by you',
      detail:
        'This records what you saw on one small patch of skin over one window. It is not a clearance, not a result GymOS can vouch for, and not a prediction about using the product elsewhere or over time.',
      windowClosed: true,
      hoursRemaining: null,
      seeProfessional: false,
    };
  }

  return {
    code: 'awaiting_your_observation',
    label: 'Window closed — your turn to look',
    detail:
      'The observation window has closed and you have not recorded what you saw. GymOS does not look at anything on your behalf, so this stays open until you fill it in.',
    windowClosed: true,
    hoursRemaining: null,
    seeProfessional: false,
  };
}

/** Guard used by the tests: no verdict may read as a clearance or a diagnosis. */
export const PATCH_TEST_VERDICT_CODES: readonly PatchTestVerdictCode[] = [
  'in_progress',
  'awaiting_your_observation',
  'no_reaction_observed',
  'reaction_observed',
  'observation_unclear',
];

/* ----------------------------------------------------------------- adherence */

export interface AdherenceLog {
  routineId?: string;
  date: string;
}

export interface AdherenceSummary {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  /** Distinct days inside the window with at least one log. */
  daysLogged: number;
  /** Total logs inside the window, which can exceed daysLogged. */
  logsInWindow: number;
  /** Logs supplied that fall outside the window, reported rather than silently dropped. */
  logsOutsideWindow: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Consecutive days ending at `windowEnd`, as a count only. */
  consecutiveDaysToDate: number;
  /** A plain count sentence. No score, no grade, no judgement. */
  description: string;
}

/**
 * Counts what was logged in a window. That is all.
 *
 * There is no score out of ten, no percentage dressed up as a grade, no streak
 * trophy and no copy about slipping or falling behind: a skipped day is not a moral
 * event, and a count is honest where a grade is not.
 */
export function routineAdherence(
  logs: AdherenceLog[],
  windowDays: number,
  today: string,
): AdherenceSummary {
  const span = Math.max(1, Math.floor(Number.isFinite(windowDays) ? windowDays : 1));
  const endDay = epochDay(today);
  if (endDay == null) {
    return {
      windowDays: span,
      windowStart: today,
      windowEnd: today,
      daysLogged: 0,
      logsInWindow: 0,
      logsOutsideWindow: logs.length,
      firstDate: null,
      lastDate: null,
      consecutiveDaysToDate: 0,
      description: `"${today}" is not a date this can be counted against.`,
    };
  }
  const startDay = endDay - (span - 1);
  const windowStart = dayToIso(startDay);
  const windowEnd = dayToIso(endDay);

  const inWindow: string[] = [];
  let outside = 0;
  for (const log of logs) {
    const day = epochDay(log.date);
    if (day == null) {
      outside += 1;
      continue;
    }
    if (day >= startDay && day <= endDay) inWindow.push(dayToIso(day));
    else outside += 1;
  }

  const distinct = [...new Set(inWindow)].sort();
  const daysLogged = distinct.length;

  let consecutive = 0;
  const have = new Set(distinct);
  for (let day = endDay; day >= startDay; day -= 1) {
    if (!have.has(dayToIso(day))) break;
    consecutive += 1;
  }

  const description =
    daysLogged === 0
      ? `No entries logged in the ${span} days to ${windowEnd}.`
      : `${daysLogged} of the ${span} days to ${windowEnd} have an entry${
          inWindow.length !== daysLogged ? ` (${inWindow.length} entries in total)` : ''
        }. Most recent: ${distinct[distinct.length - 1]}.`;

  return {
    windowDays: span,
    windowStart,
    windowEnd,
    daysLogged,
    logsInWindow: inWindow.length,
    logsOutsideWindow: outside,
    firstDate: distinct[0] ?? null,
    lastDate: distinct[distinct.length - 1] ?? null,
    consecutiveDaysToDate: consecutive,
    description,
  };
}
