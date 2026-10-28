import 'server-only';
import { and, count, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  exerciseLogs,
  workoutSessions,
  userProfiles,
  preferences,
  groomingRoutines,
  hygieneRoutines,
  skincareProducts,
  personalCareSupplies,
  outfitPlans,
  wardrobeItems,
  voicePracticeSessions,
  checkinSchedules,
} from '@/lib/db/schema';
import { detectIntent, FITBRAIN_CAPABILITIES, type IntentId } from '@/lib/engines/fitbrain-intents';
import { EXERCISE_CATALOG, EXERCISE_BY_ID } from '@/lib/content/exercises';
import { MUSCLE_LABELS, MOVEMENT_PATTERN_LABELS } from '@/lib/content/exercise-types';
import { RECIPE_CATALOG } from '@/lib/content/recipes';
import { equipmentRequirementSummary, checkEquipment, describeMissing } from '@/lib/engines/equipment';
import { findSubstitutes } from '@/lib/engines/substitution';
import { buildLimitationFilter, MEDICAL_DISCLAIMER } from '@/lib/engines/programming';
import { adaptToTime } from '@/lib/engines/realitysync';
import { filterRecipes } from '@/lib/engines/nutrition';
import { activeEquipmentSet } from './equipment';
import { getActivePlan, getPreference, setPreference, loadPlanningProfile, plannedExercisesToGenerated } from './plans';
import { listSessions, missedSessions, nextSession } from './sessions';
import { getNutritionPrefs, getActiveMealPlan } from './nutrition';
import { previewReview, getReviewPreferences } from './review';
import { mediaUsage, listGrants, isDevelopmentKey } from './media';
import { addDays } from '@/lib/engines/nutrition';
import type { Plan } from '@/lib/engines/entitlements';
import { checkEntitlement } from '@/lib/engines/entitlements';

export const FITBRAIN_VERSION = 'fitbrain-1.0.0-rules';

/**
 * FitBrain is a GUIDED fitness planning assistant, not a generative chatbot.
 *
 * Everything it says is produced by deterministic code reading the user's own records
 * and the reviewed content library. There is no language model in this build. The
 * provider interface below exists so one can be added later, but it can only ever
 * phrase answers — it cannot bypass the planning engines or the safety rules.
 */
export interface LanguageModelProvider {
  readonly id: string;
  readonly configured: boolean;
  /** Rephrases an already-computed answer. It never decides what the answer is. */
  rephrase(answer: FitBrainAnswer): Promise<string>;
}

export const NO_LLM_PROVIDER: LanguageModelProvider = {
  id: 'none',
  configured: false,
  async rephrase(answer) {
    return answer.text;
  },
};

export function activeProvider(): LanguageModelProvider {
  // Intentionally always the no-op provider: no API keys are required or used.
  return NO_LLM_PROVIDER;
}

export interface FitBrainSource {
  kind: | 'exercise'
    | 'recipe'
    | 'plan'
    | 'session'
    | 'preference'
    | 'feature'
    | 'equipment'
    // Wellness answers cite the user's own rows rather than the content library.
    | 'user_record';
  label: string;
  href?: string;
}

export interface FitBrainAction {
  kind: 'navigate' | 'set_preference' | 'propose_adaptation' | 'none';
  label: string;
  href?: string;
  payload?: Record<string, unknown>;
}

export interface FitBrainAnswer {
  intent: IntentId;
  confidence: number;
  text: string;
  bullets: string[];
  sources: FitBrainSource[];
  actions: FitBrainAction[];
  /** Always true in this build: every answer is computed, never generated. */
  grounded: true;
  disclaimer?: string;
  version: string;
}

export interface AskOptions {
  userId: string;
  plan: Plan;
  query: string;
}

export function ask({ userId, plan, query }: AskOptions): FitBrainAnswer {
  const usage = fitbrainUsageToday(userId);
  const entitlement = checkEntitlement(plan, 'fitbrain_actions', usage);
  if (!entitlement.allowed) {
    return answer('app_help', 0, entitlement.reason ?? 'Daily limit reached.', {
      bullets: ['GymOS Pro removes the daily limit on FitBrain.'],
      actions: [{ kind: 'navigate', label: 'See plans', href: '/pricing' }],
    });
  }
  recordFitbrainUse(userId);

  const match = detectIntent(query);
  switch (match.id) {
    case 'safety_redirect':
      return safetyRedirect(match.confidence);
    case 'explain_plan':
      return explainPlan(userId, match.confidence);
    case 'find_exercise':
      return findExercise(userId, query, match.confidence);
    case 'explain_substitution':
      return explainSubstitution(userId, query, match.confidence);
    case 'exercise_instructions':
      return exerciseInstructions(query, match.confidence);
    case 'equipment_question':
      return equipmentAnswer(userId, query, match.confidence);
    case 'shorter_session':
      return shorterSession(userId, query, match.confidence);
    case 'change_schedule':
      return scheduleAnswer(userId, match.confidence);
    case 'summarise_history':
      return summariseHistory(userId, match.confidence);
    case 'find_recipe':
      return findRecipe(userId, query, match.confidence);
    case 'explain_meal_swap':
      return mealSwapAnswer(userId, match.confidence);
    case 'set_preference':
      return setPreferenceAnswer(userId, query, match.confidence);
    case 'app_help':
      return appHelp(query, match.confidence);
    case 'appearance_redirect':
      return appearanceRedirect(match.confidence);
    case 'skin_concern_redirect':
      return skinConcernRedirect(match.confidence);
    case 'voice_judgement_redirect':
      return voiceJudgementRedirect(match.confidence);
    case 'wellness_overview':
      return wellnessOverview(userId, match.confidence);
    case 'routine_due':
      return routineDue(userId, match.confidence);
    case 'outfit_question':
      return outfitAnswer(userId, match.confidence);
    case 'voice_practice':
      return voicePracticeAnswer(userId, match.confidence);
    case 'media_privacy':
      return mediaPrivacyAnswer(userId, match.confidence);
    default:
      return unknownAnswer();
  }
}

