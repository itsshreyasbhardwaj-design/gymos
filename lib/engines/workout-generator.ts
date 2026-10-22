import { EXERCISE_CATALOG, EXERCISE_BY_ID } from '@/lib/content/exercises';
import type { ExerciseSeed, Level, MovementPattern } from '@/lib/content/exercise-types';
import { checkEquipment, describeMissing, equipmentName } from './equipment';
import {
  prescribe,
  isAgeAppropriate,
  isLevelAppropriate,
  buildLimitationFilter,
  effectiveLevel,
  PROGRAMMING_VERSION,
  type AgeBand,
  type Prescription,
  type SlotRole,
} from './programming';
import {
  DAY_TEMPLATES,
  INTEREST_SLOTS,
  FOCUS_LABELS,
  DAY_NAMES,
  type FocusKind,
  type SlotTemplate,
} from './workout-templates';
import { createRng } from './rng';

export const GENERATOR_VERSION = `workoutos-1.0.0/${PROGRAMMING_VERSION}`;

export interface GeneratorProfile {
  userId: string;
  ageBand: AgeBand;
  experience: Level;
  interests: string[];
  trainingDays: number[];
  sessionMinutes: number;
  limitations: string[];
}

export interface GeneratorContext {
  profile: GeneratorProfile;
  /** Expanded equipment set for the ACTIVE gym profile. */
  availableEquipment: Set<string>;
  gymProfileName?: string;
  dislikedExerciseIds?: string[];
  favouriteExerciseIds?: string[];
  /** Exercise ids performed recently, used to keep variety week to week. */
  recentExerciseIds?: string[];
  weekStart: string;
  catalog?: ExerciseSeed[];
  /** Overrides the per-day minute budget (used by RealitySync time adaptation). */
  minutesOverride?: number;
}

export interface GeneratedExercise extends Prescription {
  exerciseId: string;
  name: string;
  slotPattern: MovementPattern;
  role: SlotRole;
  rationale: string;
  estimatedSeconds: number;
  substitutedFromExerciseId?: string;
}

export interface GeneratedDay {
  dayOfWeek: number;
  label: string;
  focus: FocusKind;
  focusLabel: string;
  targetMinutes: number;
  estimatedMinutes: number;
  isRest: boolean;
  exercises: GeneratedExercise[];
  /** Patterns that could not be filled with the available equipment. */
  gaps: { pattern: MovementPattern; needed: string }[];
}

export interface GeneratedPlan {
  splitKind: string;
  generatorVersion: string;
  days: GeneratedDay[];
  explanation: string[];
  warnings: string[];
  inputsSnapshot: Record<string, unknown>;
}

const WARMUP_SECONDS = 300;
const COOLDOWN_SECONDS = 180;

/* -------------------------------------------------------------- split choice */

