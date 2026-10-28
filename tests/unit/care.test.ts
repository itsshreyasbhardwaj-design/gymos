/**
 * Care engine tests.
 *
 * The expiry cases, the PAO arithmetic and the routine scheduling are checked for
 * correctness. The patch-test cases are checked for SAFETY: the engine must never
 * clear a product and never produce anything that reads as a diagnosis.
 */
import { describe, it, expect } from 'vitest';
import {
  productExpiryState,
  routineDueToday,
  patchTestVerdict,
  parseObservedOutcome,
  routineAdherence,
  weekdayOf,
  dayName,
  USE_SOON_DAYS,
  OBSERVED_OUTCOMES,
  PATCH_TEST_VERDICT_CODES,
  type AdherenceSummary,
  type PatchTestInput,
  type RoutineForDue,
} from '@/lib/engines/care';

/* ------------------------------------------------------------ productExpiry */

describe('productExpiryState', () => {
  it('is unknown, not fresh, when there is nothing to compare', () => {
    const verdict = productExpiryState({ name: 'Mystery cream' }, '2026-10-27');
    expect(verdict.state).toBe('unknown');
    expect(verdict.basis).toBe('none');
    expect(verdict.effectiveDate).toBeNull();
    expect(verdict.daysRemaining).toBeNull();
    expect(verdict.reason).toMatch(/no expiry date recorded/i);
  });

  it('uses the printed expiry when that is all there is', () => {
    const verdict = productExpiryState({ expiresAt: '2027-06-30' }, '2026-10-27');
    expect(verdict.state).toBe('fresh');
    expect(verdict.basis).toBe('printed_expiry');
    expect(verdict.effectiveDate).toBe('2027-06-30');
    expect(verdict.daysRemaining).toBe(246);
  });

  it('marks a past printed expiry as expired and says by how much', () => {
    const verdict = productExpiryState({ expiresAt: '2026-10-20' }, '2026-10-27');
    expect(verdict.state).toBe('expired');
    expect(verdict.daysRemaining).toBe(-7);
    expect(verdict.reason).toContain('7 days');
  });

  it('treats the expiry day itself as use_soon, not expired', () => {
    const verdict = productExpiryState({ expiresAt: '2026-10-27' }, '2026-10-27');
    expect(verdict.state).toBe('use_soon');
    expect(verdict.daysRemaining).toBe(0);
    expect(verdict.reason).toMatch(/today/);
  });

  it('flags the day after the use-soon boundary as fresh and the boundary itself as use_soon', () => {
    const boundary = productExpiryState({ expiresAt: '2026-11-26' }, '2026-10-27');
    expect(boundary.daysRemaining).toBe(USE_SOON_DAYS);
    expect(boundary.state).toBe('use_soon');

    const justOutside = productExpiryState({ expiresAt: '2026-11-27' }, '2026-10-27');
    expect(justOutside.daysRemaining).toBe(USE_SOON_DAYS + 1);
    expect(justOutside.state).toBe('fresh');
  });

  it('derives a date from opened + period-after-opening months', () => {
    const verdict = productExpiryState(
      { openedAt: '2026-06-15', paoMonths: 6 },
      '2026-10-27',
    );
    expect(verdict.basis).toBe('period_after_opening');
    expect(verdict.effectiveDate).toBe('2026-12-15');
    expect(verdict.state).toBe('fresh');
    expect(verdict.reason).toContain('6 months after you opened it');
  });

  it('clamps PAO month arithmetic to the end of a short month', () => {
    // 31 January + 1 month is 28 February, not 3 March.
    const verdict = productExpiryState({ openedAt: '2026-01-31', paoMonths: 1 }, '2026-02-01');
    expect(verdict.effectiveDate).toBe('2026-02-28');

    const leap = productExpiryState({ openedAt: '2028-01-31', paoMonths: 1 }, '2028-02-01');
    expect(leap.effectiveDate).toBe('2028-02-29');
  });

  it('crosses a year boundary correctly', () => {
    const verdict = productExpiryState({ openedAt: '2026-11-30', paoMonths: 12 }, '2026-12-01');
    expect(verdict.effectiveDate).toBe('2027-11-30');
  });

  it('takes the EARLIER of the printed expiry and the PAO date', () => {
    // Printed expiry is years out, but the jar was opened nine months ago with a 6-month PAO.
    const paoWins = productExpiryState(
      { expiresAt: '2030-01-01', openedAt: '2026-01-27', paoMonths: 6 },
      '2026-10-27',
    );
    expect(paoWins.basis).toBe('period_after_opening');
    expect(paoWins.effectiveDate).toBe('2026-07-27');
    expect(paoWins.state).toBe('expired');
    expect(paoWins.reason).toMatch(/earlier of the two dates/i);

    // And the other way round: opened yesterday, but the bottle is already out of date.
    const printedWins = productExpiryState(
      { expiresAt: '2026-10-01', openedAt: '2026-10-26', paoMonths: 12 },
      '2026-10-27',
    );
    expect(printedWins.basis).toBe('printed_expiry');
    expect(printedWins.state).toBe('expired');
  });

  it('ignores a PAO figure with no opened date, and an opened date with no PAO figure', () => {
    expect(productExpiryState({ paoMonths: 6 }, '2026-10-27').state).toBe('unknown');
    expect(productExpiryState({ openedAt: '2026-01-01' }, '2026-10-27').state).toBe('unknown');
    expect(productExpiryState({ openedAt: '2026-01-01', paoMonths: 0 }, '2026-10-27').state).toBe(
      'unknown',
    );
  });

  it('rejects unusable dates rather than guessing', () => {
    expect(productExpiryState({ expiresAt: 'soon' }, '2026-10-27').state).toBe('unknown');
    expect(productExpiryState({ expiresAt: '2026-02-30' }, '2026-10-27').state).toBe('unknown');
    expect(productExpiryState({ expiresAt: '2026-10-28' }, 'tomorrow').state).toBe('unknown');
  });

  it('accepts a full ISO timestamp as well as a bare date', () => {
    const verdict = productExpiryState({ expiresAt: '2026-11-10T09:30:00.000Z' }, '2026-10-27');
    expect(verdict.effectiveDate).toBe('2026-11-10');
    expect(verdict.state).toBe('use_soon');
  });

  it('is deterministic: the same inputs give the same answer', () => {
    const input = { openedAt: '2026-03-01', paoMonths: 9, expiresAt: '2027-01-01' };
    expect(productExpiryState(input, '2026-10-27')).toEqual(
      productExpiryState(input, '2026-10-27'),
    );
  });
});

