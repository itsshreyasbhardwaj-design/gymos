/**
 * The review service against a real database: that it counts only the caller's own
 * rows, that regenerating a period replaces rather than duplicates, and that a review
 * belonging to someone else is simply not there.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();

let account: typeof import('@/lib/services/account');
let review: typeof import('@/lib/services/review');
let dbClient: typeof import('@/lib/db/client');
let schema: typeof import('@/lib/db/schema');
let drizzle: typeof import('drizzle-orm');
let ids: typeof import('@/lib/auth/ids');

let mine: string;
let theirs: string;

const TODAY = '2026-03-15';

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  review = await import('@/lib/services/review');
  dbClient = await import('@/lib/db/client');
  schema = await import('@/lib/db/schema');
  drizzle = await import('drizzle-orm');
  ids = await import('@/lib/auth/ids');

  const make = async (email: string) => {
    const id = await account.registerUser({ email, password: 'a-long-enough-secret', acceptTerms: true });
    account.upsertProfile(id, {
      displayName: email.split('@')[0] ?? 'Tester',
      ageBand: 'adult_18_plus',
      experience: 'some',
      trainingDays: [1, 3, 5],
      sessionMinutes: 45,
    });
    return id;
  };
  mine = await make('review-mine@example.com');
  theirs = await make('review-theirs@example.com');

  // Rows inside the window, one set per user, so a leak shows up as a doubled count.
  for (const userId of [mine, theirs]) {
    dbClient.db
      .insert(schema.hygieneRoutines)
      .values({ id: ids.newId(), userId, name: 'Evening', cadence: 'daily' })
      .run();
    dbClient.db
      .insert(schema.personalJournalEntries)
      .values({ id: ids.newId(), userId, date: '2026-03-12', body: 'a note' })
      .run();
    dbClient.db
      .insert(schema.wardrobeItems)
      .values({ id: ids.newId(), userId, name: 'Navy shirt', category: 'top' })
      .run();
  }

  // One extra journal entry for `mine`, outside the window.
  dbClient.db
    .insert(schema.personalJournalEntries)
    .values({ id: ids.newId(), userId: mine, date: '2026-01-01', body: 'long ago' })
    .run();
});

afterAll(() => temp.cleanup());

describe('fact gathering', () => {
  it('counts only the caller\'s rows', () => {
    const window = { kind: 'weekly' as const, start: '2026-03-09', end: '2026-03-15', days: 7 };
    const facts = review.gatherFacts(mine, window);
    expect(facts.journal.entries).toBe(1);
    expect(facts.hygiene.activeRoutines).toBe(1);
    expect(facts.wardrobe.itemsTracked).toBe(1);
  });

  it('respects the window boundaries', () => {
    const wide = { kind: 'monthly' as const, start: '2025-12-01', end: '2026-03-15', days: 105 };
    expect(review.gatherFacts(mine, wide).journal.entries).toBe(2);
  });

  it('reports check-ins as off until the user turns them on', () => {
    const window = { kind: 'weekly' as const, start: '2026-03-09', end: '2026-03-15', days: 7 };
    expect(review.gatherFacts(mine, window).journal.cadence).toBe('off');
  });
});

describe('counting rows that use a defaulted enum', () => {
  /**
   * `patch_tests.outcome` is NOT NULL with a default of 'pending', so an `isNull`
   * predicate — the obvious way to ask "has no result yet" — silently matches nothing.
   * The review and the Today card both reported zero open patch tests until a demo seed
   * made the discrepancy visible. This pins the right predicate.
   */
  it('counts a patch test whose outcome is still pending', () => {
    const window = { kind: 'weekly' as const, start: '2026-03-09', end: '2026-03-15', days: 7 };
    expect(review.gatherFacts(mine, window).grooming.patchTestsInProgress).toBe(0);

    const productId = ids.newId();
    dbClient.db
      .insert(schema.skincareProducts)
      .values({ id: productId, userId: mine, name: 'Test serum', category: 'serum' })
      .run();
    dbClient.db
      .insert(schema.patchTests)
      .values({
        id: ids.newId(),
        userId: mine,
        productId,
        startedAt: '2026-03-14T20:00:00.000Z',
        checkAt: '2026-03-15T20:00:00.000Z',
        // The shipped default. Nothing sets this to NULL, which is why `isNull` was wrong.
        outcome: 'pending',
      })
      .run();

    expect(review.gatherFacts(mine, window).grooming.patchTestsInProgress).toBe(1);
    expect(review.wellnessSummary(mine, '2026-03-15').patchTestsOpen).toBe(1);
  });

  it('stops counting it once the user records what they observed', () => {
    const window = { kind: 'weekly' as const, start: '2026-03-09', end: '2026-03-15', days: 7 };
    dbClient.db
      .update(schema.patchTests)
      .set({ outcome: 'no_reaction' })
      .where(drizzle.eq(schema.patchTests.userId, mine))
      .run();
    expect(review.gatherFacts(mine, window).grooming.patchTestsInProgress).toBe(0);
    expect(review.wellnessSummary(mine, '2026-03-15').patchTestsOpen).toBe(0);

    dbClient.db.delete(schema.patchTests).where(drizzle.eq(schema.patchTests.userId, mine)).run();
    dbClient.db
      .delete(schema.skincareProducts)
      .where(drizzle.eq(schema.skincareProducts.userId, mine))
      .run();
  });
});