export function chooseSplit(profile: GeneratorProfile): { kind: string; focuses: FocusKind[] } {
  const dayCount = Math.max(1, Math.min(7, profile.trainingDays.length || 3));
  if (profile.ageBand === 'under_13') {
    return { kind: 'activity', focuses: Array.from({ length: dayCount }, () => 'activity' as FocusKind) };
  }

  const level = effectiveLevel(profile.experience, profile.ageBand);
  const advanced = level === 'regular' || level === 'experienced';
  const wantsCardio =
    profile.interests.includes('cardiovascular') || profile.interests.includes('general_endurance');
  const wantsMobility = profile.interests.includes('mobility_flexibility');

  let focuses: FocusKind[];
  let kind: string;
  switch (dayCount) {
    case 1:
      focuses = ['full_body'];
      kind = 'full_body_1x';
      break;
    case 2:
      focuses = ['full_body', 'full_body'];
      kind = 'full_body_2x';
      break;
    case 3:
      if (advanced) {
        focuses = ['lower', 'upper', 'full_body'];
        kind = 'lower_upper_full';
      } else {
        focuses = ['full_body', 'full_body', 'full_body'];
        kind = 'full_body_3x';
      }
      break;
    case 4:
      focuses = ['upper', 'lower', 'upper', 'lower'];
      kind = 'upper_lower_2x';
      break;
    case 5:
      if (advanced) {
        focuses = ['push', 'pull', 'lower', 'upper', 'lower'];
        kind = 'push_pull_lower_5x';
      } else {
        focuses = ['upper', 'lower', 'full_body', 'upper', 'lower'];
        kind = 'upper_lower_full_5x';
      }
      break;
    default:
      if (advanced) {
        focuses = ['push', 'pull', 'lower', 'push', 'pull', 'lower'].slice(0, dayCount) as FocusKind[];
        kind = 'push_pull_lower_6x';
      } else {
        focuses = ['upper', 'lower', 'full_body', 'upper', 'lower', 'full_body'].slice(
          0,
          dayCount,
        ) as FocusKind[];
        kind = 'upper_lower_full_6x';
      }
      break;
  }

  // Dedicated cardio / mobility days once there is room for them.
  if (dayCount >= 4 && wantsCardio) {
    focuses[2] = 'conditioning';
    kind = `${kind}+cardio`;
  }
  if (dayCount >= 5 && wantsMobility) {
    focuses[focuses.length - 1] = 'mobility';
    kind = `${kind}+mobility`;
  }
  return { kind, focuses };
}

/* ------------------------------------------------------------ slot filling */

interface Candidate {
  exercise: ExerciseSeed;
  score: number;
}

export interface EligibilityFilters {
  availableEquipment: Set<string>;
  ageBand: AgeBand;
  level: Level;
  excludedExerciseIds: Set<string>;
  excludedPatterns: Set<string>;
}

/**
 * Hard eligibility gate. Every rule here is a hard filter, not a preference:
 * equipment, age suitability, experience level, reported limitations, dislikes.
 */
export function isEligible(exercise: ExerciseSeed, f: EligibilityFilters): boolean {
  if (f.excludedExerciseIds.has(exercise.id)) return false;
  if (f.excludedPatterns.has(exercise.pattern)) return false;
  if (!isAgeAppropriate(exercise, f.ageBand)) return false;
  if (!isLevelAppropriate(exercise, f.level, f.ageBand)) return false;
  return checkEquipment(exercise, f.availableEquipment).ok;
}

export function eligibleExercises(
  filters: EligibilityFilters,
  catalog: ExerciseSeed[] = EXERCISE_CATALOG,
): ExerciseSeed[] {
  return catalog.filter((ex) => isEligible(ex, filters));
}

function scoreCandidate(
  ex: ExerciseSeed,
  slot: SlotTemplate,
  ctx: GeneratorContext,
  usedThisWeek: Set<string>,
  usedThisDay: Set<string>,
  rng: () => number,
): number {
  let score = 10;
  const favourites = new Set(ctx.favouriteExerciseIds ?? []);
  const recent = new Set(ctx.recentExerciseIds ?? []);

  if (slot.role === 'primary' && ex.cat === 'compound') score += 6;
  if (slot.role === 'primary' && ex.cat === 'isolation') score -= 5;
  if (slot.role === 'accessory' && ex.cat === 'isolation') score += 2;
  if (slot.category && ex.cat === slot.category) score += 4;
  if (slot.category && ex.cat !== slot.category) score -= 6;

  /*
   * Prefer loadable, progressible work for the main lifts when the equipment is
   * actually there. Without this a fully equipped gym gets bodyweight push-ups as its
   * primary press, which is a worse use of what the person has.
   */
  if (slot.role === 'primary' || slot.role === 'secondary') {
    const depth = ex.equip.length;
    score += Math.min(depth, 3) * 2;
    if (ex.loadable === false) score -= 4;
  }

  if (favourites.has(ex.id)) score += 8;
  if (usedThisDay.has(ex.id)) score -= 100;
  if (usedThisWeek.has(ex.id)) score -= 7;
  if (recent.has(ex.id)) score -= 2;

  // Prefer loadable work for strength interests, and movement practice for beginners.
  if (ctx.profile.interests.includes('strength_skills') && ex.loadable !== false) score += 2;
  if (ctx.profile.experience === 'new' && ex.level === 'new') score += 3;

  // Prefer exercises whose optional equipment the user actually has.
  const check = checkEquipment(ex, ctx.availableEquipment);
  score += check.optionalAvailable.length;

  return score + rng() * 2;
}

