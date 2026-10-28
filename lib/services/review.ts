import 'server-only';
import { and, eq, gte, lte, lt, sql, inArray, isNull, isNotNull, count } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  workoutSessions,
  exerciseLogs,
  mealPlans,
  plannedMeals,
  groceryLists,
  pantryItems,
  groomingRoutines,
  groomingRoutineLogs,
  skincareProducts,
  skincareJournal,
  patchTests,
  groomingAppointments,
  wardrobeItems,
  outfitCombinations,
  outfitPlans,
  voicePracticeSessions,
  voiceRecordings,
  communicationFeedback,
  hygieneRoutines,
  hygieneTasks,
  hygieneCheckins,
  personalCareSupplies,
  personalJournalEntries,
  photoCheckins,
  checkinSchedules,
  personalReviewReports,
  reviewPreferences,
} from '@/lib/db/schema';
import {
  buildReview,
  windowFor,
  ALL_SECTION_KEYS,
  REVIEW_GENERATOR_VERSION,
  type ReviewFacts,
  type ReviewPeriodKind,
  type ReviewReport,
  type ReviewWindow,
} from '@/lib/engines/review';
import { newId } from '@/lib/auth/ids';
import { NotFoundError } from './equipment';
import { ValidationError } from './account';

const SOON_DAYS = 30;
const UNWORN_DAYS = 90;

