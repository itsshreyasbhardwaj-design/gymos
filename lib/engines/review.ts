/**
 * The unified personal review.
 *
 * Pure: it is handed counts that a service gathered and returns prose. It never sees
 * a photograph, a recording or a body measurement, so there is no path from here to
 * an appearance judgement — only to statements about what the user themselves
 * recorded.
 *
 * Two rules govern every string in this file:
 *
 *  1. No shaming. A week with nothing in it is a week with nothing in it. The review
 *     never implies the user let themselves down, and never leans on guilt to
 *     motivate. Where a count is low the copy is factual and offers one small,
 *     concrete next step.
 *  2. No invention. If a module holds no rows for the window, its section says so
 *     plainly rather than manufacturing an insight.
 */

export const REVIEW_GENERATOR_VERSION = 'review/1';

export type ReviewPeriodKind = 'weekly' | 'fortnightly' | 'monthly' | 'manual';

export interface ReviewWindow {
  kind: ReviewPeriodKind;
  /** Inclusive ISO date (YYYY-MM-DD). */
  start: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  end: string;
  days: number;
}

export interface TrainingFacts {
  scheduledSessions: number;
  completedSessions: number;
  skippedSessions: number;
  totalMinutes: number;
  setsLogged: number;
  distinctExercises: number;
}

export interface NutritionFacts {
  plannedMeals: number;
  /** Meals the user marked as cooked. GymOS does not ask what was eaten. */
  eatenMeals: number;
  swappedMeals: number;
  groceryListsGenerated: number;
  pantryItemsTracked: number;
}

export interface GroomingFacts {
  activeRoutines: number;
  routineLogs: number;
  productsTracked: number;
  productsExpiringSoon: number;
  productsExpired: number;
  patchTestsInProgress: number;
  upcomingAppointments: number;
  skincareJournalEntries: number;
}

export interface WardrobeFacts {
  itemsTracked: number;
  outfitsSaved: number;
  daysPlanned: number;
  wearsLogged: number;
  unworn90Days: number;
}

export interface VoiceFacts {
  practiceSessions: number;
  practiceSeconds: number;
  /** Only sessions where a script gave us a real word count. */
  measuredWpm: number[];
  selfReportedEntries: number;
  recordings: number;
}

export interface HygieneFacts {
  activeRoutines: number;
  tasksTracked: number;
  checkins: number;
}

export interface JournalFacts {
  entries: number;
  checkins: number;
  /** 'off' means the user has deliberately switched check-ins off. */
  cadence: string;
}

export interface ReviewFacts {
  training: TrainingFacts;
  nutrition: NutritionFacts;
  grooming: GroomingFacts;
  wardrobe: WardrobeFacts;
  voice: VoiceFacts;
  hygiene: HygieneFacts;
  journal: JournalFacts;
}

export interface ReviewFact {
  label: string;
  value: string;
}

export interface ReviewSection {
  key: keyof ReviewFacts;
  title: string;
  /** Empty when the module holds nothing for this window. */
  facts: ReviewFact[];
  observations: string[];
  /** Said only when there is genuinely nothing recorded. */
  emptyNote?: string;
}

export interface ReviewReport {
  generatorVersion: string;
  window: ReviewWindow;
  headline: string;
  sections: ReviewSection[];
  nextActions: string[];
  /** What this review deliberately does not do, shown in the UI. */
  limitations: string[];
}

export const ALL_SECTION_KEYS: (keyof ReviewFacts)[] = [
  'training',
  'nutrition',
  'grooming',
  'wardrobe',
  'voice',
  'hygiene',
  'journal',
];