function answer(
  intent: IntentId,
  confidence: number,
  text: string,
  extra: Partial<Omit<FitBrainAnswer, 'intent' | 'confidence' | 'text' | 'grounded' | 'version'>> = {},
): FitBrainAnswer {
  return {
    intent,
    confidence,
    text,
    bullets: extra.bullets ?? [],
    sources: extra.sources ?? [],
    actions: extra.actions ?? [],
    grounded: true,
    disclaimer: extra.disclaimer,
    version: FITBRAIN_VERSION,
  };
}

/* ------------------------------------------------------------------ handlers */

function safetyRedirect(confidence: number): FitBrainAnswer {
  return answer(
    'safety_redirect',
    confidence,
    'That is outside what GymOS can help with.',
    {
      bullets: [
        'GymOS cannot diagnose anything, suggest treatment, or tell you whether it is safe to train through a symptom.',
        'If something hurts, stop that exercise. Do not train through pain.',
        'Please speak to a doctor, physiotherapist or other qualified professional.',
        'What GymOS can do: mark a limitation in your profile so plans stop including the movements that load that area, or ease off your next session.',
      ],
      actions: [
        { kind: 'navigate', label: 'Update limitations in your profile', href: '/settings/profile' },
      ],
      disclaimer: MEDICAL_DISCLAIMER,
    },
  );
}

/* ---------------------------------------------------- wellness: refusals */

/**
 * The appearance refusal.
 *
 * This is a design decision, not a missing feature: GymOS will not score how someone
 * looks, and saying so plainly is more useful than a vague deflection. It then offers
 * the thing it can actually do — keep the user's own photographs for them.
 */
function appearanceRedirect(confidence: number): FitBrainAnswer {
  return answer(
    'appearance_redirect',
    confidence,
    'GymOS does not rate how anyone looks, and it is not going to start.',
    {
      bullets: [
        'There is no attractiveness score, body rating or body-fat estimate anywhere in this app, and no database column that could hold one.',
        'Nothing in your photo journal is analysed. GymOS stores your photographs, encrypted, so that you can look back at them yourself.',
        'A number from an app would not tell you anything true about your body, and comparing yourself to an idealised one is not something GymOS will help with.',
        'What it can do: keep a private, dated photo journal, track measurements you choose to record yourself, and show your training and food history.',
      ],
      actions: [
        { kind: 'navigate', label: 'Open your private journal', href: '/wellness/journal' },
        { kind: 'navigate', label: 'See what is stored and delete it', href: '/settings/media-privacy' },
      ],
    },
  );
}

function skinConcernRedirect(confidence: number): FitBrainAnswer {
  return answer(
    'skin_concern_redirect',
    confidence,
    'GymOS cannot tell you what is happening with your skin.',
    {
      bullets: [
        'It does not diagnose skin conditions, from a photograph or a description, and it does not recommend prescription treatment.',
        'A photograph is not a medical measurement, and GymOS never presents one as though it were.',
        'For anything persistent, painful, spreading or changing, please see a doctor or dermatologist.',
        'What GymOS can do: keep a dated record of products you used and how your skin felt, which is genuinely useful to show a professional.',
      ],
      actions: [
        { kind: 'navigate', label: 'Open your skincare journal', href: '/skincare' },
        { kind: 'navigate', label: 'Record a patch test', href: '/skincare' },
      ],
      disclaimer: MEDICAL_DISCLAIMER,
    },
  );
}

function voiceJudgementRedirect(confidence: number): FitBrainAnswer {
  return answer(
    'voice_judgement_redirect',
    confidence,
    'GymOS does not judge voices, and it cannot tell you what you said.',
    {
      bullets: [
        'There is no speech recognition in this build, so nothing you record is transcribed. GymOS will not pretend otherwise or guess at the words.',
        'It also does not rate a voice as good or bad, or compare pitch against any ideal.',
        'What it does measure, from the recording itself: how long you spoke, how many pauses you took, the longest one, and your speaking-to-silence ratio.',
        'Words per minute is measured only when you read one of the practice scripts, because then the word count is actually known.',
      ],
      actions: [{ kind: 'navigate', label: 'Open speaking practice', href: '/voice/practice' }],
    },
  );
}

/* -------------------------------------------------- wellness: capabilities */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function wellnessOverview(userId: string, confidence: number): FitBrainAnswer {
  const prefs = getReviewPreferences(userId);
  const cadence = prefs.cadence === 'manual' ? 'weekly' : prefs.cadence;
  const report = previewReview(userId, cadence, todayIso());
  const active = report.sections.filter((s) => !s.emptyNote);

  if (active.length === 0) {
    return answer('wellness_overview', confidence, report.headline, {
      bullets: [
        'There is nothing recorded in the current window, so there is nothing to summarise. GymOS is not going to pad that out.',
      ],
      actions: [{ kind: 'navigate', label: 'Open your review', href: '/reviews' }],
    });
  }

  return answer('wellness_overview', confidence, report.headline, {
    bullets: [
      ...active.flatMap((s) => s.observations.slice(0, 1).map((o) => `${s.title}: ${o}`)),
      ...report.nextActions,
    ],
    sources: [{ kind: 'user_record', label: `Your records, ${report.window.start} to ${report.window.end}` }],
    actions: [{ kind: 'navigate', label: 'Open the full review', href: '/reviews' }],
  });
}