/* ------------------------------------------------------------ routineDueToday */

const routine = (over: Partial<RoutineForDue> = {}): RoutineForDue => ({
  id: 'r1',
  name: 'Morning face',
  slot: 'morning',
  daysOfWeek: [],
  active: true,
  ...over,
});

describe('routineDueToday', () => {
  // 2026-10-27 is a Tuesday (weekday 2).
  it('agrees with the calendar about the weekday', () => {
    expect(weekdayOf('2026-10-27')).toBe(2);
    expect(dayName(2)).toBe('Tuesday');
  });

  it('is due for a daily morning routine with no days chosen', () => {
    const verdict = routineDueToday(routine(), '2026-10-27', []);
    expect(verdict.due).toBe(true);
    expect(verdict.doneToday).toBe(false);
  });

  it('is not due once it has been logged today, and says so without reproach', () => {
    const verdict = routineDueToday(routine(), '2026-10-27', [
      { routineId: 'r1', date: '2026-10-27' },
    ]);
    expect(verdict.due).toBe(false);
    expect(verdict.doneToday).toBe(true);
    expect(verdict.reason).toBe('Already logged today.');
  });

  it('is never due when paused', () => {
    const verdict = routineDueToday(routine({ active: false }), '2026-10-27', []);
    expect(verdict.due).toBe(false);
    expect(verdict.reason).toMatch(/paused/i);
  });

  it('respects chosen days for a morning routine', () => {
    const tuesdayOnly = routine({ daysOfWeek: [2] });
    expect(routineDueToday(tuesdayOnly, '2026-10-27', []).due).toBe(true);
    expect(routineDueToday(tuesdayOnly, '2026-10-28', []).due).toBe(false);
    expect(routineDueToday(tuesdayOnly, '2026-10-28', []).reason).toContain('Wednesday');
  });

  it('for a weekly routine with a chosen day, is due only on that day', () => {
    const weekly = routine({ slot: 'weekly', daysOfWeek: [0] });
    expect(routineDueToday(weekly, '2026-11-01', []).due).toBe(true); // Sunday
    expect(routineDueToday(weekly, '2026-10-27', []).due).toBe(false);
  });

  it('for a weekly routine with no chosen day, waits seven days from the last log', () => {
    const weekly = routine({ slot: 'weekly' });
    expect(routineDueToday(weekly, '2026-10-27', []).due).toBe(true);
    const sixDaysAgo = routineDueToday(weekly, '2026-10-27', [
      { routineId: 'r1', date: '2026-10-21' },
    ]);
    expect(sixDaysAgo.due).toBe(false);
    expect(sixDaysAgo.daysSinceLastLog).toBe(6);
    const sevenDaysAgo = routineDueToday(weekly, '2026-10-27', [
      { routineId: 'r1', date: '2026-10-20' },
    ]);
    expect(sevenDaysAgo.due).toBe(true);
    expect(sevenDaysAgo.daysSinceLastLog).toBe(7);
  });

  it('never guesses for a custom routine with no days chosen', () => {
    const verdict = routineDueToday(routine({ slot: 'custom' }), '2026-10-27', []);
    expect(verdict.due).toBe(false);
    expect(verdict.reason).toMatch(/no days chosen/i);
  });

  it('ignores logs that belong to a different routine', () => {
    const verdict = routineDueToday(routine(), '2026-10-27', [
      { routineId: 'someone-elses-routine', date: '2026-10-27' },
    ]);
    expect(verdict.doneToday).toBe(false);
    expect(verdict.due).toBe(true);
  });

  it('discards out-of-range weekday values instead of throwing', () => {
    const verdict = routineDueToday(
      routine({ slot: 'custom', daysOfWeek: [9, -1, 2] }),
      '2026-10-27',
      [],
    );
    expect(verdict.due).toBe(true);
  });
});