function pickForSlot(
  slot: SlotTemplate,
  pool: ExerciseSeed[],
  ctx: GeneratorContext,
  usedThisWeek: Set<string>,
  usedThisDay: Set<string>,
  rng: () => number,
): { exercise: ExerciseSeed; pattern: MovementPattern } | null {
  for (const pattern of slot.patterns) {
    const candidates: Candidate[] = pool
      .filter(
        (ex) =>
          ex.pattern === pattern &&
          !usedThisDay.has(ex.id) &&
          (!slot.muscles || slot.muscles.some((m) => ex.primary.includes(m))),
      )
      .map((exercise) => ({
        exercise,
        score: scoreCandidate(exercise, slot, ctx, usedThisWeek, usedThisDay, rng),
      }))
      .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id));
    if (candidates.length > 0 && candidates[0]) return { exercise: candidates[0].exercise, pattern };
  }
  return null;
}

/* ----------------------------------------------------------- time estimation */

export function estimateExerciseSeconds(
  exercise: Pick<ExerciseSeed, 'unilateral' | 'tempo' | 'timed'>,
  p: Prescription,
): number {
  const sides = exercise.unilateral ? 2 : 1;
  const tempo = exercise.tempo ?? 1;
  const midReps =
    p.repsLow && p.repsHigh ? (p.repsLow + p.repsHigh) / 2 : (p.repsHigh ?? p.repsLow ?? 10);
  const workPerSet = p.durationSeconds ? p.durationSeconds : Math.round(midReps * 3.5 * tempo);
  const total = p.sets * (workPerSet * sides + p.restSeconds);
  return Math.round(total);
}

export function estimateSessionMinutes(exercises: GeneratedExercise[]): number {
  if (exercises.length === 0) return 0;
  const work = exercises.reduce((sum, e) => sum + e.estimatedSeconds, 0);
  return Math.round((work + WARMUP_SECONDS + COOLDOWN_SECONDS) / 60);
}

/* ------------------------------------------------------------- plan assembly */

function buildSlots(focus: FocusKind, profile: GeneratorProfile): SlotTemplate[] {
  const base = [...(DAY_TEMPLATES[focus] ?? DAY_TEMPLATES.full_body)];
  for (const interest of profile.interests) {
    const extra = INTEREST_SLOTS[interest];
    if (!extra) continue;
    if (focus === 'conditioning' && extra.role === 'conditioning') continue;
    if (focus === 'mobility' && extra.role === 'mobility') continue;
    base.push(extra);
  }
  return base;
}