function num(rows: { c: number }[]): number {
  return rows[0]?.c ?? 0;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Gathers the review's raw counts.
 *
 * Every query is scoped to the user in its WHERE clause, and child tables are reached
 * through an ownership-checked parent id list rather than by trusting a foreign key.
 * Nothing here reads a media file: the review counts rows, which is why it cannot
 * produce a statement about how someone looks or sounds.
 */
export function gatherFacts(userId: string, window: ReviewWindow): ReviewFacts {
  const { start, end } = window;
  const endExclusiveTs = `${addDays(end, 1)}T00:00:00.000Z`;
  const startTs = `${start}T00:00:00.000Z`;

  /* ------------------------------------------------------------- training */
  const sessionRows = db
    .select({
      id: workoutSessions.id,
      status: workoutSessions.status,
      durationSeconds: workoutSessions.durationSeconds,
    })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, userId),
        gte(workoutSessions.scheduledDate, start),
        lte(workoutSessions.scheduledDate, end),
      ),
    )
    .all();
  const completedIds = sessionRows.filter((r) => r.status === 'completed').map((r) => r.id);
  const logRows =
    completedIds.length === 0
      ? []
      : db
          .select({ exerciseId: exerciseLogs.exerciseId, skipped: exerciseLogs.skipped })
          .from(exerciseLogs)
          .where(inArray(exerciseLogs.sessionId, completedIds))
          .all();

  const training = {
    scheduledSessions: sessionRows.length,
    completedSessions: completedIds.length,
    skippedSessions: sessionRows.filter((r) => r.status === 'skipped').length,
    totalMinutes: Math.round(
      sessionRows.reduce((sum, r) => sum + (r.durationSeconds ?? 0), 0) / 60,
    ),
    setsLogged: logRows.filter((r) => !r.skipped).length,
    distinctExercises: new Set(logRows.map((r) => r.exerciseId)).size,
  };

  /* ------------------------------------------------------------ nutrition */
  const planIds = db
    .select({ id: mealPlans.id })
    .from(mealPlans)
    .where(eq(mealPlans.userId, userId))
    .all()
    .map((r) => r.id);
  const mealRows =
    planIds.length === 0
      ? []
      : db
          .select({ status: plannedMeals.status, swappedFrom: plannedMeals.swappedFromRecipeId })
          .from(plannedMeals)
          .where(
            and(
              inArray(plannedMeals.mealPlanId, planIds),
              gte(plannedMeals.date, start),
              lte(plannedMeals.date, end),
            ),
          )
          .all();

  const nutrition = {
    plannedMeals: mealRows.length,
    eatenMeals: mealRows.filter((r) => r.status === 'cooked').length,
    swappedMeals: mealRows.filter((r) => r.swappedFrom !== null).length,
    groceryListsGenerated: num(
      db
        .select({ c: count() })
        .from(groceryLists)
        .where(
          and(
            eq(groceryLists.userId, userId),
            gte(groceryLists.createdAt, startTs),
            lt(groceryLists.createdAt, endExclusiveTs),
          ),
        )
        .all(),
    ),
    pantryItemsTracked: num(
      db.select({ c: count() }).from(pantryItems).where(eq(pantryItems.userId, userId)).all(),
    ),
  };

  /* ------------------------------------------------------------- grooming */
  const soonCutoff = `${addDays(end, SOON_DAYS)}T00:00:00.000Z`;
  const grooming = {
    activeRoutines: num(
      db
        .select({ c: count() })
        .from(groomingRoutines)
        .where(and(eq(groomingRoutines.userId, userId), eq(groomingRoutines.active, true)))
        .all(),
    ),
    routineLogs: num(
      db
        .select({ c: count() })
        .from(groomingRoutineLogs)
        .where(
          and(
            eq(groomingRoutineLogs.userId, userId),
            gte(groomingRoutineLogs.date, start),
            lte(groomingRoutineLogs.date, end),
          ),
        )
        .all(),
    ),
    productsTracked: num(
      db
        .select({ c: count() })
        .from(skincareProducts)
        .where(and(eq(skincareProducts.userId, userId), eq(skincareProducts.archived, false)))
        .all(),
    ),
    productsExpiringSoon: num(
      db
        .select({ c: count() })
        .from(skincareProducts)
        .where(
          and(
            eq(skincareProducts.userId, userId),
            eq(skincareProducts.archived, false),
            isNotNull(skincareProducts.expiresAt),
            gte(skincareProducts.expiresAt, endExclusiveTs),
            lt(skincareProducts.expiresAt, soonCutoff),
          ),
        )
        .all(),
    ),
    productsExpired: num(
      db
        .select({ c: count() })
        .from(skincareProducts)
        .where(
          and(
            eq(skincareProducts.userId, userId),
            eq(skincareProducts.archived, false),
            isNotNull(skincareProducts.expiresAt),
            lt(skincareProducts.expiresAt, endExclusiveTs),
          ),
        )
        .all(),
    ),
    patchTestsInProgress: num(
      db
        .select({ c: count() })
        .from(patchTests)
        .where(and(eq(patchTests.userId, userId), eq(patchTests.outcome, 'pending')))
        .all(),
    ),
    upcomingAppointments: num(
      db
        .select({ c: count() })
        .from(groomingAppointments)
        .where(
          and(
            eq(groomingAppointments.userId, userId),
            eq(groomingAppointments.completed, false),
            gte(groomingAppointments.scheduledAt, startTs),
          ),
        )
        .all(),
    ),
    skincareJournalEntries: num(
      db
        .select({ c: count() })
        .from(skincareJournal)
        .where(
          and(
            eq(skincareJournal.userId, userId),
            gte(skincareJournal.date, start),
            lte(skincareJournal.date, end),
          ),
        )
        .all(),
    ),
  };

  /* ------------------------------------------------------------- wardrobe */
  const unwornCutoff = `${addDays(end, -UNWORN_DAYS)}T00:00:00.000Z`;
  const wardrobe = {
    itemsTracked: num(
      db
        .select({ c: count() })
        .from(wardrobeItems)
        .where(and(eq(wardrobeItems.userId, userId), eq(wardrobeItems.archived, false)))
        .all(),
    ),
    outfitsSaved: num(
      db
        .select({ c: count() })
        .from(outfitCombinations)
        .where(eq(outfitCombinations.userId, userId))
        .all(),
    ),
    daysPlanned: num(
      db
        .select({ c: count() })
        .from(outfitPlans)
        .where(
          and(eq(outfitPlans.userId, userId), gte(outfitPlans.date, start), lte(outfitPlans.date, end)),
        )
        .all(),
    ),
    wearsLogged: num(
      db
        .select({ c: count() })
        .from(wardrobeItems)
        .where(
          and(
            eq(wardrobeItems.userId, userId),
            isNotNull(wardrobeItems.lastWornAt),
            gte(wardrobeItems.lastWornAt, startTs),
            lt(wardrobeItems.lastWornAt, endExclusiveTs),
          ),
        )
        .all(),
    ),
    unworn90Days: num(
      db
        .select({ c: count() })
        .from(wardrobeItems)
        .where(
          and(
            eq(wardrobeItems.userId, userId),
            eq(wardrobeItems.archived, false),
            sql`(${wardrobeItems.lastWornAt} IS NULL OR ${wardrobeItems.lastWornAt} < ${unwornCutoff})`,
          ),
        )
        .all(),
    ),
  };

  /* ---------------------------------------------------------------- voice */
  const practiceRows = db
    .select({
      id: voicePracticeSessions.id,
      durationSeconds: voicePracticeSessions.durationSeconds,
      wordsPerMinute: voicePracticeSessions.wordsPerMinute,
      scriptWordCount: voicePracticeSessions.scriptWordCount,
    })
    .from(voicePracticeSessions)
    .where(
      and(
        eq(voicePracticeSessions.userId, userId),
        gte(voicePracticeSessions.date, start),
        lte(voicePracticeSessions.date, end),
      ),
    )
    .all();
  const practiceIds = practiceRows.map((r) => r.id);

  const voice = {
    practiceSessions: practiceRows.length,
    practiceSeconds: practiceRows.reduce((sum, r) => sum + (r.durationSeconds ?? 0), 0),
    // Only pace figures backed by a known script word count count as measured.
    measuredWpm: practiceRows
      .filter((r) => r.wordsPerMinute !== null && (r.scriptWordCount ?? 0) > 0)
      .map((r) => r.wordsPerMinute as number),
    selfReportedEntries:
      practiceIds.length === 0
        ? 0
        : num(
            db
              .select({ c: count() })
              .from(communicationFeedback)
              .where(
                and(
                  inArray(communicationFeedback.sessionId, practiceIds),
                  eq(communicationFeedback.source, 'self_reported'),
                ),
              )
              .all(),
          ),
    recordings:
      practiceIds.length === 0
        ? 0
        : num(
            db
              .select({ c: count() })
              .from(voiceRecordings)
              .where(inArray(voiceRecordings.sessionId, practiceIds))
              .all(),
          ),
  };

  /* -------------------------------------------------------------- hygiene */
  const hygieneRoutineIds = db
    .select({ id: hygieneRoutines.id })
    .from(hygieneRoutines)
    .where(and(eq(hygieneRoutines.userId, userId), eq(hygieneRoutines.active, true)))
    .all()
    .map((r) => r.id);

  const hygiene = {
    activeRoutines: hygieneRoutineIds.length,
    tasksTracked:
      hygieneRoutineIds.length === 0
        ? 0
        : num(
            db
              .select({ c: count() })
              .from(hygieneTasks)
              .where(inArray(hygieneTasks.routineId, hygieneRoutineIds))
              .all(),
          ),
    checkins: num(
      db
        .select({ c: count() })
        .from(hygieneCheckins)
        .where(
          and(
            eq(hygieneCheckins.userId, userId),
            gte(hygieneCheckins.date, start),
            lte(hygieneCheckins.date, end),
          ),
        )
        .all(),
    ),
  };

  /* -------------------------------------------------------------- journal */
  const schedule = db
    .select({ cadence: checkinSchedules.cadence })
    .from(checkinSchedules)
    .where(eq(checkinSchedules.userId, userId))
    .get();

  const journal = {
    entries: num(
      db
        .select({ c: count() })
        .from(personalJournalEntries)
        .where(
          and(
            eq(personalJournalEntries.userId, userId),
            gte(personalJournalEntries.date, start),
            lte(personalJournalEntries.date, end),
          ),
        )
        .all(),
    ),
    checkins: num(
      db
        .select({ c: count() })
        .from(photoCheckins)
        .where(
          and(
            eq(photoCheckins.userId, userId),
            gte(photoCheckins.date, start),
            lte(photoCheckins.date, end),
          ),
        )
        .all(),
    ),
    cadence: schedule?.cadence ?? 'off',
  };

  return { training, nutrition, grooming, wardrobe, voice, hygiene, journal };
}