/* ----------------------------------------------------------- patchTestVerdict */

const test = (over: Partial<PatchTestInput> = {}): PatchTestInput => ({
  startedAt: '2026-10-26T09:00:00.000Z',
  checkAt: '2026-10-28T09:00:00.000Z',
  outcome: 'pending',
  ...over,
});

/** Words a verdict must never contain: clearances and clinical claims. */
const FORBIDDEN_WORDS = [
  'safe',
  'safely',
  'cleared',
  'approved',
  'allergic',
  'allergy',
  'allergen',
  'irritant',
  'dermatitis',
  'eczema',
  'acne',
  'rosacea',
  'psoriasis',
  'infection',
  'diagnos',
  'hypoallergenic',
  'suitable for your skin',
];

describe('patchTestVerdict — safety', () => {
  it('never returns a "safe" verdict, before or after the window closes', () => {
    const cases: PatchTestInput[] = [
      test({ outcome: 'pending' }),
      test({ outcome: 'no_reaction' }),
      test({ outcome: 'reaction' }),
      test({ outcome: 'unsure' }),
    ];
    for (const todayIso of ['2026-10-26T10:00:00.000Z', '2026-10-30T09:00:00.000Z']) {
      for (const input of cases) {
        const verdict = patchTestVerdict(input, todayIso);
        expect(PATCH_TEST_VERDICT_CODES).toContain(verdict.code);
        expect(verdict.code as string).not.toBe('safe');
        const text = `${verdict.code} ${verdict.label} ${verdict.detail}`.toLowerCase();
        for (const word of FORBIDDEN_WORDS) {
          expect(text, `"${word}" must not appear in a patch-test verdict`).not.toContain(word);
        }
      }
    }
  });

  it('is in_progress before the window closes, even when the user recorded no reaction', () => {
    const verdict = patchTestVerdict(
      test({ outcome: 'no_reaction' }),
      '2026-10-26T12:00:00.000Z',
    );
    expect(verdict.code).toBe('in_progress');
    expect(verdict.windowClosed).toBe(false);
    // 26 Oct 12:00 to 28 Oct 09:00 is 45 hours.
    expect(verdict.hoursRemaining).toBe(45);
    expect(verdict.detail).toMatch(/nothing can be concluded/i);
  });

  it('is in_progress before the window closes when nothing has been recorded', () => {
    const verdict = patchTestVerdict(test(), '2026-10-27T09:00:00.000Z');
    expect(verdict.code).toBe('in_progress');
  });

  it('surfaces a recorded reaction immediately, even early, and routes to a professional', () => {
    const verdict = patchTestVerdict(test({ outcome: 'reaction' }), '2026-10-26T10:00:00.000Z');
    expect(verdict.code).toBe('reaction_observed');
    expect(verdict.seeProfessional).toBe(true);
    expect(verdict.detail).toMatch(/qualified professional/i);
    // It reports the observation without naming a cause or a condition.
    expect(verdict.detail).toMatch(/cannot tell you what caused it/i);
  });

  it('after the window closes, reports only what the user observed', () => {
    const closed = '2026-10-29T09:00:00.000Z';
    expect(patchTestVerdict(test({ outcome: 'no_reaction' }), closed).code).toBe(
      'no_reaction_observed',
    );
    expect(patchTestVerdict(test({ outcome: 'no_reaction' }), closed).detail).toMatch(
      /not a clearance/i,
    );
    expect(patchTestVerdict(test({ outcome: 'unsure' }), closed).code).toBe(
      'observation_unclear',
    );
    expect(patchTestVerdict(test({ outcome: 'pending' }), closed).code).toBe(
      'awaiting_your_observation',
    );
  });

  it('does not invent an observation when the user recorded none', () => {
    const verdict = patchTestVerdict(test({ outcome: 'pending' }), '2026-10-29T09:00:00.000Z');
    expect(verdict.detail).toMatch(/does not look at anything on your behalf/i);
  });

  it('treats the exact closing instant as closed', () => {
    const verdict = patchTestVerdict(
      test({ outcome: 'no_reaction' }),
      '2026-10-28T09:00:00.000Z',
    );
    expect(verdict.windowClosed).toBe(true);
    expect(verdict.code).toBe('no_reaction_observed');
  });
});