export function generatePlan(ctx: GeneratorContext): GeneratedPlan {
  const { profile } = ctx;
  const level = effectiveLevel(profile.experience, profile.ageBand);
  const limitationFilter = buildLimitationFilter(profile.limitations);
  const excludedExerciseIds = new Set<string>([
    ...limitationFilter.excludedExerciseIds,
    ...(ctx.dislikedExerciseIds ?? []),
  ]);
  const filters: EligibilityFilters = {
    availableEquipment: ctx.availableEquipment,
    ageBand: profile.ageBand,
    level: profile.experience,
    excludedExerciseIds,
    excludedPatterns: limitationFilter.excludedPatterns,
  };
  const pool = eligibleExercises(filters, ctx.catalog ?? EXERCISE_CATALOG);
  const { kind, focuses } = chooseSplit(profile);

  const trainingDays =
    profile.trainingDays.length > 0 ? [...profile.trainingDays].sort((a, b) => a - b) : [1, 3, 5];
  const targetMinutes = ctx.minutesOverride ?? profile.sessionMinutes;

  const warnings: string[] = [];
  const explanation: string[] = [];
  const usedThisWeek = new Set<string>();
  const days: GeneratedDay[] = [];

  for (let idx = 0; idx < trainingDays.length; idx += 1) {
    const dayOfWeek = trainingDays[idx] as number;
    const focus = (focuses[idx] ?? focuses[focuses.length - 1] ?? 'full_body') as FocusKind;
    const slots = buildSlots(focus, profile);
    const rng = createRng(profile.userId, ctx.weekStart, dayOfWeek, kind);
    const usedThisDay = new Set<string>();
    const exercises: GeneratedExercise[] = [];
    const gaps: GeneratedDay['gaps'] = [];

    for (const slot of slots) {
      const picked = pickForSlot(slot, pool, ctx, usedThisWeek, usedThisDay, rng);
      if (!picked) {
        // Transparent gap reporting: we never invent an equipment-free stand-in.
        gaps.push(explainGap(slot, ctx, filters));
        continue;
      }
      const { exercise, pattern } = picked;
      const prescription = prescribe({
        exercise,
        role: slot.role,
        level,
        ageBand: profile.ageBand,
        conditioningMinutes: conditioningMinutesFor(targetMinutes, focus, profile),
      });
      exercises.push({
        ...prescription,
        exerciseId: exercise.id,
        name: exercise.name,
        slotPattern: pattern,
        role: slot.role,
        estimatedSeconds: estimateExerciseSeconds(exercise, prescription),
        rationale: buildRationale(exercise, slot, pattern, ctx),
      });
      usedThisDay.add(exercise.id);
      usedThisWeek.add(exercise.id);
    }

    const fitted = fitToTime(exercises, targetMinutes, slots);
    days.push({
      dayOfWeek,
      label: `${DAY_NAMES[dayOfWeek]} — ${FOCUS_LABELS[focus]}`,
      focus,
      focusLabel: FOCUS_LABELS[focus],
      targetMinutes,
      estimatedMinutes: estimateSessionMinutes(fitted.exercises),
      isRest: false,
      exercises: fitted.exercises,
      gaps,
    });
    if (fitted.dropped.length > 0) {
      warnings.push(
        `${DAY_NAMES[dayOfWeek]}: trimmed ${fitted.dropped.length} accessory exercise(s) to fit ${targetMinutes} minutes.`,
      );
    }
    for (const gap of gaps) {
      warnings.push(
        `${DAY_NAMES[dayOfWeek]}: no ${gap.pattern.replace(/_/g, ' ')} exercise is available with your current equipment (needs ${gap.needed}). The slot was left out rather than replaced with something that does not train the same thing.`,
      );
    }
  }

  // Rest days for the remaining days of the week.
  for (let d = 0; d < 7; d += 1) {
    if (trainingDays.includes(d)) continue;
    days.push({
      dayOfWeek: d,
      label: `${DAY_NAMES[d]} — Rest or light activity`,
      focus: 'mobility',
      focusLabel: 'Rest or light activity',
      targetMinutes: 0,
      estimatedMinutes: 0,
      isRest: true,
      exercises: [],
      gaps: [],
    });
  }
  days.sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  explanation.push(
    `Split: ${kind.replace(/_/g, ' ')} across ${trainingDays.length} training day(s) you selected.`,
  );
  explanation.push(
    `Every exercise was filtered against the ${ctx.gymProfileName ?? 'active'} equipment profile (${ctx.availableEquipment.size - 1} item(s) available), so nothing in the plan needs equipment you do not have.`,
  );
  explanation.push(
    `Sets, reps and rest come from the ${PROGRAMMING_VERSION} rules for ${describeAge(profile.ageBand)} at "${level}" experience.`,
  );
  if (profile.interests.length > 0) {
    explanation.push(`Interests considered: ${profile.interests.join(', ')}.`);
  }
  for (const note of limitationFilter.notes) explanation.push(note);
  if (profile.ageBand !== 'adult_18_plus') {
    explanation.push(
      'This is an age-appropriate plan: conservative volume, technique before load, and no intensity targets.',
    );
  }
  explanation.push(`Target ${targetMinutes} minutes per session, including a warm-up and cool-down.`);

  return {
    splitKind: kind,
    generatorVersion: GENERATOR_VERSION,
    days,
    explanation,
    warnings,
    inputsSnapshot: {
      ageBand: profile.ageBand,
      experience: profile.experience,
      interests: profile.interests,
      trainingDays,
      sessionMinutes: targetMinutes,
      limitations: profile.limitations,
      equipment: [...ctx.availableEquipment].sort(),
      gymProfileName: ctx.gymProfileName ?? null,
      weekStart: ctx.weekStart,
      dislikedExerciseIds: ctx.dislikedExerciseIds ?? [],
      favouriteExerciseIds: ctx.favouriteExerciseIds ?? [],
    },
  };
}

