import { EXERCISE_CATALOG, EXERCISE_BY_ID } from '@/lib/content/exercises';
import type { ExerciseSeed } from '@/lib/content/exercise-types';
import { checkEquipment, describeMissing, equipmentName } from './equipment';
import { isAgeAppropriate, isLevelAppropriate, type AgeBand } from './programming';
import type { Level } from '@/lib/content/exercise-types';

export interface SubstitutionFilters {
  availableEquipment: Set<string>;
  ageBand: AgeBand;
  level: Level;
  excludedExerciseIds?: Set<string>;
  excludedPatterns?: Set<string>;
}

export interface SubstituteOption {
  exercise: ExerciseSeed;
  /** Higher is a closer match. */
  closeness: number;
  reason: string;
  samePattern: boolean;
  sharedPrimaryMuscles: string[];
}

export interface SubstitutionResult {
  options: SubstituteOption[];
  /** Set when nothing suitable exists — the caller must say so rather than inventing one. */
  noMatchReason?: string;
}

/**
 * Training families. A stretch is not a substitute for a strength exercise and a
 * strength exercise is not a substitute for a cardio session, even when they share a
 * muscle tag. Crossing these boundaries is exactly the kind of misleading swap GymOS
 * must not make.
 */
type TrainingFamily = 'strength' | 'mobility' | 'cardio';

function familyOf(ex: ExerciseSeed): TrainingFamily {
  if (ex.cat === 'mobility') return 'mobility';
  if (ex.cat === 'cardio') return 'cardio';
  return 'strength';
}

function sameFamily(a: ExerciseSeed, b: ExerciseSeed): boolean {
  return familyOf(a) === familyOf(b);
}

function passesHardFilters(ex: ExerciseSeed, f: SubstitutionFilters): boolean {
  if (f.excludedExerciseIds?.has(ex.id)) return false;
  if (f.excludedPatterns?.has(ex.pattern)) return false;
  if (!isAgeAppropriate(ex, f.ageBand)) return false;
  if (!isLevelAppropriate(ex, f.level, f.ageBand)) return false;
  return checkEquipment(ex, f.availableEquipment).ok;
}

/**
 * Finds replacements for an exercise, in order of how closely they preserve the
 * original training intent.
 *
 * Ranking:
 *  1. hand-curated substitutes from the library,
 *  2. same movement pattern AND overlapping primary muscles,
 *  3. same movement pattern,
 *  4. different pattern but overlapping primary muscles (flagged as a partial match),
 *  5. curated regressions, when the caller asked for an easier option.
 *
 * Nothing is invented. If the list comes back empty the caller must tell the user,
 * because claiming an equipment-free equivalent for, say, a lat pulldown would be false.
 */
export function findSubstitutes(
  original: ExerciseSeed,
  filters: SubstitutionFilters,
  opts: { preferEasier?: boolean; limit?: number; catalog?: ExerciseSeed[] } = {},
): SubstitutionResult {
  const catalog = opts.catalog ?? EXERCISE_CATALOG;
  const limit = opts.limit ?? 5;
  const seen = new Set<string>([original.id]);
  const options: SubstituteOption[] = [];

  const consider = (ex: ExerciseSeed, closeness: number, reason: string) => {
    if (seen.has(ex.id)) return;
    if (!passesHardFilters(ex, filters)) return;
    seen.add(ex.id);
    const shared = ex.primary.filter((m) => original.primary.includes(m));
    options.push({
      exercise: ex,
      closeness,
      reason,
      samePattern: ex.pattern === original.pattern,
      sharedPrimaryMuscles: shared,
    });
  };

  if (opts.preferEasier) {
    for (const id of original.regr ?? []) {
      const ex = EXERCISE_BY_ID.get(id);
      if (ex) consider(ex, 100, `Listed as an easier version of ${original.name}.`);
    }
  }

  for (const id of original.subs ?? []) {
    const ex = EXERCISE_BY_ID.get(id);
    if (ex) {
      consider(
        ex,
        90,
        `Listed in the library as a substitute for ${original.name}; trains the same ${original.pattern.replace(/_/g, ' ')} pattern.`,
      );
    }
  }

  for (const ex of catalog) {
    if (ex.pattern !== original.pattern) continue;
    if (!sameFamily(ex, original)) continue;
    const shared = ex.primary.filter((m) => original.primary.includes(m));
    if (shared.length > 0) {
      consider(ex, 70 + shared.length, `Same movement pattern and works the ${shared.join(', ')}.`);
    }
  }

  for (const ex of catalog) {
    if (ex.pattern !== original.pattern) continue;
    if (!sameFamily(ex, original)) continue;
    consider(ex, 50, `Same ${original.pattern.replace(/_/g, ' ')} pattern.`);
  }

  for (const ex of catalog) {
    if (!sameFamily(ex, original)) continue;
    const shared = ex.primary.filter((m) => original.primary.includes(m));
    if (shared.length === 0) continue;
    consider(
      ex,
      20 + shared.length,
      `Partial match: a different movement pattern, but it still works the ${shared.join(', ')}.`,
    );
  }

  options.sort(
    (a, b) => b.closeness - a.closeness || a.exercise.name.localeCompare(b.exercise.name),
  );
  const top = options.slice(0, limit);

  if (top.length === 0) {
    const check = checkEquipment(original, filters.availableEquipment);
    const missing = describeMissing(check);
    return {
      options: [],
      noMatchReason: missing
        ? `Nothing in the library trains the ${original.pattern.replace(/_/g, ' ')} pattern with your current equipment. ${original.name} itself needs ${missing}. There is no equipment-free movement that does the same job, so the slot is better left out than faked.`
        : `No suitable replacement for ${original.name} is available under your current profile (experience level, age band or stated limitations).`,
    };
  }
  return { options: top };
}

export function describeEquipmentUsed(ex: ExerciseSeed, available: Set<string>): string {
  if (ex.equip.length === 0) return 'no equipment';
  const used = ex.equip
    .map((group) => group.find((id) => available.has(id)))
    .filter((x): x is string => Boolean(x))
    .map(equipmentName);
  return used.length > 0 ? used.join(' + ') : 'equipment you do not have';
}