/* ------------------------------------------------------------ routineAdherence */

describe('parseObservedOutcome — the patch-test allow-list', () => {
  it('reads back each of the three answers the user can choose, and only those', () => {
    expect([...OBSERVED_OUTCOMES]).toEqual(['no_reaction', 'reaction', 'unsure']);
    expect(parseObservedOutcome('no_reaction')).toBe('no_reaction');
    expect(parseObservedOutcome('reaction')).toBe('reaction');
    expect(parseObservedOutcome('unsure')).toBe('unsure');
  });

  it('never reads a missing, empty or unrecognised value as "no reaction"', () => {
    // The regression this pins: a coercing read of the submitted field
    // (`raw === 'reaction' ? 'reaction' : raw === 'unsure' ? 'unsure' : 'no_reaction'`)
    // turned EVERY value it did not recognise — including an absent one — into the
    // single answer that could send someone back to a product that hurt them.
    const refused: unknown[] = [
      undefined,
      null,
      '',
      '   ',
      'no_reaction ',
      ' no_reaction',
      'No_Reaction',
      'NO_REACTION',
      'no reaction',
      'none',
      'nothing happened',
      'fine',
      'safe',
      'cleared',
      'ok',
      0,
      1,
      false,
      true,
      {},
      [],
      ['no_reaction'],
      { outcome: 'no_reaction' },
      new Date(),
      () => 'no_reaction',
    ];
    for (const raw of refused) {
      expect(
        parseObservedOutcome(raw),
        `${typeof raw} ${JSON.stringify(raw) ?? String(raw)} must not become an observation`,
      ).toBeNull();
    }
  });

  it('does not accept the state a test starts in as something the user observed', () => {
    // 'pending' is a row state, not an answer. Accepting it would let a test that
    // nobody has looked at read as an answered one.
    expect(parseObservedOutcome('pending')).toBeNull();
    expect((OBSERVED_OUTCOMES as readonly string[]).includes('pending')).toBe(false);
  });
});