/**
 * Explains why a slot could not be filled. Distinguishing "you lack the equipment"
 * from "those versions are above your experience level" matters: the fixes differ.
 */
function explainGap(
  slot: SlotTemplate,
  ctx: GeneratorContext,
  filters: EligibilityFilters,
): { pattern: MovementPattern; needed: string } {
  const pattern = slot.patterns[0] as MovementPattern;
  const catalog = ctx.catalog ?? EXERCISE_CATALOG;
  const samePattern = catalog.filter(
    (ex) =>
      slot.patterns.includes(ex.pattern) &&
      (!slot.muscles || slot.muscles.some((m) => ex.primary.includes(m))),
  );
  if (samePattern.length === 0) {
    return { pattern, needed: 'no exercise in the library trains this slot' };
  }
  const ageOk = samePattern.filter((ex) => isAgeAppropriate(ex, filters.ageBand));
  if (ageOk.length === 0) {
    return { pattern, needed: 'no age-appropriate option for this profile' };
  }
  const notExcluded = ageOk.filter(
    (ex) => !filters.excludedExerciseIds.has(ex.id) && !filters.excludedPatterns.has(ex.pattern),
  );
  if (notExcluded.length === 0) {
    return { pattern, needed: 'every option is excluded by your preferences or limitations' };
  }
  const equipOk = notExcluded.filter((ex) => checkEquipment(ex, ctx.availableEquipment).ok);
  if (equipOk.length === 0) {
    // Rank by how little is missing, so the cheapest way to unlock the slot is named first.
    const ranked = notExcluded
      .map((ex) => {
        const check = checkEquipment(ex, ctx.availableEquipment);
        return {
          cost: check.missingGroups.length,
          // More interchangeable options in a group means more ways to unlock it cheaply.
          alternatives: check.missingGroups.reduce((n, g) => n + g.length, 0),
          text: describeMissing(check),
        };
      })
      .filter((r) => r.text)
      .sort(
        (a, b) =>
          a.cost - b.cost || b.alternatives - a.alternatives || a.text.localeCompare(b.text),
      );
    const needs = [...new Set(ranked.map((r) => r.text))].slice(0, 3).join(' / ');
    return { pattern, needed: needs || 'equipment you do not have' };
  }
  // Equipment is fine, so the blocker is experience level.
  return {
    pattern,
    needed: `the available versions are rated above "${filters.level}" experience`,
  };
}

function conditioningMinutesFor(
  targetMinutes: number,
  focus: FocusKind,
  profile: GeneratorProfile,
): number {
  if (focus === 'conditioning') return Math.max(10, Math.round(targetMinutes * 0.6));
  if (focus === 'activity') return Math.max(8, Math.round(targetMinutes * 0.35));
  if (profile.interests.includes('general_endurance')) return 12;
  return 8;
}

function describeAge(ageBand: AgeBand): string {
  if (ageBand === 'under_13') return 'an under-13 activity profile';
  if (ageBand === 'teen_13_17') return 'a 13-17 profile';
  return 'an adult profile';
}

