import type { ExerciseSeed, Level } from '@/lib/content/exercise-types';

export type AgeBand = 'under_13' | 'teen_13_17' | 'adult_18_plus';
export type SlotRole = 'primary' | 'secondary' | 'accessory' | 'conditioning' | 'mobility';
export type Difficulty = 'too_easy' | 'about_right' | 'hard' | 'too_hard';
export type Recovery = 'fresh' | 'ok' | 'tired' | 'very_tired';

export const LEVEL_ORDER: Level[] = ['new', 'some', 'regular', 'experienced'];
export const levelIndex = (l: Level): number => LEVEL_ORDER.indexOf(l);

export interface Prescription {
  sets: number;
  repsLow?: number;
  repsHigh?: number;
  durationSeconds?: number;
  restSeconds: number;
  intensityNote: string;
}

/**
 * Programming rules.
 *
 * Age-banded by design:
 *  - under_13   activity sessions only: no load prescriptions, no intensity language,
 *               short practice sets, only exercises flagged childOk.
 *  - teen_13_17 technique-first: moderate rep ranges, never training to failure,
 *               capped set counts, exercises flagged teenOk only.
 *  - adult      standard ranges by experience.
 *
 * Volume targets are informed by the WHO physical activity guidelines (2020) and by
 * published youth resistance-training position statements, summarised in-house.
 * See lib/content/exercises.ts EXERCISE_SOURCES.
 */
export const PROGRAMMING_VERSION = 'programming-1.0.0';

const ADULT_REPS: Record<SlotRole, Record<Level, [number, number]>> = {
  primary: {
    new: [8, 12],
    some: [8, 12],
    regular: [6, 10],
    experienced: [5, 10],
  },
  secondary: {
    new: [10, 15],
    some: [8, 12],
    regular: [8, 12],
    experienced: [8, 12],
  },
  accessory: {
    new: [10, 15],
    some: [10, 15],
    regular: [10, 15],
    experienced: [12, 20],
  },
  conditioning: { new: [0, 0], some: [0, 0], regular: [0, 0], experienced: [0, 0] },
  mobility: { new: [0, 0], some: [0, 0], regular: [0, 0], experienced: [0, 0] },
};

const ADULT_SETS: Record<SlotRole, Record<Level, number>> = {
  primary: { new: 2, some: 3, regular: 3, experienced: 4 },
  secondary: { new: 2, some: 3, regular: 3, experienced: 3 },
  accessory: { new: 2, some: 2, regular: 3, experienced: 3 },
  conditioning: { new: 1, some: 1, regular: 1, experienced: 1 },
  mobility: { new: 1, some: 1, regular: 2, experienced: 2 },
};

/** Rest scales with how heavy the work actually is for that person. */
const REST_BY_ROLE_LEVEL: Record<SlotRole, Record<Level, number>> = {
  primary: { new: 75, some: 90, regular: 120, experienced: 150 },
  secondary: { new: 60, some: 75, regular: 90, experienced: 90 },
  accessory: { new: 45, some: 45, regular: 60, experienced: 60 },
  conditioning: { new: 0, some: 0, regular: 0, experienced: 0 },
  mobility: { new: 15, some: 15, regular: 20, experienced: 20 },
};

export function restFor(role: SlotRole, level: Level): number {
  return REST_BY_ROLE_LEVEL[role][level];
}

const TIMED_SECONDS: Record<Level, number> = { new: 20, some: 30, regular: 40, experienced: 45 };

export interface PrescriptionInput {
  exercise: Pick<ExerciseSeed, 'timed' | 'unilateral' | 'cat' | 'loadable'>;
  role: SlotRole;
  level: Level;
  ageBand: AgeBand;
  /** Minutes of conditioning to prescribe when the slot is conditioning. */
  conditioningMinutes?: number;
}

export function prescribe(input: PrescriptionInput): Prescription {
  const { exercise, role, ageBand, conditioningMinutes } = input;
  const level = effectiveLevel(input.level, ageBand);

  if (role === 'conditioning') {
    return {
      sets: 1,
      durationSeconds: Math.max(5, conditioningMinutes ?? 10) * 60,
      restSeconds: 0,
      intensityNote:
        ageBand === 'under_13'
          ? 'Keep it playful — move at a pace where talking is still easy.'
          : 'Steady effort: you can hold a conversation but not sing.',
    };
  }

  if (role === 'mobility') {
    return {
      sets: ageBand === 'under_13' ? 1 : 2,
      durationSeconds: 30,
      restSeconds: 15,
      intensityNote: 'Gentle range. Stretch should feel like tension, never pain.',
    };
  }

  if (ageBand === 'under_13') {
    // Activity sessions: practice reps, no load guidance, no intensity targets.
    return {
      sets: role === 'primary' ? 2 : 1,
      repsLow: exercise.timed ? undefined : 6,
      repsHigh: exercise.timed ? undefined : 10,
      durationSeconds: exercise.timed ? 20 : undefined,
      restSeconds: 45,
      intensityNote: 'Practise the movement. Stop while it still feels easy and fun.',
    };
  }

  const sets = ageBand === 'teen_13_17' ? Math.min(3, ADULT_SETS[role][level]) : ADULT_SETS[role][level];

  if (exercise.timed) {
    const base = TIMED_SECONDS[level];
    return {
      sets,
      durationSeconds: ageBand === 'teen_13_17' ? Math.min(30, base) : base,
      restSeconds: restFor(role, level),
      intensityNote: teenSafeNote(ageBand, 'Hold with good position; end the set when form slips.'),
    };
  }

  const [low, high] = ageBand === 'teen_13_17' ? [8, 15] : ADULT_REPS[role][level];
  return {
    sets,
    repsLow: low,
    repsHigh: high,
    restSeconds: restFor(role, level),
    intensityNote: teenSafeNote(
      ageBand,
      exercise.loadable === false
        ? 'Control the movement; add reps before adding speed.'
        : 'Pick a load where the last rep is challenging but your technique still looks the same.',
    ),
  };
}