/* ------------------------------------------------------------ preferences */

export function getReviewPreferences(userId: string) {
  const row = db
    .select()
    .from(reviewPreferences)
    .where(eq(reviewPreferences.userId, userId))
    .get();
  return row ?? { userId, cadence: 'weekly' as ReviewPeriodKind, includedSections: [], updatedAt: '' };
}

export function setReviewPreferences(
  userId: string,
  input: { cadence: ReviewPeriodKind; includedSections: string[] },
): void {
  const unknown = input.includedSections.filter(
    (s) => !(ALL_SECTION_KEYS as string[]).includes(s),
  );
  if (unknown.length > 0) throw new ValidationError(`Unknown review section: ${unknown.join(', ')}`);
  const now = new Date().toISOString();
  db.insert(reviewPreferences)
    .values({
      userId,
      cadence: input.cadence,
      includedSections: input.includedSections,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: reviewPreferences.userId,
      set: { cadence: input.cadence, includedSections: input.includedSections, updatedAt: now },
    })
    .run();
}

/* ---------------------------------------------------------------- reports */

/** Builds a review without storing it, for previewing before you keep it. */
export function previewReview(
  userId: string,
  kind: ReviewPeriodKind,
  today = new Date().toISOString().slice(0, 10),
): ReviewReport {
  const prefs = getReviewPreferences(userId);
  const window = windowFor(kind, today, prefs.cadence === 'manual' ? 7 : undefined);
  const included = (prefs.includedSections as (keyof ReviewFacts)[]).filter((s) =>
    ALL_SECTION_KEYS.includes(s),
  );
  return buildReview(gatherFacts(userId, window), window, included);
}