function routineDue(userId: string, confidence: number): FitBrainAnswer {
  const today = todayIso();
  const nowIso = new Date().toISOString();

  const grooming = db
    .select({ name: groomingRoutines.name, slot: groomingRoutines.slot })
    .from(groomingRoutines)
    .where(and(eq(groomingRoutines.userId, userId), eq(groomingRoutines.active, true)))
    .all();
  const hygiene = db
    .select({ name: hygieneRoutines.name, cadence: hygieneRoutines.cadence })
    .from(hygieneRoutines)
    .where(and(eq(hygieneRoutines.userId, userId), eq(hygieneRoutines.active, true)))
    .all();
  const expired = db
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
    .all();
  const low = db
    .select({ c: count() })
    .from(personalCareSupplies)
    .where(and(eq(personalCareSupplies.userId, userId), eq(personalCareSupplies.runningLow, true)))
    .all();

  const expiredCount = expired[0]?.c ?? 0;
  const lowCount = low[0]?.c ?? 0;

  if (grooming.length === 0 && hygiene.length === 0) {
    return answer(
      'routine_due',
      confidence,
      'You have not set up any grooming or hygiene routines yet, so nothing is due.',
      {
        bullets: [
          'A routine is just a named list of steps and the days you want it on. GymOS reminds you if you ask it to and stays quiet if you do not.',
          'Nothing here is scored, and skipping a day is not recorded as a failure.',
        ],
        actions: [
          { kind: 'navigate', label: 'Set up a grooming routine', href: '/grooming/routines' },
          { kind: 'navigate', label: 'Set up a hygiene routine', href: '/hygiene' },
        ],
      },
    );
  }

  const bullets: string[] = [];
  if (grooming.length > 0) {
    bullets.push(
      `Grooming: ${grooming.map((r) => `${r.name} (${r.slot})`).join(', ')}. The Grooming page shows which of these falls on ${today}.`,
    );
  }
  if (hygiene.length > 0) {
    bullets.push(
      `Routines: ${hygiene.map((r) => `${r.name} (${r.cadence})`).join(', ')}. The Hygiene page works out what is due from your cadence and last check-in.`,
    );
  }
  if (expiredCount > 0) {
    bullets.push(`${expiredCount} skincare product${expiredCount === 1 ? '' : 's'} are past the date you recorded.`);
  }
  if (lowCount > 0) {
    bullets.push(`${lowCount} suppl${lowCount === 1 ? 'y is' : 'ies are'} marked as running low.`);
  }

  return answer('routine_due', confidence, 'Here is what you have set up.', {
    bullets,
    sources: [{ kind: 'user_record', label: 'Your own routines and products' }],
    actions: [
      { kind: 'navigate', label: 'Open Grooming', href: '/grooming' },
      { kind: 'navigate', label: 'Open Hygiene', href: '/hygiene' },
    ],
  });
}

function outfitAnswer(userId: string, confidence: number): FitBrainAnswer {
  const today = todayIso();
  const planned = db
    .select({ occasion: outfitPlans.occasion, status: outfitPlans.status, note: outfitPlans.note })
    .from(outfitPlans)
    .where(and(eq(outfitPlans.userId, userId), eq(outfitPlans.date, today)))
    .all();
  const items = db
    .select({ c: count() })
    .from(wardrobeItems)
    .where(and(eq(wardrobeItems.userId, userId), eq(wardrobeItems.archived, false)))
    .all();
  const itemCount = items[0]?.c ?? 0;

  if (itemCount === 0) {
    return answer(
      'outfit_question',
      confidence,
      'Your wardrobe is empty, so there is nothing for GymOS to suggest from.',
      {
        bullets: [
          'Add a few items — colour, category, how formal, how warm — and the planner can put combinations together.',
          'Suggestions are based on colour harmony, formality and the weather only. GymOS does not comment on your body or suggest hiding anything.',
        ],
        actions: [{ kind: 'navigate', label: 'Add wardrobe items', href: '/wardrobe' }],
      },
    );
  }

  if (planned.length > 0) {
    return answer('outfit_question', confidence, `You already have an outfit planned for today.`, {
      bullets: planned.map(
        (p) => `${p.occasion || 'No occasion set'} — ${p.status}${p.note ? `. ${p.note}` : ''}`,
      ),
      sources: [{ kind: 'user_record', label: 'Your outfit planner' }],
      actions: [{ kind: 'navigate', label: 'Open the planner', href: '/wardrobe/planner' }],
    });
  }

  return answer(
    'outfit_question',
    confidence,
    `Nothing is planned for today, and you have ${itemCount} item${itemCount === 1 ? '' : 's'} to work with.`,
    {
      bullets: [
        'The outfit builder scores combinations on colour harmony, how formal the occasion is, and how warm it needs to be, and tells you why each one works.',
        'It works entirely offline — there are no shopping integrations and nothing is recommended for you to buy.',
      ],
      sources: [{ kind: 'user_record', label: 'Your wardrobe' }],
      actions: [{ kind: 'navigate', label: 'Build an outfit', href: '/wardrobe/outfits' }],
    },
  );
}