function teenSafeNote(ageBand: AgeBand, adultNote: string): string {
  if (ageBand === 'teen_13_17') {
    return 'Technique first. Stay well away from failure and keep a rep or two in reserve.';
  }
  return adultNote;
}

/** Minors are programmed conservatively regardless of self-reported experience. */
export function effectiveLevel(level: Level, ageBand: AgeBand): Level {
  if (ageBand === 'under_13') return 'new';
  if (ageBand === 'teen_13_17') return levelIndex(level) > levelIndex('some') ? 'some' : level;
  return level;
}

/** Exercises an age band may never be auto-assigned. */
export function isAgeAppropriate(exercise: ExerciseSeed, ageBand: AgeBand): boolean {
  if (ageBand === 'under_13') return exercise.childOk === true;
  if (ageBand === 'teen_13_17') return exercise.teenOk !== false;
  return true;
}

export function isLevelAppropriate(exercise: ExerciseSeed, level: Level, ageBand: AgeBand): boolean {
  return levelIndex(exercise.level) <= levelIndex(effectiveLevel(level, ageBand));
}

/* ------------------------------------------------------------------ feedback */

export interface ProgressionContext {
  previous: Prescription;
  difficulty?: Difficulty;
  recovery?: Recovery;
  discomfortReported?: boolean;
  ageBand: AgeBand;
}

export interface ProgressionResult {
  next: Prescription;
  changed: boolean;
  reason: string;
}

/**
 * Feedback-driven adjustment. Deliberately asymmetric:
 *  - "too hard", poor recovery or any reported discomfort reduces volume,
 *  - "too easy" with good recovery adds ONE small increment, never more,
 *  - nothing escalates without positive feedback.
 */
export function applyFeedback(ctx: ProgressionContext): ProgressionResult {
  const { previous, difficulty, recovery, discomfortReported, ageBand } = ctx;
  const next: Prescription = { ...previous };

  if (discomfortReported) {
    next.sets = Math.max(1, previous.sets - 1);
    next.intensityNote =
      'Reduced after you reported discomfort. Work in a pain-free range, and see a qualified professional if it persists.';
    return { next, changed: true, reason: 'discomfort_reported' };
  }

  if (difficulty === 'too_hard' || recovery === 'very_tired') {
    next.sets = Math.max(1, previous.sets - 1);
    if (next.repsLow && next.repsHigh) {
      next.repsLow = Math.max(5, next.repsLow - 2);
      next.repsHigh = Math.max(next.repsLow + 2, next.repsHigh - 2);
    }
    if (next.durationSeconds) next.durationSeconds = Math.max(10, next.durationSeconds - 10);
    next.restSeconds = previous.restSeconds + 30;
    next.intensityNote = 'Lighter version of last time. Build back up only when it feels comfortable.';
    return { next, changed: true, reason: 'reported_too_hard' };
  }

  if (difficulty === 'too_easy' && (recovery === 'fresh' || recovery === 'ok')) {
    const setCap = ageBand === 'teen_13_17' ? 3 : ageBand === 'under_13' ? 2 : 5;
    if (previous.repsHigh && previous.repsLow) {
      next.repsLow = previous.repsLow + 1;
      next.repsHigh = previous.repsHigh + 2;
      next.intensityNote = 'Small step up in reps because last session felt easy.';
      return { next, changed: true, reason: 'small_rep_increase' };
    }
    if (previous.durationSeconds) {
      next.durationSeconds = previous.durationSeconds + 10;
      next.intensityNote = 'Ten more seconds than last time.';
      return { next, changed: true, reason: 'small_duration_increase' };
    }
    if (previous.sets < setCap) {
      next.sets = previous.sets + 1;
      next.intensityNote = 'One extra set because last session felt easy.';
      return { next, changed: true, reason: 'single_set_increase' };
    }
  }

  return { next, changed: false, reason: 'no_change' };
}

/* --------------------------------------------------------------- limitations */

