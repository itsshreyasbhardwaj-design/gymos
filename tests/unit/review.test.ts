/**
 * The review generator, including the two rules it exists to keep:
 * it never shames, and it never reports a number it was not given.
 */
import { describe, it, expect } from 'vitest';
import {
  buildReview,
  windowFor,
  ALL_SECTION_KEYS,
  REVIEW_GENERATOR_VERSION,
  type ReviewFacts,
} from '@/lib/engines/review';

const ZERO: ReviewFacts = {
  training: {
    scheduledSessions: 0,
    completedSessions: 0,
    skippedSessions: 0,
    totalMinutes: 0,
    setsLogged: 0,
    distinctExercises: 0,
  },
  nutrition: {
    plannedMeals: 0,
    eatenMeals: 0,
    swappedMeals: 0,
    groceryListsGenerated: 0,
    pantryItemsTracked: 0,
  },
  grooming: {
    activeRoutines: 0,
    routineLogs: 0,
    productsTracked: 0,
    productsExpiringSoon: 0,
    productsExpired: 0,
    patchTestsInProgress: 0,
    upcomingAppointments: 0,
    skincareJournalEntries: 0,
  },
  wardrobe: { itemsTracked: 0, outfitsSaved: 0, daysPlanned: 0, wearsLogged: 0, unworn90Days: 0 },
  voice: {
    practiceSessions: 0,
    practiceSeconds: 0,
    measuredWpm: [],
    selfReportedEntries: 0,
    recordings: 0,
  },
  hygiene: { activeRoutines: 0, tasksTracked: 0, checkins: 0 },
  journal: { entries: 0, checkins: 0, cadence: 'off' },
};

function facts(overrides: Partial<ReviewFacts>): ReviewFacts {
  return {
    training: { ...ZERO.training, ...overrides.training },
    nutrition: { ...ZERO.nutrition, ...overrides.nutrition },
    grooming: { ...ZERO.grooming, ...overrides.grooming },
    wardrobe: { ...ZERO.wardrobe, ...overrides.wardrobe },
    voice: { ...ZERO.voice, ...overrides.voice },
    hygiene: { ...ZERO.hygiene, ...overrides.hygiene },
    journal: { ...ZERO.journal, ...overrides.journal },
  };
}

const WEEK = windowFor('weekly', '2026-03-15');

/** Every string a review can show the user. */
function allText(report: ReturnType<typeof buildReview>): string {
  return [
    report.headline,
    ...report.nextActions,
    ...report.limitations,
    ...report.sections.flatMap((s) => [
      s.title,
      s.emptyNote ?? '',
      ...s.observations,
      ...s.facts.map((f) => `${f.label} ${f.value}`),
    ]),
  ].join('\n');
}

describe('review windows', () => {
  it('covers the right number of inclusive days', () => {
    expect(windowFor('weekly', '2026-03-15')).toEqual({
      kind: 'weekly',
      start: '2026-03-09',
      end: '2026-03-15',
      days: 7,
    });
    expect(windowFor('fortnightly', '2026-03-15').start).toBe('2026-03-02');
    expect(windowFor('monthly', '2026-03-15').days).toBe(30);
  });

  it('crosses a month boundary correctly', () => {
    expect(windowFor('weekly', '2026-03-03').start).toBe('2026-02-25');
  });

  it('handles a leap day', () => {
    expect(windowFor('weekly', '2028-03-01').start).toBe('2028-02-24');
  });
});

describe('an empty window', () => {
  const report = buildReview(ZERO, WEEK);

  it('marks every section empty rather than inventing an observation', () => {
    expect(report.sections).toHaveLength(ALL_SECTION_KEYS.length);
    for (const section of report.sections) {
      expect(section.emptyNote).toBeTruthy();
      expect(section.observations).toEqual([]);
      expect(section.facts).toEqual([]);
    }
  });

  it('says so plainly in the headline', () => {
    expect(report.headline).toMatch(/nothing was recorded/i);
  });

  it('still records the generator version, so a stored review is traceable', () => {
    expect(report.generatorVersion).toBe(REVIEW_GENERATOR_VERSION);
  });

  it('notes that check-ins were deliberately switched off', () => {
    const journal = report.sections.find((s) => s.key === 'journal');
    expect(journal?.emptyNote).toMatch(/switched off/i);
  });
});

describe('never shames the user', () => {
  // Deliberately the worst-looking inputs: everything planned, nothing done.
  const cases: ReviewFacts[] = [
    ZERO,
    facts({ training: { ...ZERO.training, scheduledSessions: 5, completedSessions: 0 } }),
    facts({ nutrition: { ...ZERO.nutrition, plannedMeals: 21, eatenMeals: 0 } }),
    facts({ grooming: { ...ZERO.grooming, activeRoutines: 3, routineLogs: 0 } }),
    facts({ hygiene: { ...ZERO.hygiene, activeRoutines: 4, tasksTracked: 12, checkins: 0 } }),
    facts({
      training: { ...ZERO.training, scheduledSessions: 6, completedSessions: 1, skippedSessions: 5 },
      wardrobe: { ...ZERO.wardrobe, itemsTracked: 30, unworn90Days: 28 },
    }),
  ];

  const banned =
    /\b(lazy|slack\w*|failed|failure|shame\w*|ashamed|disappoint\w*|should have|no excuse|excuses|fell short|only managed|pathetic|guilt\w*|discipline problem|bad week|poorly|unacceptable)\b/i;

  it.each(cases.map((f, i) => [i, f] as const))('case %i uses no shaming language', (_i, f) => {
    const text = allText(buildReview(f, WEEK));
    expect(text).not.toMatch(banned);
  });

  it('frames a week with nothing done as neutral, not as a lapse', () => {
    const report = buildReview(
      facts({ training: { ...ZERO.training, scheduledSessions: 4, completedSessions: 0 } }),
      WEEK,
    );
    const training = report.sections.find((s) => s.key === 'training');
    expect(training?.observations.join(' ')).toMatch(/weeks like this happen/i);
  });

  it('never grades or scores anything', () => {
    for (const f of cases) {
      const text = allText(buildReview(f, WEEK));
      expect(text).not.toMatch(/\b(score|grade|rating|rated|out of (ten|10|100)|[A-F][+-]? grade)\b/i);
    }
  });
});