function voicePracticeAnswer(userId: string, confidence: number): FitBrainAnswer {
  const recent = db
    .select({
      date: voicePracticeSessions.date,
      wpm: voicePracticeSessions.wordsPerMinute,
      scriptWordCount: voicePracticeSessions.scriptWordCount,
      durationSeconds: voicePracticeSessions.durationSeconds,
    })
    .from(voicePracticeSessions)
    .where(eq(voicePracticeSessions.userId, userId))
    .orderBy(desc(voicePracticeSessions.date))
    .limit(5)
    .all();

  const measured = recent.filter((r) => r.wpm !== null && (r.scriptWordCount ?? 0) > 0);
  const bullets: string[] = [
    'There is no speech model in this build, so nothing is transcribed and no voice is judged.',
    'Measured from the audio: duration, pause count, longest pause and speaking ratio. Words per minute only when you read a script, because that is the only time the word count is known.',
    'Filler words are counted by you tapping during playback, and are labelled as your own count, not a measurement.',
  ];

  if (recent.length === 0) {
    return answer('voice_practice', confidence, 'You have not recorded any practice yet.', {
      bullets: [
        'Pick a script, read it, and GymOS will measure what it honestly can.',
        ...bullets,
        'You can also practise with just the script and a timer, without recording anything at all.',
      ],
      actions: [{ kind: 'navigate', label: 'Start practising', href: '/voice/practice' }],
    });
  }

  const paceLine =
    measured.length > 0
      ? `Your last scripted session measured ${measured[0]?.wpm} words a minute.`
      : 'None of your recent sessions used a script, so there is no pace figure for them.';

  return answer(
    'voice_practice',
    confidence,
    `You have ${recent.length} recent practice session${recent.length === 1 ? '' : 's'}. ${paceLine}`,
    {
      bullets,
      sources: [{ kind: 'user_record', label: 'Your practice sessions' }],
      actions: [
        { kind: 'navigate', label: 'Practise again', href: '/voice/practice' },
        { kind: 'navigate', label: 'See your history', href: '/voice/history' },
      ],
    },
  );
}

function mediaPrivacyAnswer(userId: string, confidence: number): FitBrainAnswer {
  const usage = mediaUsage(userId);
  const grants = listGrants(userId).filter((g) => !g.revokedAt);
  const schedule = db
    .select({ cadence: checkinSchedules.cadence })
    .from(checkinSchedules)
    .where(eq(checkinSchedules.userId, userId))
    .get();

  const bullets = [
    `You have ${usage.count} private file${usage.count === 1 ? '' : 's'} stored, ${(usage.bytes / 1024 / 1024).toFixed(1)} MB in total.`,
    'They are encrypted with AES-256-GCM on disk and are only ever served through an authenticated request that checks you own the file. There is no public address for any of them.',
    'Image metadata, including GPS coordinates, is removed before the file is written.',
    grants.length === 0
      ? 'Nothing is shared with anyone. You have no active share links.'
      : `${grants.length} active share${grants.length === 1 ? '' : 's'}, which you can revoke immediately.`,
    `Photo check-in reminders are currently ${schedule?.cadence ?? 'off'}.`,
    'Turning off a media permission deletes everything collected under it, straight away, and records the deletion so you can verify it.',
    'Nothing is used for advertising, and nothing is used to train any model.',
  ];

  if (isDevelopmentKey()) {
    bullets.push(
      'This install is using a locally generated development key held in its data directory, not a key you supplied. That is fine for your own machine, and worth changing before anyone else runs it.',
    );
  }

  return answer('media_privacy', confidence, 'Here is exactly what GymOS holds and who can see it.', {
    bullets,
    sources: [{ kind: 'user_record', label: 'Your media store' }],
    actions: [
      { kind: 'navigate', label: 'Open media privacy', href: '/settings/media-privacy' },
      { kind: 'navigate', label: 'Export everything', href: '/settings/privacy' },
    ],
  });
}

function explainPlan(userId: string, confidence: number): FitBrainAnswer {
  const plan = getActivePlan(userId);
  if (!plan) {
    return answer('explain_plan', confidence, 'You do not have an active plan yet.', {
      actions: [{ kind: 'navigate', label: 'Build my plan', href: '/workouts/plan' }],
    });
  }
  const trainingDays = plan.days.filter((d) => !d.isRest);
  const bullets = [...plan.explanation];
  for (const day of trainingDays) {
    bullets.push(
      `${day.label}: ${day.exercises.length} exercise(s) — ${day.exercises.map((e) => e.name).join(', ')}.`,
    );
  }
  return answer(
    'explain_plan',
    confidence,
    `Your plan "${plan.name}" is a ${plan.splitKind.replace(/_/g, ' ')} split over ${trainingDays.length} training day(s), generated by ${plan.generatorVersion}.`,
    {
      bullets,
      sources: [{ kind: 'plan', label: plan.name, href: '/workouts/plan' }],
      actions: [{ kind: 'navigate', label: 'Open plan', href: '/workouts/plan' }],
    },
  );
}

function extractMuscleOrPattern(query: string): { muscles: string[]; patterns: string[] } {
  const q = query.toLowerCase();
  const muscles = Object.keys(MUSCLE_LABELS).filter(
    (m) => q.includes(m.replace(/_/g, ' ')) || q.includes((MUSCLE_LABELS[m] ?? '').toLowerCase()),
  );
  const patterns = Object.keys(MOVEMENT_PATTERN_LABELS).filter((p) => q.includes(p.replace(/_/g, ' ')));
  return { muscles, patterns };
}