export const LIMITATION_OPTIONS = [
  { id: 'knee', label: 'Knees feel sensitive' },
  { id: 'lower_back', label: 'Lower back feels sensitive' },
  { id: 'shoulder', label: 'Shoulders feel sensitive' },
  { id: 'wrist', label: 'Wrists feel sensitive' },
  { id: 'neck', label: 'Neck feels sensitive' },
  { id: 'ankle', label: 'Ankles feel sensitive' },
  { id: 'pregnancy_postpartum', label: 'Pregnant or recently postpartum' },
  { id: 'avoid_jumping', label: 'Prefer no jumping or impact' },
  { id: 'avoid_floor', label: 'Hard to get down to and up from the floor' },
] as const;

export type LimitationId = (typeof LIMITATION_OPTIONS)[number]['id'];

/**
 * Conservative exclusion rules for self-reported sensitivities.
 *
 * This is NOT a diagnosis and not a treatment plan: it only removes movements that
 * commonly load the named area, so the generator stops offering them. Users are always
 * told to consult a qualified professional, and nothing here is presented as clinical advice.
 */
const LIMITATION_RULES: Record<
  LimitationId,
  { patterns?: string[]; exerciseIds?: string[]; categories?: string[]; note: string }
> = {
  knee: {
    patterns: ['plyometric'],
    exerciseIds: ['sissy-squat-assisted', 'squat-jump', 'broad-jump', 'skater-hop', 'cossack-squat', 'box-step-up-fast'],
    note: 'Jumping and deep knee-forward work are left out while your knees feel sensitive.',
  },
  lower_back: {
    exerciseIds: [
      'conventional-deadlift',
      'barbell-row',
      'romanian-deadlift-barbell',
      'band-good-morning',
      'back-extension',
      'russian-twist',
      'barbell-back-squat',
    ],
    note: 'Loaded spinal flexion and heavy hinging are left out while your back feels sensitive.',
  },
  shoulder: {
    patterns: ['vertical_push'],
    exerciseIds: ['dip-chest', 'bench-dip', 'dumbbell-fly', 'skull-crusher', 'decline-push-up'],
    note: 'Overhead pressing and deep dips are left out while your shoulders feel sensitive.',
  },
  wrist: {
    exerciseIds: ['push-up', 'decline-push-up', 'diamond-push-up', 'close-grip-push-up', 'bear-crawl-hold', 'ab-wheel-rollout', 'wrist-curl'],
    note: 'Loaded wrist-extension positions are left out; machine and dumbbell versions are used instead.',
  },
  neck: {
    exerciseIds: ['barbell-back-squat', 'shrug-barbell', 'shrug-dumbbell', 'crunch', 'v-up', 'band-good-morning'],
    note: 'Bar-on-neck and neck-flexion work are left out.',
  },
  ankle: {
    patterns: ['plyometric'],
    exerciseIds: ['single-leg-calf-raise', 'shuttle-intervals', 'jump-rope-intervals', 'tandem-walk'],
    note: 'Impact and single-leg ankle loading are left out while your ankles feel sensitive.',
  },
  pregnancy_postpartum: {
    patterns: ['plyometric', 'core_flexion'],
    exerciseIds: ['ab-wheel-rollout', 'hollow-hold', 'v-up', 'conventional-deadlift', 'long-lever-plank', 'kettlebell-swing'],
    note: 'High-impact and intense abdominal-flexion work are left out. Please follow guidance from your own healthcare professional, which takes precedence over anything GymOS suggests.',
  },
  avoid_jumping: {
    patterns: ['plyometric'],
    exerciseIds: ['jump-rope-intervals', 'shuttle-intervals'],
    note: 'No jumping or running impact in your plan.',
  },
  avoid_floor: {
    exerciseIds: [
      'plank',
      'knee-plank',
      'long-lever-plank',
      'dead-bug',
      'bird-dog',
      'glute-bridge',
      'single-leg-glute-bridge',
      'crunch',
      'reverse-crunch',
      'lying-leg-raise',
      'side-plank',
      'knee-side-plank',
      'hollow-hold',
      'v-up',
      'clamshell',
      'side-lying-leg-raise',
      'cat-cow',
      'childs-pose',
      'quadruped-hip-extension',
      'bear-crawl-hold',
      'floor-press-dumbbell',
      'slider-leg-curl',
      'thoracic-rotation',
      'hamstring-stretch',
    ],
    note: 'Floor-based exercises are replaced with standing, seated or bench versions.',
  },
};

export interface LimitationFilter {
  excludedExerciseIds: Set<string>;
  excludedPatterns: Set<string>;
  notes: string[];
}

export function buildLimitationFilter(limitations: string[]): LimitationFilter {
  const excludedExerciseIds = new Set<string>();
  const excludedPatterns = new Set<string>();
  const notes: string[] = [];
  for (const id of limitations) {
    const rule = LIMITATION_RULES[id as LimitationId];
    if (!rule) continue;
    for (const ex of rule.exerciseIds ?? []) excludedExerciseIds.add(ex);
    for (const p of rule.patterns ?? []) excludedPatterns.add(p);
    notes.push(rule.note);
  }
  return { excludedExerciseIds, excludedPatterns, notes };
}

export const MEDICAL_DISCLAIMER =
  'GymOS gives general fitness information, not medical or physiotherapy advice. It cannot diagnose anything. If something hurts, keeps hurting, or you have a health condition, speak to a qualified professional before continuing.';