const TITLES: Record<keyof ReviewFacts, string> = {
  training: 'Training',
  nutrition: 'Food',
  grooming: 'Grooming and skincare',
  wardrobe: 'Wardrobe',
  voice: 'Speaking practice',
  hygiene: 'Routines',
  journal: 'Journal',
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function minutesText(total: number): string {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return null;
  return Math.round((lower + upper) / 2);
}

/* ----------------------------------------------------------------- sections */

function trainingSection(f: TrainingFacts, window: ReviewWindow): ReviewSection {
  const facts: ReviewFact[] = [];
  const observations: string[] = [];

  if (f.scheduledSessions === 0 && f.completedSessions === 0) {
    return {
      key: 'training',
      title: TITLES.training,
      facts: [],
      observations: [],
      emptyNote: 'No sessions were scheduled or logged in this window.',
    };
  }

  facts.push({ label: 'Sessions completed', value: `${f.completedSessions} of ${f.scheduledSessions}` });
  if (f.totalMinutes > 0) facts.push({ label: 'Time training', value: minutesText(f.totalMinutes) });
  if (f.setsLogged > 0) facts.push({ label: 'Sets logged', value: String(f.setsLogged) });
  if (f.distinctExercises > 0) {
    facts.push({ label: 'Different exercises', value: String(f.distinctExercises) });
  }

  if (f.completedSessions === 0) {
    observations.push(
      `${plural(f.scheduledSessions, 'session was', 'sessions were')} on the calendar and none got logged. Weeks like this happen; the plan is still there when you are.`,
    );
  } else if (f.completedSessions >= f.scheduledSessions && f.scheduledSessions > 0) {
    observations.push(
      `You logged every session you had scheduled — ${plural(f.completedSessions, 'session')} over ${plural(window.days, 'day')}.`,
    );
  } else {
    observations.push(
      `You logged ${f.completedSessions} of ${plural(f.scheduledSessions, 'scheduled session')}.`,
    );
  }

  if (f.skippedSessions > 0) {
    observations.push(
      `${plural(f.skippedSessions, 'session was', 'sessions were')} marked skipped, which keeps your history accurate rather than leaving gaps.`,
    );
  }
  if (f.completedSessions > 0 && f.setsLogged === 0) {
    observations.push(
      'Sessions were completed without logged sets, so there is no load history to compare. Logging even one set per exercise gives progress something to work from.',
    );
  }
  return { key: 'training', title: TITLES.training, facts, observations };
}

function nutritionSection(f: NutritionFacts): ReviewSection {
  const total = f.plannedMeals + f.eatenMeals + f.groceryListsGenerated + f.pantryItemsTracked;
  if (total === 0) {
    return {
      key: 'nutrition',
      title: TITLES.nutrition,
      facts: [],
      observations: [],
      emptyNote: 'No meal plans, groceries or pantry items were recorded in this window.',
    };
  }

  const facts: ReviewFact[] = [];
  const observations: string[] = [];
  if (f.plannedMeals > 0) {
    facts.push({ label: 'Meals planned', value: String(f.plannedMeals) });
    facts.push({ label: 'Marked cooked', value: `${f.eatenMeals} of ${f.plannedMeals}` });
  }
  if (f.swappedMeals > 0) facts.push({ label: 'Meals swapped', value: String(f.swappedMeals) });
  if (f.groceryListsGenerated > 0) {
    facts.push({ label: 'Grocery lists', value: String(f.groceryListsGenerated) });
  }
  if (f.pantryItemsTracked > 0) {
    facts.push({ label: 'Pantry items', value: String(f.pantryItemsTracked) });
  }

  if (f.plannedMeals > 0 && f.eatenMeals === 0) {
    observations.push(
      'Meals were planned but none were marked as cooked. Marking them is optional — the plan works either way, and GymOS does not set calorie targets.',
    );
  } else if (f.eatenMeals > 0) {
    observations.push(`You marked ${plural(f.eatenMeals, 'planned meal')} as cooked.`);
  }
  if (f.swappedMeals > 0) {
    observations.push(
      `${plural(f.swappedMeals, 'meal was', 'meals were')} swapped for something else, which is what the swap is for.`,
    );
  }
  return { key: 'nutrition', title: TITLES.nutrition, facts, observations };
}

function groomingSection(f: GroomingFacts): ReviewSection {
  const total =
    f.activeRoutines +
    f.routineLogs +
    f.productsTracked +
    f.upcomingAppointments +
    f.skincareJournalEntries;
  if (total === 0) {
    return {
      key: 'grooming',
      title: TITLES.grooming,
      facts: [],
      observations: [],
      emptyNote: 'No grooming routines, products or appointments were recorded in this window.',
    };
  }

  const facts: ReviewFact[] = [];
  const observations: string[] = [];
  if (f.activeRoutines > 0) {
    facts.push({ label: 'Active routines', value: String(f.activeRoutines) });
    facts.push({ label: 'Times logged', value: String(f.routineLogs) });
  }
  if (f.productsTracked > 0) facts.push({ label: 'Products tracked', value: String(f.productsTracked) });
  if (f.skincareJournalEntries > 0) {
    facts.push({ label: 'Journal entries', value: String(f.skincareJournalEntries) });
  }
  if (f.upcomingAppointments > 0) {
    facts.push({ label: 'Upcoming appointments', value: String(f.upcomingAppointments) });
  }

  if (f.activeRoutines > 0 && f.routineLogs === 0) {
    observations.push(
      'Routines are set up but none were logged. Logging is only there to help you notice patterns — skipping it costs you nothing.',
    );
  } else if (f.routineLogs > 0) {
    observations.push(`You logged a grooming routine ${plural(f.routineLogs, 'time')}.`);
  }
  if (f.productsExpired > 0) {
    observations.push(
      `${plural(f.productsExpired, 'product has', 'products have')} passed the date you recorded. Worth checking before the next use.`,
    );
  }
  if (f.productsExpiringSoon > 0) {
    observations.push(`${plural(f.productsExpiringSoon, 'product is', 'products are')} due to expire soon.`);
  }
  if (f.patchTestsInProgress > 0) {
    observations.push(
      `${plural(f.patchTestsInProgress, 'patch test is', 'patch tests are')} still inside its observation window, so there is no result yet.`,
    );
  }
  return { key: 'grooming', title: TITLES.grooming, facts, observations };
}

function wardrobeSection(f: WardrobeFacts): ReviewSection {
  const total = f.itemsTracked + f.outfitsSaved + f.daysPlanned + f.wearsLogged;
  if (total === 0) {
    return {
      key: 'wardrobe',
      title: TITLES.wardrobe,
      facts: [],
      observations: [],
      emptyNote: 'Nothing was added to the wardrobe or planned in this window.',
    };
  }

  const facts: ReviewFact[] = [];
  const observations: string[] = [];
  if (f.itemsTracked > 0) facts.push({ label: 'Items in wardrobe', value: String(f.itemsTracked) });
  if (f.outfitsSaved > 0) facts.push({ label: 'Saved outfits', value: String(f.outfitsSaved) });
  if (f.daysPlanned > 0) facts.push({ label: 'Days planned', value: String(f.daysPlanned) });
  if (f.wearsLogged > 0) facts.push({ label: 'Wears logged', value: String(f.wearsLogged) });

  if (f.daysPlanned > 0) observations.push(`You planned outfits for ${plural(f.daysPlanned, 'day')}.`);
  if (f.unworn90Days > 0) {
    observations.push(
      `${plural(f.unworn90Days, 'item has', 'items have')} not been worn in the last 90 days, if you want to rotate them back in.`,
    );
  }
  return { key: 'wardrobe', title: TITLES.wardrobe, facts, observations };
}

function voiceSection(f: VoiceFacts): ReviewSection {
  if (f.practiceSessions === 0) {
    return {
      key: 'voice',
      title: TITLES.voice,
      facts: [],
      observations: [],
      emptyNote: 'No speaking practice was recorded in this window.',
    };
  }

  const facts: ReviewFact[] = [
    { label: 'Practice sessions', value: String(f.practiceSessions) },
    { label: 'Time practising', value: minutesText(Math.round(f.practiceSeconds / 60)) },
  ];
  const observations: string[] = [
    `You practised ${plural(f.practiceSessions, 'time')}, for ${minutesText(Math.round(f.practiceSeconds / 60))} in total.`,
  ];

  const typical = median(f.measuredWpm);
  if (typical !== null) {
    facts.push({ label: 'Typical measured pace', value: `${typical} words/min` });
    observations.push(
      `Across the sessions where you read a script, your measured pace was about ${typical} words a minute. That figure comes from the script's word count and the recording's length — nothing was transcribed.`,
    );
  } else {
    observations.push(
      'None of these sessions used a script, so there is no words-per-minute figure: GymOS has no speech recognition and will not guess one.',
    );
  }
  if (f.selfReportedEntries > 0) {
    facts.push({ label: 'Your own notes', value: String(f.selfReportedEntries) });
  }
  if (f.recordings > 0) facts.push({ label: 'Recordings kept', value: String(f.recordings) });
  return { key: 'voice', title: TITLES.voice, facts, observations };
}

function hygieneSection(f: HygieneFacts): ReviewSection {
  if (f.activeRoutines === 0 && f.checkins === 0) {
    return {
      key: 'hygiene',
      title: TITLES.hygiene,
      facts: [],
      observations: [],
      emptyNote: 'No routines were set up or checked in during this window.',
    };
  }
  const facts: ReviewFact[] = [
    { label: 'Active routines', value: String(f.activeRoutines) },
    { label: 'Tasks tracked', value: String(f.tasksTracked) },
    { label: 'Check-ins', value: String(f.checkins) },
  ];
  const observations: string[] = [];
  if (f.checkins === 0) {
    observations.push(
      'Routines exist but nothing was checked in. The reminders are there if you want them and silent if you do not.',
    );
  } else {
    observations.push(`You checked in ${plural(f.checkins, 'time')} across your routines.`);
  }
  return { key: 'hygiene', title: TITLES.hygiene, facts, observations };
}

function journalSection(f: JournalFacts): ReviewSection {
  if (f.entries === 0 && f.checkins === 0) {
    return {
      key: 'journal',
      title: TITLES.journal,
      facts: [],
      observations: [],
      emptyNote:
        f.cadence === 'off'
          ? 'Check-ins are switched off, and nothing was written in the journal.'
          : 'Nothing was written or checked in during this window.',
    };
  }
  const facts: ReviewFact[] = [];
  if (f.entries > 0) facts.push({ label: 'Journal entries', value: String(f.entries) });
  if (f.checkins > 0) facts.push({ label: 'Check-ins', value: String(f.checkins) });
  const observations: string[] = [];
  if (f.entries > 0) observations.push(`You wrote ${plural(f.entries, 'journal entry', 'journal entries')}.`);
  if (f.checkins > 0) {
    observations.push(
      `${plural(f.checkins, 'check-in was', 'check-ins were')} recorded. GymOS stores these for you to look back on and does not analyse them.`,
    );
  }
  return { key: 'journal', title: TITLES.journal, facts, observations };
}

/* ------------------------------------------------------------------ report */

function headlineFor(facts: ReviewFacts, window: ReviewWindow, active: number): string {
  const label =
    window.kind === 'weekly'
      ? 'week'
      : window.kind === 'fortnightly'
        ? 'fortnight'
        : window.kind === 'monthly'
          ? 'month'
          : `${plural(window.days, 'day')} window`;

  if (active === 0) return `Nothing was recorded this ${label}. The app will be here when you come back.`;
  if (facts.training.completedSessions > 0 && active >= 3) {
    return `A ${label} with ${plural(facts.training.completedSessions, 'session')} logged and activity across ${plural(active, 'area')}.`;
  }
  if (facts.training.completedSessions > 0) {
    return `${plural(facts.training.completedSessions, 'session')} logged this ${label}.`;
  }
  return `Activity in ${plural(active, 'area')} this ${label}, with no training logged.`;
}

/**
 * Up to three small, concrete steps — never a to-do list, and never framed as making
 * up for something. Ordered by how directly the data points at them.
 */
function nextActionsFor(facts: ReviewFacts, sections: ReviewSection[]): string[] {
  const actions: string[] = [];

  if (facts.grooming.productsExpired > 0) {
    actions.push('Check the products past their date in Skincare and replace or remove them.');
  }
  if (facts.training.scheduledSessions > 0 && facts.training.completedSessions === 0) {
    actions.push('Open Workouts and move one session to a day that actually suits you.');
  } else if (facts.training.completedSessions > 0 && facts.training.setsLogged === 0) {
    actions.push('Log one set per exercise next session so Progress has something to chart.');
  }
  if (facts.voice.practiceSessions > 0 && facts.voice.measuredWpm.length === 0) {
    actions.push('Try a scripted practice next time — it is the only way GymOS can measure your pace.');
  }
  if (facts.wardrobe.unworn90Days > 0 && actions.length < 3) {
    actions.push('Plan one outfit around something you have not worn in a while.');
  }
  if (actions.length === 0) {
    const empty = sections.find((s) => s.emptyNote);
    if (empty) actions.push(`If you want to, try one thing in ${empty.title.toLowerCase()} this time.`);
  }
  return actions.slice(0, 3);
}

const LIMITATIONS = [
  'Every number here comes from something you recorded. Nothing is estimated or inferred.',
  'This review never looks at your photographs or recordings, and never judges how you look or sound.',
  'It is not a health assessment. For anything medical, see a qualified professional.',
];

export function buildReview(
  facts: ReviewFacts,
  window: ReviewWindow,
  includedSections: (keyof ReviewFacts)[] = ALL_SECTION_KEYS,
): ReviewReport {
  const wanted = includedSections.length > 0 ? includedSections : ALL_SECTION_KEYS;
  const builders: Record<keyof ReviewFacts, () => ReviewSection> = {
    training: () => trainingSection(facts.training, window),
    nutrition: () => nutritionSection(facts.nutrition),
    grooming: () => groomingSection(facts.grooming),
    wardrobe: () => wardrobeSection(facts.wardrobe),
    voice: () => voiceSection(facts.voice),
    hygiene: () => hygieneSection(facts.hygiene),
    journal: () => journalSection(facts.journal),
  };

  const sections = ALL_SECTION_KEYS.filter((key) => wanted.includes(key)).map((key) => builders[key]());
  const active = sections.filter((s) => !s.emptyNote).length;

  return {
    generatorVersion: REVIEW_GENERATOR_VERSION,
    window,
    headline: headlineFor(facts, window, active),
    sections,
    nextActions: nextActionsFor(facts, sections),
    limitations: LIMITATIONS,
  };
}

/** Window boundaries for a cadence, derived from a given 'today'. Pure. */
export function windowFor(kind: ReviewPeriodKind, today: string, customDays = 7): ReviewWindow {
  const days = kind === 'weekly' ? 7 : kind === 'fortnightly' ? 14 : kind === 'monthly' ? 30 : customDays;
  const end = today;
  const endDate = new Date(`${today}T00:00:00Z`);
  const startDate = new Date(endDate.getTime() - (days - 1) * 86_400_000);
  const start = startDate.toISOString().slice(0, 10);
  return { kind, start, end, days };
}