function findExercise(userId: string, query: string, confidence: number): FitBrainAnswer {
  const { set, profileName } = activeEquipmentSet(userId);
  const profile = safeProfile(userId);
  const lim = buildLimitationFilter(profile.limitations);
  const disliked = new Set(getPreference<string[]>(userId, 'disliked_exercises', []));
  const { muscles, patterns } = extractMuscleOrPattern(query);

  const matches = EXERCISE_CATALOG.filter((ex) => {
    if (disliked.has(ex.id) || lim.excludedExerciseIds.has(ex.id)) return false;
    if (lim.excludedPatterns.has(ex.pattern)) return false;
    if (!checkEquipment(ex, set).ok) return false;
    if (muscles.length > 0 && !muscles.some((m) => ex.primary.includes(m) || (ex.secondary ?? []).includes(m))) {
      return false;
    }
    if (patterns.length > 0 && !patterns.includes(ex.pattern)) return false;
    if (muscles.length === 0 && patterns.length === 0) {
      return query
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.length > 3 && (ex.name.toLowerCase().includes(w) || (ex.alias ?? []).some((a) => a.toLowerCase().includes(w))));
    }
    return true;
  }).slice(0, 10);

  if (matches.length === 0) {
    return answer(
      'find_exercise',
      confidence,
      `Nothing in the library matches that and works with your ${profileName ?? 'current'} equipment profile.`,
      {
        bullets: [
          'Try naming a muscle group (for example "upper back") or a movement ("hinge").',
          'Adding equipment to your profile will open up more options.',
        ],
        actions: [{ kind: 'navigate', label: 'Edit equipment', href: '/equipment' }],
      },
    );
  }

  return answer(
    'find_exercise',
    confidence,
    `${matches.length} exercise(s) in your library work with your ${profileName ?? 'current'} equipment:`,
    {
      bullets: matches.map(
        (ex) =>
          `${ex.name} — ${MOVEMENT_PATTERN_LABELS[ex.pattern]}, works ${ex.primary.map((m) => MUSCLE_LABELS[m] ?? m).join(', ')}. Needs: ${equipmentRequirementSummary(ex).join(', ')}.`,
      ),
      sources: matches.map((ex) => ({ kind: 'exercise' as const, label: ex.name, href: `/exercises/${ex.id}` })),
      actions: [{ kind: 'navigate', label: 'Browse all exercises', href: '/exercises' }],
    },
  );
}