describe('preferences', () => {
  it('defaults to weekly with every section', () => {
    const prefs = review.getReviewPreferences(mine);
    expect(prefs.cadence).toBe('weekly');
    expect(prefs.includedSections).toEqual([]);
  });

  it('round-trips a saved subset', () => {
    review.setReviewPreferences(mine, {
      cadence: 'fortnightly',
      includedSections: ['training', 'journal'],
    });
    const prefs = review.getReviewPreferences(mine);
    expect(prefs.cadence).toBe('fortnightly');
    expect(prefs.includedSections).toEqual(['training', 'journal']);
    expect(review.previewReview(mine, 'fortnightly', TODAY).sections.map((s) => s.key)).toEqual([
      'training',
      'journal',
    ]);
    review.setReviewPreferences(mine, { cadence: 'weekly', includedSections: [] });
  });

  it('refuses a section name it does not know', () => {
    expect(() =>
      review.setReviewPreferences(mine, { cadence: 'weekly', includedSections: ['appearance'] }),
    ).toThrow(/Unknown review section/);
  });

  it('keeps one user\'s preferences out of another\'s', () => {
    review.setReviewPreferences(theirs, { cadence: 'monthly', includedSections: ['voice'] });
    expect(review.getReviewPreferences(mine).cadence).toBe('weekly');
  });
});

describe('generating and keeping reviews', () => {
  it('stores a review and reads it back', () => {
    const { id, report } = review.generateReview(mine, 'weekly', TODAY);
    expect(report.window.start).toBe('2026-03-09');
    const stored = review.getReview(mine, id);
    expect(stored.headline).toBe(report.headline);
    expect(stored.generatorVersion).toBe(report.generatorVersion);
  });

  it('replaces the same period instead of piling up copies', () => {
    const first = review.generateReview(mine, 'weekly', TODAY);
    const second = review.generateReview(mine, 'weekly', TODAY);
    expect(second.id).toBe(first.id);
    const rows = dbClient.db
      .select()
      .from(schema.personalReviewReports)
      .where(
        drizzle.and(
          drizzle.eq(schema.personalReviewReports.userId, mine),
          drizzle.eq(schema.personalReviewReports.periodKind, 'weekly'),
          drizzle.eq(schema.personalReviewReports.periodStart, '2026-03-09'),
        ),
      )
      .all();
    expect(rows).toHaveLength(1);
  });

  it('keeps different periods apart', () => {
    const weekly = review.generateReview(mine, 'weekly', TODAY);
    const fortnightly = review.generateReview(mine, 'fortnightly', TODAY);
    expect(fortnightly.id).not.toBe(weekly.id);
    expect(review.listReviews(mine).length).toBeGreaterThanOrEqual(2);
  });
});

describe('ownership', () => {
  it('does not show one user another\'s review', () => {
    const { id } = review.generateReview(theirs, 'weekly', TODAY);
    expect(() => review.getReview(mine, id)).toThrow(/does not exist/i);
    expect(review.listReviews(mine).some((r) => r.id === id)).toBe(false);
  });

  it('refuses to annotate or delete someone else\'s review', () => {
    const { id } = review.generateReview(theirs, 'monthly', TODAY);
    expect(() => review.setReviewGoals(mine, id, ['mine now'])).toThrow(/does not exist/i);
    expect(() => review.deleteReview(mine, id)).toThrow(/does not exist/i);
    expect(review.getReview(theirs, id)).toBeTruthy();
  });

  it('lets the owner annotate and delete their own', () => {
    const { id } = review.generateReview(mine, 'manual', TODAY);
    review.setReviewGoals(mine, id, ['  walk more  ', '', 'read at night']);
    const row = review.listReviews(mine).find((r) => r.id === id);
    expect(row?.userGoals).toEqual(['walk more', 'read at night']);
    review.deleteReview(mine, id);
    expect(() => review.getReview(mine, id)).toThrow();
  });
});

describe('what a review is not', () => {
  it('contains no appearance or body claim even with data in every module', () => {
    const report = review.previewReview(mine, 'weekly', TODAY);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/attractive|body fat|physique|beauty|flattering|slimming/i);
    expect(report.limitations.length).toBeGreaterThan(0);
  });
});