describe('never judges appearance or voice', () => {
  const report = buildReview(
    facts({
      voice: {
        practiceSessions: 4,
        practiceSeconds: 900,
        measuredWpm: [120, 135, 141],
        selfReportedEntries: 2,
        recordings: 3,
      },
      journal: { entries: 3, checkins: 2, cadence: 'weekly' },
      wardrobe: { itemsTracked: 40, outfitsSaved: 6, daysPlanned: 5, wearsLogged: 9, unworn90Days: 4 },
    }),
    WEEK,
  );

  it('says nothing about how the user looks or sounds', () => {
    expect(allText(report)).not.toMatch(
      /\b(attractive|unattractive|beautiful|handsome|flatter\w*|slimming|sleeker|body fat|physique|complexion grade|pleasant voice|nice voice|too high|too deep|feminine|masculine)\b/i,
    );
  });

  it('states its own limits, including that it never reads media', () => {
    expect(report.limitations.join(' ')).toMatch(/never looks at your photographs or recordings/i);
    expect(report.limitations.join(' ')).toMatch(/not a health assessment/i);
  });
});

describe('voice pace honesty', () => {
  it('reports a measured pace only when scripts supplied word counts', () => {
    const withScripts = buildReview(
      facts({
        voice: {
          practiceSessions: 3,
          practiceSeconds: 600,
          measuredWpm: [110, 130, 150],
          selfReportedEntries: 0,
          recordings: 0,
        },
      }),
      WEEK,
    );
    const section = withScripts.sections.find((s) => s.key === 'voice');
    expect(section?.facts.find((f) => f.label === 'Typical measured pace')?.value).toBe(
      '130 words/min',
    );
    expect(section?.observations.join(' ')).toMatch(/nothing was transcribed/i);
  });

  it('refuses to invent a pace when no script was used', () => {
    const noScripts = buildReview(
      facts({
        voice: {
          practiceSessions: 2,
          practiceSeconds: 300,
          measuredWpm: [],
          selfReportedEntries: 1,
          recordings: 1,
        },
      }),
      WEEK,
    );
    const section = noScripts.sections.find((s) => s.key === 'voice');
    expect(section?.facts.some((f) => f.label.includes('pace'))).toBe(false);
    expect(section?.observations.join(' ')).toMatch(/no speech recognition and will not guess/i);
  });

  it('takes the median of an even-length series', () => {
    const report = buildReview(
      facts({
        voice: { ...ZERO.voice, practiceSessions: 4, practiceSeconds: 400, measuredWpm: [100, 120, 140, 160] },
      }),
      WEEK,
    );
    const section = report.sections.find((s) => s.key === 'voice');
    expect(section?.facts.find((f) => f.label === 'Typical measured pace')?.value).toBe(
      '130 words/min',
    );
  });
});

describe('section selection', () => {
  it('honours an explicit subset', () => {
    const report = buildReview(ZERO, WEEK, ['training', 'voice']);
    expect(report.sections.map((s) => s.key)).toEqual(['training', 'voice']);
  });

  it('treats an empty subset as everything, so a new user is not shown a blank page', () => {
    expect(buildReview(ZERO, WEEK, []).sections).toHaveLength(ALL_SECTION_KEYS.length);
  });

  it('keeps a stable section order regardless of the order asked for', () => {
    const report = buildReview(ZERO, WEEK, ['journal', 'training', 'hygiene']);
    expect(report.sections.map((s) => s.key)).toEqual(['training', 'hygiene', 'journal']);
  });
});

describe('determinism', () => {
  it('produces an identical report for identical input', () => {
    const f = facts({
      training: { ...ZERO.training, scheduledSessions: 4, completedSessions: 3, setsLogged: 40, distinctExercises: 9, totalMinutes: 170 },
      grooming: { ...ZERO.grooming, activeRoutines: 2, routineLogs: 9, productsTracked: 6, productsExpired: 1 },
    });
    expect(buildReview(f, WEEK)).toEqual(buildReview(f, WEEK));
  });
});

describe('next actions', () => {
  it('offers at most three, and only ones the data points at', () => {
    const report = buildReview(
      facts({
        training: { ...ZERO.training, scheduledSessions: 5, completedSessions: 0 },
        grooming: { ...ZERO.grooming, productsTracked: 4, productsExpired: 2 },
        voice: { ...ZERO.voice, practiceSessions: 2, practiceSeconds: 240, measuredWpm: [] },
        wardrobe: { ...ZERO.wardrobe, itemsTracked: 20, unworn90Days: 11 },
      }),
      WEEK,
    );
    expect(report.nextActions.length).toBeLessThanOrEqual(3);
    expect(report.nextActions[0]).toMatch(/past their date/i);
  });

  it('phrases the suggestion as optional, never as compensation', () => {
    const report = buildReview(
      facts({ training: { ...ZERO.training, scheduledSessions: 3, completedSessions: 3, setsLogged: 0 } }),
      WEEK,
    );
    expect(report.nextActions.join(' ')).not.toMatch(/make up for|compensate|burn off|earn/i);
  });
});