function matchExerciseByName(query: string) {
  const q = query.toLowerCase();
  const scored = EXERCISE_CATALOG.map((ex) => {
    let score = 0;
    if (q.includes(ex.name.toLowerCase())) score += 100;
    for (const alias of ex.alias ?? []) if (q.includes(alias.toLowerCase())) score += 80;
    const words = ex.name.toLowerCase().split(/\s+/);
    score += words.filter((w) => w.length > 3 && q.includes(w)).length * 10;
    return { ex, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.ex;
}

function explainSubstitution(userId: string, query: string, confidence: number): FitBrainAnswer {
  const original = matchExerciseByName(query);
  if (!original) {
    return answer('explain_substitution', confidence, 'Which exercise do you want to replace?', {
      bullets: ['Name the exercise, for example "substitute for lat pulldown".'],
    });
  }
  const { set, profileName } = activeEquipmentSet(userId);
  const profile = safeProfile(userId);
  const lim = buildLimitationFilter(profile.limitations);
  const result = findSubstitutes(original, {
    availableEquipment: set,
    ageBand: profile.ageBand,
    level: profile.experience,
    excludedExerciseIds: new Set([
      ...lim.excludedExerciseIds,
      ...getPreference<string[]>(userId, 'disliked_exercises', []),
    ]),
    excludedPatterns: lim.excludedPatterns,
  });

  if (result.options.length === 0) {
    return answer(
      'explain_substitution',
      confidence,
      `There is no good replacement for ${original.name} with your ${profileName ?? 'current'} equipment.`,
      {
        bullets: [result.noMatchReason ?? ''],
        sources: [{ kind: 'exercise', label: original.name, href: `/exercises/${original.id}` }],
      },
    );
  }

  return answer(
    'explain_substitution',
    confidence,
    `Replacements for ${original.name} (${MOVEMENT_PATTERN_LABELS[original.pattern]}) that work with your equipment:`,
    {
      bullets: result.options.map(
        (o) =>
          `${o.exercise.name} — ${o.reason}${o.samePattern ? '' : ' (partial match: different pattern)'} Needs: ${equipmentRequirementSummary(o.exercise).join(', ')}.`,
      ),
      sources: [
        { kind: 'exercise', label: original.name, href: `/exercises/${original.id}` },
        ...result.options.map((o) => ({
          kind: 'exercise' as const,
          label: o.exercise.name,
          href: `/exercises/${o.exercise.id}`,
        })),
      ],
    },
  );
}

function exerciseInstructions(query: string, confidence: number): FitBrainAnswer {
  const ex = matchExerciseByName(query);
  if (!ex) {
    return answer('exercise_instructions', confidence, 'Which exercise did you mean?', {
      bullets: ['Try "how do I do a goblet squat".'],
      actions: [{ kind: 'navigate', label: 'Browse exercises', href: '/exercises' }],
    });
  }
  return answer('exercise_instructions', confidence, `${ex.name} — from the GymOS exercise library:`, {
    bullets: [
      `Set-up: ${ex.setup.join(' ')}`,
      `Movement: ${ex.steps.join(' ')}`,
      ...(ex.cues?.length ? [`Cues: ${ex.cues.join(' ')}`] : []),
      ...(ex.safety?.length ? [`Safety: ${ex.safety.join(' ')}`] : []),
      `Equipment: ${equipmentRequirementSummary(ex).join(', ')}.`,
    ],
    sources: [{ kind: 'exercise', label: ex.name, href: `/exercises/${ex.id}` }],
    actions: [{ kind: 'navigate', label: `Open ${ex.name}`, href: `/exercises/${ex.id}` }],
    disclaimer:
      'These instructions are an internal GymOS draft awaiting review by a qualified professional. They are general information, not coaching.',
  });
}

function equipmentAnswer(userId: string, query: string, confidence: number): FitBrainAnswer {
  const { set, profileName } = activeEquipmentSet(userId);
  const ex = matchExerciseByName(query);
  if (ex) {
    const check = checkEquipment(ex, set);
    return answer(
      'equipment_question',
      confidence,
      check.ok
        ? `Yes — ${ex.name} works with your ${profileName ?? 'current'} profile.`
        : `No — ${ex.name} needs ${describeMissing(check)}, which is not in your ${profileName ?? 'current'} profile.`,
      {
        bullets: [`Requirements: ${equipmentRequirementSummary(ex).join(', ')}.`],
        sources: [{ kind: 'exercise', label: ex.name, href: `/exercises/${ex.id}` }],
        actions: check.ok
          ? []
          : [{ kind: 'navigate', label: 'Add equipment', href: '/equipment' }],
      },
    );
  }
  const usable = EXERCISE_CATALOG.filter((e) => checkEquipment(e, set).ok);
  return answer(
    'equipment_question',
    confidence,
    `Your ${profileName ?? 'current'} profile unlocks ${usable.length} of ${EXERCISE_CATALOG.length} exercises in the library.`,
    {
      bullets: [
        `Items available: ${set.size - 1}.`,
        'Open Equipment to add or mark items unavailable — plans re-filter immediately.',
      ],
      actions: [{ kind: 'navigate', label: 'Open Equipment', href: '/equipment' }],
    },
  );
}

function shorterSession(userId: string, query: string, confidence: number): FitBrainAnswer {
  const minutes = extractMinutes(query) ?? 20;
  const next = nextSession(userId);
  const plan = getActivePlan(userId);
  const day = plan?.days.find((d) => !d.isRest && d.exercises.length > 0);
  if (!day) {
    return answer('shorter_session', confidence, 'There is no upcoming session to shorten yet.', {
      actions: [{ kind: 'navigate', label: 'Build my plan', href: '/workouts/plan' }],
    });
  }
  const proposal = adaptToTime(plannedExercisesToGenerated(day), minutes);
  return answer(
    'shorter_session',
    confidence,
    `A ${minutes}-minute version of ${day.label}: about ${proposal.estimatedMinutes} minutes.`,
    {
      bullets: [
        ...proposal.exercises.map(
          (e) =>
            `${e.name} — ${e.durationSeconds ? `${e.sets} x ${e.durationSeconds}s` : `${e.sets} x ${e.repsLow}-${e.repsHigh}`}, ${e.restSeconds}s rest.`,
        ),
        ...proposal.changes.filter((c) => c.kind === 'remove').map((c) => `Left out: ${c.exerciseName}.`),
        ...proposal.explanation,
      ],
      sources: [{ kind: 'plan', label: day.label, href: '/workouts/plan' }],
      actions: next
        ? [
            {
              kind: 'propose_adaptation',
              label: 'Apply to my next session',
              href: `/workouts/session/${next.id}?adapt=time&minutes=${minutes}`,
              payload: { sessionId: next.id, minutes },
            },
          ]
        : [],
    },
  );
}

function extractMinutes(query: string): number | null {
  const m = query.match(/(\d{1,3})\s*(min|minute|minutes|m\b)/i);
  if (m?.[1]) return Math.max(5, Math.min(180, Number(m[1])));
  return null;
}

function scheduleAnswer(userId: string, confidence: number): FitBrainAnswer {
  const missed = missedSessions(userId);
  const next = nextSession(userId);
  const bullets: string[] = [];
  if (missed.length > 0) {
    bullets.push(
      `${missed.length} scheduled session(s) have passed without being logged: ${missed.map((m) => `${m.label} (${m.scheduledDate})`).join(', ')}.`,
    );
    bullets.push('RealitySync can move one to a free day this week, or you can just let it go. Nothing gets added to your other days to compensate.');
  } else {
    bullets.push('Nothing is overdue.');
  }
  if (next) bullets.push(`Next up: ${next.label} on ${next.scheduledDate}.`);
  return answer('change_schedule', confidence, 'Here is where your schedule stands.', {
    bullets,
    actions: [
      { kind: 'navigate', label: 'Open calendar', href: '/calendar' },
      ...(missed[0]
        ? [
            {
              kind: 'propose_adaptation' as const,
              label: 'Reschedule the missed session',
              href: `/workouts?adapt=missed&sessionId=${missed[0].id}`,
              payload: { sessionId: missed[0].id },
            },
          ]
        : []),
    ],
  });
}

function summariseHistory(userId: string, confidence: number): FitBrainAnswer {
  const today = new Date().toISOString().slice(0, 10);
  const from = addDays(today, -28);
  const sessions = listSessions(userId, { from, to: today });
  const completed = sessions.filter((s) => s.status === 'completed');
  const sets = db
    .select({ c: sql<number>`count(*)` })
    .from(exerciseLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, exerciseLogs.sessionId))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        gte(workoutSessions.scheduledDate, from),
        eq(exerciseLogs.skipped, false),
      ),
    )
    .all();
  const topExercises = db
    .select({ exerciseId: exerciseLogs.exerciseId, c: sql<number>`count(*)` })
    .from(exerciseLogs)
    .innerJoin(workoutSessions, eq(workoutSessions.id, exerciseLogs.sessionId))
    .where(and(eq(workoutSessions.userId, userId), gte(workoutSessions.scheduledDate, from)))
    .groupBy(exerciseLogs.exerciseId)
    .orderBy(desc(sql`count(*)`))
    .limit(5)
    .all();

  return answer(
    'summarise_history',
    confidence,
    `In the last 28 days you logged ${completed.length} completed session(s) out of ${sessions.length} scheduled.`,
    {
      bullets: [
        `${sets[0]?.c ?? 0} sets recorded.`,
        topExercises.length > 0
          ? `Most frequent: ${topExercises.map((t) => `${EXERCISE_BY_ID.get(t.exerciseId)?.name ?? t.exerciseId} (${t.c})`).join(', ')}.`
          : 'No sets logged yet.',
        'These numbers come from your own logged sets. Nothing is estimated.',
      ],
      sources: [{ kind: 'session', label: 'Training history', href: '/workouts/history' }],
      actions: [{ kind: 'navigate', label: 'Open progress', href: '/progress' }],
    },
  );
}