/**
 * Generates and stores a review. Re-running it for the same window replaces the
 * stored copy rather than piling up near-identical rows — the unique index on
 * (user, kind, periodStart) is what makes that safe.
 */
export function generateReview(
  userId: string,
  kind: ReviewPeriodKind,
  today = new Date().toISOString().slice(0, 10),
): { id: string; report: ReviewReport } {
  const report = previewReview(userId, kind, today);
  const existing = db
    .select({ id: personalReviewReports.id })
    .from(personalReviewReports)
    .where(
      and(
        eq(personalReviewReports.userId, userId),
        eq(personalReviewReports.periodKind, kind),
        eq(personalReviewReports.periodStart, report.window.start),
      ),
    )
    .get();

  const id = existing?.id ?? newId();
  db.insert(personalReviewReports)
    .values({
      id,
      userId,
      periodKind: kind,
      periodStart: report.window.start,
      periodEnd: report.window.end,
      sections: report,
      nextActions: report.nextActions,
      generatorVersion: REVIEW_GENERATOR_VERSION,
    })
    .onConflictDoUpdate({
      target: [
        personalReviewReports.userId,
        personalReviewReports.periodKind,
        personalReviewReports.periodStart,
      ],
      set: {
        periodEnd: report.window.end,
        sections: report,
        nextActions: report.nextActions,
        generatorVersion: REVIEW_GENERATOR_VERSION,
      },
    })
    .run();

  return { id, report };
}

export function listReviews(userId: string, limit = 20) {
  return db
    .select({
      id: personalReviewReports.id,
      periodKind: personalReviewReports.periodKind,
      periodStart: personalReviewReports.periodStart,
      periodEnd: personalReviewReports.periodEnd,
      createdAt: personalReviewReports.createdAt,
      generatorVersion: personalReviewReports.generatorVersion,
      userGoals: personalReviewReports.userGoals,
    })
    .from(personalReviewReports)
    .where(eq(personalReviewReports.userId, userId))
    .orderBy(sql`${personalReviewReports.periodStart} desc`)
    .limit(limit)
    .all();
}