describe('routineAdherence', () => {
  it('counts distinct days in the window', () => {
    const summary = routineAdherence(
      [
        { date: '2026-10-27' },
        { date: '2026-10-26' },
        { date: '2026-10-25' },
        { date: '2026-10-20' },
      ],
      7,
      '2026-10-27',
    );
    expect(summary.windowDays).toBe(7);
    expect(summary.windowStart).toBe('2026-10-21');
    expect(summary.windowEnd).toBe('2026-10-27');
    expect(summary.daysLogged).toBe(3);
    expect(summary.logsOutsideWindow).toBe(1);
    expect(summary.consecutiveDaysToDate).toBe(3);
    expect(summary.firstDate).toBe('2026-10-25');
    expect(summary.lastDate).toBe('2026-10-27');
  });

  it('does not double-count two logs on the same day', () => {
    const summary = routineAdherence(
      [{ date: '2026-10-27' }, { date: '2026-10-27T18:00:00.000Z' }],
      7,
      '2026-10-27',
    );
    expect(summary.daysLogged).toBe(1);
    expect(summary.logsInWindow).toBe(2);
    expect(summary.description).toContain('2 entries in total');
  });

  /**
   * Copy that would turn a skipped day into a moral event, or a count into a mark.
   * Praise is on the list too: "well done" for a full window implies a rebuke for an
   * empty one.
   */
  const SHAMING_WORDS = [
    'fail',
    'failed',
    'slip',
    'lazy',
    'excuse',
    'should have',
    'poor',
    'bad',
    'streak',
    'streak lost',
    'missed',
    'behind',
    'consistency',
    'disappoint',
    'well done',
    'keep it up',
    'grade',
    'score',
    'rating',
    'out of 10',
    '%',
  ];

  /**
   * Every branch of the description, not just the empty one.
   *
   * `routineAdherence` builds its sentence four different ways — unusable date, no
   * entries, one entry per day, more entries than days — so a single case can only
   * vouch for a quarter of the copy that actually ships.
   */
  const BRANCHES: { name: string; summary: AdherenceSummary; description: string }[] = [
    {
      name: 'unusable date',
      summary: routineAdherence([{ date: '2026-10-27' }], 7, 'not-a-date'),
      description: '"not-a-date" is not a date this can be counted against.',
    },
    {
      name: 'no entries in the window',
      summary: routineAdherence([], 14, '2026-10-27'),
      description: 'No entries logged in the 14 days to 2026-10-27.',
    },
    {
      name: 'entries, one per day',
      summary: routineAdherence([{ date: '2026-10-25' }], 14, '2026-10-27'),
      description: '1 of the 14 days to 2026-10-27 have an entry. Most recent: 2026-10-25.',
    },
    {
      name: 'more entries than days',
      summary: routineAdherence(
        [{ date: '2026-10-26' }, { date: '2026-10-27' }, { date: '2026-10-27T18:00:00.000Z' }],
        7,
        '2026-10-27',
      ),
      description:
        '2 of the 7 days to 2026-10-27 have an entry (3 entries in total). Most recent: 2026-10-27.',
    },
    {
      name: 'a full window',
      summary: routineAdherence(
        [{ date: '2026-10-25' }, { date: '2026-10-26' }, { date: '2026-10-27' }],
        3,
        '2026-10-27',
      ),
      description:
        '3 of the 3 days to 2026-10-27 have an entry. Most recent: 2026-10-27.',
    },
  ];

  it('describes every branch exactly, so no branch can drift unnoticed', () => {
    for (const branch of BRANCHES) {
      expect(branch.summary.description, branch.name).toBe(branch.description);
    }
    // And the four shapes really are different branches, not the same string twice.
    expect(new Set(BRANCHES.map((b) => b.summary.description)).size).toBe(BRANCHES.length);
  });

  it('uses no shaming language in ANY branch, and no praise either', () => {
    for (const branch of BRANCHES) {
      // Every string the summary carries, not only the one the UI happens to print.
      const text = Object.values(branch.summary)
        .filter((value): value is string => typeof value === 'string')
        .join(' ')
        .toLowerCase();
      for (const word of SHAMING_WORDS) {
        expect(text, `"${word}" must not appear in the ${branch.name} branch`).not.toContain(
          word,
        );
      }
    }
  });

  it('reports an empty window as a count, not an absence of effort', () => {
    const summary = routineAdherence([], 14, '2026-10-27');
    expect(summary.daysLogged).toBe(0);
    expect(summary.consecutiveDaysToDate).toBe(0);
    expect(summary.description).toBe('No entries logged in the 14 days to 2026-10-27.');
  });

  it('returns no score, grade or percentage anywhere in its shape', () => {
    const summary = routineAdherence([{ date: '2026-10-27' }], 7, '2026-10-27');
    const keys = Object.keys(summary);
    for (const banned of ['score', 'grade', 'rating', 'percent', 'percentage', 'rank']) {
      expect(keys.some((k) => k.toLowerCase().includes(banned))).toBe(false);
    }
  });

  it('handles a nonsense window and a nonsense date without throwing', () => {
    expect(routineAdherence([{ date: '2026-10-27' }], 0, '2026-10-27').windowDays).toBe(1);
    const bad = routineAdherence([{ date: '2026-10-27' }], 7, 'not-a-date');
    expect(bad.daysLogged).toBe(0);
    expect(bad.logsOutsideWindow).toBe(1);
  });
});