function findRecipe(userId: string, query: string, confidence: number): FitBrainAnswer {
  const prefs = getNutritionPrefs(userId);
  const q = query.toLowerCase();
  const slot = q.includes('breakfast')
    ? 'breakfast'
    : q.includes('lunch')
      ? 'lunch'
      : q.includes('dinner')
        ? 'dinner'
        : q.includes('snack')
          ? 'snack'
          : undefined;
  const report = filterRecipes(prefs, slot ? { slot } : {});
  const picks = report.eligible.slice(0, 8);
  if (picks.length === 0) {
    return answer('find_recipe', confidence, 'Nothing in the recipe library fits your current preferences.', {
      bullets: [
        `Exclusions applied: ${Object.entries(report.exclusionCounts).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}.`,
        'Widening the time limit or cuisine list usually helps.',
      ],
      actions: [{ kind: 'navigate', label: 'Edit food preferences', href: '/nutrition' }],
    });
  }
  return answer(
    'find_recipe',
    confidence,
    `${picks.length} recipe(s) fit your preferences${slot ? ` for ${slot}` : ''}:`,
    {
      bullets: picks.map(
        (p) =>
          `${p.recipe.name} — ${p.recipe.cuisine.replace(/_/g, ' ')}, about ${p.recipe.prep + p.recipe.cook} min.${p.omitIngredientIds.length ? ` Leave out the optional ${p.omitIngredientIds.join(', ')}.` : ''}`,
      ),
      sources: picks.map((p) => ({
        kind: 'recipe' as const,
        label: p.recipe.name,
        href: `/nutrition/recipes/${p.recipe.id}`,
      })),
      actions: [{ kind: 'navigate', label: 'Browse recipes', href: '/nutrition/recipes' }],
      disclaimer:
        prefs.allergenIds.length > 0
          ? `Allergen filtering is applied as a hard rule for: ${prefs.allergenIds.join(', ')}. Always check labels yourself too.`
          : undefined,
    },
  );
}

function mealSwapAnswer(userId: string, confidence: number): FitBrainAnswer {
  const plan = getActiveMealPlan(userId);
  if (!plan) {
    return answer('explain_meal_swap', confidence, 'You do not have an active meal plan yet.', {
      actions: [{ kind: 'navigate', label: 'Build a meal plan', href: '/nutrition/meal-plan' }],
    });
  }
  return answer('explain_meal_swap', confidence, 'You can swap any planned meal from the meal plan page.', {
    bullets: [
      'Every alternative offered is re-checked against your allergens, diet, dislikes, time limit and cooking skill.',
      'Swapping a meal updates the grocery list when you regenerate it.',
      `Your current plan covers ${plan.meals.length} meal(s) from the week of ${plan.weekStart}.`,
    ],
    sources: [{ kind: 'plan', label: `Meal plan ${plan.weekStart}`, href: '/nutrition/meal-plan' }],
    actions: [{ kind: 'navigate', label: 'Open meal plan', href: '/nutrition/meal-plan' }],
  });
}

function setPreferenceAnswer(userId: string, query: string, confidence: number): FitBrainAnswer {
  const ex = matchExerciseByName(query);
  const q = query.toLowerCase();
  const negative = /don'?t like|hate|never show|avoid/.test(q);
  const positive = /favourite|favorite|love|prefer/.test(q);

  if (!ex) {
    return answer('set_preference', confidence, 'Which exercise should I remember that about?', {
      bullets: ['For example: "I don\'t like burpees" or "goblet squat is a favourite".'],
      actions: [{ kind: 'navigate', label: 'See saved preferences', href: '/fitbrain/memory' }],
    });
  }

  if (negative) {
    const list = new Set(getPreference<string[]>(userId, 'disliked_exercises', []));
    list.add(ex.id);
    setPreference(userId, 'disliked_exercises', [...list], 'fitbrain');
    return answer('set_preference', confidence, `Noted — ${ex.name} will be left out of future plans.`, {
      bullets: ['You can undo this any time from FitBrain memory.'],
      sources: [{ kind: 'preference', label: 'Disliked exercises', href: '/fitbrain/memory' }],
      actions: [{ kind: 'navigate', label: 'Manage preferences', href: '/fitbrain/memory' }],
    });
  }
  if (positive) {
    const list = new Set(getPreference<string[]>(userId, 'favourite_exercises', []));
    list.add(ex.id);
    setPreference(userId, 'favourite_exercises', [...list], 'fitbrain');
    return answer('set_preference', confidence, `Noted — ${ex.name} is marked as a favourite.`, {
      bullets: ['Favourites are preferred when the generator has a choice.'],
      sources: [{ kind: 'preference', label: 'Favourite exercises', href: '/fitbrain/memory' }],
      actions: [{ kind: 'navigate', label: 'Manage preferences', href: '/fitbrain/memory' }],
    });
  }
  return answer('set_preference', confidence, `Do you want ${ex.name} avoided, or marked as a favourite?`, {
    bullets: ['Say "I don\'t like X" to avoid it, or "X is a favourite" to prefer it.'],
  });
}