export function getReview(userId: string, id: string): ReviewReport {
  const row = db
    .select({ sections: personalReviewReports.sections })
    .from(personalReviewReports)
    .where(and(eq(personalReviewReports.id, id), eq(personalReviewReports.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That review does not exist.');
  return row.sections as ReviewReport;
}

export function setReviewGoals(userId: string, id: string, goals: string[]): void {
  const row = db
    .select({ id: personalReviewReports.id })
    .from(personalReviewReports)
    .where(and(eq(personalReviewReports.id, id), eq(personalReviewReports.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That review does not exist.');
  const cleaned = goals.map((g) => g.trim()).filter(Boolean).slice(0, 10);
  db.update(personalReviewReports)
    .set({ userGoals: cleaned })
    .where(eq(personalReviewReports.id, id))
    .run();
}

export function deleteReview(userId: string, id: string): void {
  const row = db
    .select({ id: personalReviewReports.id })
    .from(personalReviewReports)
    .where(and(eq(personalReviewReports.id, id), eq(personalReviewReports.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That review does not exist.');
  db.delete(personalReviewReports).where(eq(personalReviewReports.id, id)).run();
}

/* ------------------------------------------------------- dashboard summary */

export interface WellnessSummary {
  anythingSetUp: boolean;
  groomingRoutines: number;
  hygieneRoutines: number;
  wardrobeItems: number;
  expiredProducts: number;
  lowSupplies: number;
  patchTestsOpen: number;
  outfitPlannedToday: boolean;
  practiceThisWeek: number;
  checkinCadence: string;
}

/**
 * A compact, honest read for the Today page.
 *
 * It deliberately reports only facts — what exists and what has a date that has
 * passed. There is no streak, no completion percentage and no nudge, because the
 * dashboard is the one place a guilt metric would be unavoidable.
 */
export function wellnessSummary(
  userId: string,
  today = new Date().toISOString().slice(0, 10),
): WellnessSummary {
  const nowIso = `${today}T00:00:00.000Z`;
  const weekStart = addDays(today, -6);

  const groomingCount = num(
    db
      .select({ c: count() })
      .from(groomingRoutines)
      .where(and(eq(groomingRoutines.userId, userId), eq(groomingRoutines.active, true)))
      .all(),
  );
  const hygieneCount = num(
    db
      .select({ c: count() })
      .from(hygieneRoutines)
      .where(and(eq(hygieneRoutines.userId, userId), eq(hygieneRoutines.active, true)))
      .all(),
  );
  const items = num(
    db
      .select({ c: count() })
      .from(wardrobeItems)
      .where(and(eq(wardrobeItems.userId, userId), eq(wardrobeItems.archived, false)))
      .all(),
  );
  const expired = num(
    db
      .select({ c: count() })
      .from(skincareProducts)
      .where(
        and(
          eq(skincareProducts.userId, userId),
          eq(skincareProducts.archived, false),
          isNotNull(skincareProducts.expiresAt),
          lt(skincareProducts.expiresAt, nowIso),
        ),
      )
      .all(),
  );
  const low = num(
    db
      .select({ c: count() })
      .from(personalCareSupplies)
      .where(and(eq(personalCareSupplies.userId, userId), eq(personalCareSupplies.runningLow, true)))
      .all(),
  );
  const patch = num(
    db
      .select({ c: count() })
      .from(patchTests)
      .where(and(eq(patchTests.userId, userId), eq(patchTests.outcome, 'pending')))
      .all(),
  );
  const plannedToday = num(
    db
      .select({ c: count() })
      .from(outfitPlans)
      .where(and(eq(outfitPlans.userId, userId), eq(outfitPlans.date, today)))
      .all(),
  );
  const practice = num(
    db
      .select({ c: count() })
      .from(voicePracticeSessions)
      .where(
        and(
          eq(voicePracticeSessions.userId, userId),
          gte(voicePracticeSessions.date, weekStart),
          lte(voicePracticeSessions.date, today),
        ),
      )
      .all(),
  );
  const schedule = db
    .select({ cadence: checkinSchedules.cadence })
    .from(checkinSchedules)
    .where(eq(checkinSchedules.userId, userId))
    .get();

  return {
    anythingSetUp: groomingCount + hygieneCount + items + patch + practice > 0,
    groomingRoutines: groomingCount,
    hygieneRoutines: hygieneCount,
    wardrobeItems: items,
    expiredProducts: expired,
    lowSupplies: low,
    patchTestsOpen: patch,
    outfitPlannedToday: plannedToday > 0,
    practiceThisWeek: practice,
    checkinCadence: schedule?.cadence ?? 'off',
  };
}