function buildRationale(
  exercise: ExerciseSeed,
  slot: SlotTemplate,
  pattern: MovementPattern,
  ctx: GeneratorContext,
): string {
  const parts: string[] = [`Fills the ${pattern.replace(/_/g, ' ')} slot (${slot.role}).`];
  const check = checkEquipment(exercise, ctx.availableEquipment);
  if (exercise.equip.length === 0) {
    parts.push('Needs no equipment.');
  } else {
    const used = exercise.equip
      .map((group) => group.find((id) => ctx.availableEquipment.has(id)))
      .filter((x): x is string => Boolean(x))
      .map(equipmentName);
    if (used.length > 0) parts.push(`Uses your ${used.join(' + ')}.`);
  }
  if (check.optionalAvailable.length > 0) {
    parts.push(`Optional: ${check.optionalAvailable.map(equipmentName).join(', ')}.`);
  }
  if ((ctx.favouriteExerciseIds ?? []).includes(exercise.id)) {
    parts.push('You marked this a favourite.');
  }
  return parts.join(' ');
}

/**
 * Fits a session into its minute budget by dropping droppable slots from the end.
 * Primary work is never dropped: a short session is a shorter session, not a rushed one.
 */
export function fitToTime(
  exercises: GeneratedExercise[],
  targetMinutes: number,
  slots: SlotTemplate[],
): { exercises: GeneratedExercise[]; dropped: GeneratedExercise[] } {
  const droppableRoles = new Set<SlotRole>(['accessory', 'mobility']);
  const kept = [...exercises];
  const dropped: GeneratedExercise[] = [];
  const budget = targetMinutes * 60;
  const total = () =>
    kept.reduce((s, e) => s + e.estimatedSeconds, 0) + WARMUP_SECONDS + COOLDOWN_SECONDS;

  while (total() > budget * 1.05 && kept.length > 2) {
    let removeIdx = -1;
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      const candidate = kept[i];
      if (candidate && droppableRoles.has(candidate.role)) {
        removeIdx = i;
        break;
      }
    }
    if (removeIdx === -1) {
      for (let i = kept.length - 1; i >= 0; i -= 1) {
        const candidate = kept[i];
        if (candidate && candidate.role === 'secondary') {
          removeIdx = i;
          break;
        }
      }
    }
    if (removeIdx === -1) break;
    const [removed] = kept.splice(removeIdx, 1);
    if (removed) dropped.push(removed);
  }

  /*
   * Still over budget with only the main work left: shorten rest first (down to a
   * 60-second floor), then trim sets, keeping at least 2 sets of anything primary.
   * A short session is a shorter session — never the same session rushed.
   */
  if (total() > budget * 1.05) {
    for (const e of kept) {
      if (e.restSeconds > 60) {
        const before = e.estimatedSeconds;
        const newRest = Math.max(60, e.restSeconds - 30);
        e.estimatedSeconds = before - e.sets * (e.restSeconds - newRest);
        e.restSeconds = newRest;
      }
      if (total() <= budget * 1.05) break;
    }
  }
  if (total() > budget * 1.05) {
    let guard = 0;
    while (total() > budget * 1.05 && guard < 20) {
      guard += 1;
      let trimmed = false;
      for (let i = kept.length - 1; i >= 0; i -= 1) {
        const e = kept[i];
        if (!e) continue;
        const floor = e.role === 'primary' ? 2 : 1;
        if (e.sets > floor) {
          const perSet = e.estimatedSeconds / e.sets;
          e.sets -= 1;
          e.estimatedSeconds = Math.round(perSet * e.sets);
          trimmed = true;
          break;
        }
      }
      if (!trimmed) break;
    }
  }

  void slots;
  return { exercises: kept, dropped };
}

export function exerciseName(id: string): string {
  return EXERCISE_BY_ID.get(id)?.name ?? id;
}