const FEATURE_HELP: Record<string, { title: string; body: string[]; href: string }> = {
  realitysync: {
    title: 'RealitySync',
    body: [
      'RealitySync re-plans a session when your circumstances change: different equipment, less time, a missed day, a machine in use, or a session that felt too hard.',
      'Every proposal shows what changed, why, what information was used, and whether the replacement actually fits your equipment. You accept, edit or reject it.',
      'It never doubles a session to make up for a missed one, and it never rewrites a completed workout.',
    ],
    href: '/features',
  },
  'equipment dna': {
    title: 'Equipment DNA',
    body: [
      'Equipment DNA is the inventory behind every plan. Each exercise lists exactly what it needs, and the generator will not assign anything your profile does not have.',
      'You can keep several profiles — home, gym, travel — and switch the active one.',
    ],
    href: '/equipment',
  },
  export: {
    title: 'Data export',
    body: [
      'Settings → Privacy exports everything GymOS holds about you as JSON, including plans, logs, preferences and consents.',
      'Export is available on every plan, including free.',
    ],
    href: '/settings/privacy',
  },
  delete: {
    title: 'Account deletion',
    body: [
      'Settings → Privacy deletes your account and every row tied to it. It cannot be undone.',
    ],
    href: '/settings/privacy',
  },
  subscription: {
    title: 'Plans and billing',
    body: [
      'GymOS Free covers one equipment profile, the full exercise library, plan generation, logging and 30 days of history.',
      'GymOS Pro adds multiple profiles, RealitySync, full meal planning, grocery and pantry tools and complete history.',
      'Payments are not enabled in this build: no card can be charged. The entitlement checks are real and enforced on the server.',
    ],
    href: '/pricing',
  },
};

function appHelp(query: string, confidence: number): FitBrainAnswer {
  const q = query.toLowerCase();
  for (const [key, help] of Object.entries(FEATURE_HELP)) {
    if (q.includes(key)) {
      return answer('app_help', confidence, help.title, {
        bullets: help.body,
        sources: [{ kind: 'feature', label: help.title, href: help.href }],
        actions: [{ kind: 'navigate', label: `Open ${help.title}`, href: help.href }],
      });
    }
  }
  return answer('app_help', confidence, 'Here is what FitBrain can do.', {
    bullets: FITBRAIN_CAPABILITIES.map((c) => `${c.label} — e.g. "${c.example}"`),
  });
}

function unknownAnswer(): FitBrainAnswer {
  return answer(
    'unknown',
    0,
    'I could not match that to one of my capabilities.',
    {
      bullets: [
        'FitBrain is a guided planning assistant, not a general chatbot. It answers from your own GymOS records and the exercise and recipe libraries.',
        ...FITBRAIN_CAPABILITIES.map((c) => `${c.label} — e.g. "${c.example}"`),
      ],
    },
  );
}

/* ----------------------------------------------------------------- plumbing */

function safeProfile(userId: string) {
  try {
    return loadPlanningProfile(userId);
  } catch {
    const row = db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).get();
    return {
      userId,
      ageBand: row?.ageBand ?? ('adult_18_plus' as const),
      experience: row?.experience ?? ('new' as const),
      interests: row?.interests ?? [],
      trainingDays: row?.trainingDays ?? [],
      sessionMinutes: row?.sessionMinutes ?? 45,
      limitations: row?.limitations ?? [],
      scheduleFlexibility: row?.scheduleFlexibility ?? ('some' as const),
    };
  }
}

function fitbrainUsageToday(userId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const stored = getPreference<{ date: string; count: number }>(userId, 'fitbrain_usage', {
    date: today,
    count: 0,
  });
  return stored.date === today ? stored.count : 0;
}

function recordFitbrainUse(userId: string): void {
  const today = new Date().toISOString().slice(0, 10);
  const current = fitbrainUsageToday(userId);
  setPreference(userId, 'fitbrain_usage', { date: today, count: current + 1 }, 'system');
}

export interface MemoryView {
  key: string;
  label: string;
  value: unknown;
  source: string;
  updatedAt: string;
}

const MEMORY_LABELS: Record<string, string> = {
  disliked_exercises: 'Exercises to avoid',
  favourite_exercises: 'Favourite exercises',
  preferred_equipment: 'Preferred equipment',
  preferred_meals: 'Preferred meals',
  fitbrain_usage: 'FitBrain usage today',
  training_feedback: 'Training feedback notes',
};

export function listMemory(userId: string): MemoryView[] {
  return db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .all()
    .map((p) => ({
      key: p.key,
      label: MEMORY_LABELS[p.key] ?? p.key.replace(/_/g, ' '),
      value: p.value,
      source: p.source,
      updatedAt: p.updatedAt,
    }));
}

export function forgetMemory(userId: string, key: string): void {
  db.delete(preferences).where(and(eq(preferences.userId, userId), eq(preferences.key, key))).run();
}

export function removeFromListPreference(userId: string, key: string, value: string): void {
  const list = getPreference<string[]>(userId, key, []);
  setPreference(userId, key, list.filter((v) => v !== value), 'user');
}

export { FITBRAIN_CAPABILITIES, RECIPE_CATALOG };
