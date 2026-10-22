import type { MOVEMENT_PATTERNS, EXERCISE_CATEGORIES } from '@/lib/db/schema';

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];
export type Level = 'new' | 'some' | 'regular' | 'experienced';

export interface ExerciseSeed {
  id: string;
  name: string;
  alias?: string[];
  pattern: MovementPattern;
  cat: ExerciseCategory;
  primary: string[];
  secondary?: string[];
  level: Level;
  /**
   * Equipment requirement groups. Each inner array is an "any-of" group and every
   * group must be satisfied. An empty array means no equipment is required.
   */
  equip: string[][];
  /** Nice to have but never gates eligibility. */
  optional?: string[];
  setup: string[];
  steps: string[];
  cues?: string[];
  safety?: string[];
  unilateral?: boolean;
  /** Logged as time, not reps. */
  timed?: boolean;
  /** External load can be added and is worth logging. */
  loadable?: boolean;
  /** Relative time cost per set (1 = typical). */
  tempo?: number;
  /** false => never auto-assigned to a 13-17 account. */
  teenOk?: boolean;
  /** true => suitable for an under-13 activity session. */
  childOk?: boolean;
  /** Hand-curated substitutes, checked for equipment before being offered. */
  subs?: string[];
  prog?: string[];
  regr?: string[];
}

export const MOVEMENT_PATTERN_LABELS: Record<MovementPattern, string> = {
  squat: 'Squat',
  hinge: 'Hinge',
  lunge: 'Lunge / split stance',
  horizontal_push: 'Horizontal push',
  vertical_push: 'Vertical push',
  horizontal_pull: 'Horizontal pull',
  vertical_pull: 'Vertical pull',
  core_anti_extension: 'Core — anti-extension',
  core_anti_rotation: 'Core — anti-rotation',
  core_flexion: 'Core — flexion',
  carry: 'Carry',
  hip_isolation: 'Hip isolation',
  knee_isolation: 'Knee isolation',
  calf: 'Calf',
  elbow_flexion: 'Elbow flexion',
  elbow_extension: 'Elbow extension',
  shoulder_isolation: 'Shoulder isolation',
  rotation: 'Rotation',
  cardio_steady: 'Steady cardio',
  cardio_interval: 'Interval cardio',
  mobility: 'Mobility',
  balance: 'Balance',
  plyometric: 'Plyometric',
};

export const MUSCLE_GROUPS = [
  'quadriceps',
  'hamstrings',
  'glutes',
  'adductors',
  'abductors',
  'calves',
  'chest',
  'upper_back',
  'lats',
  'traps',
  'rear_delts',
  'front_delts',
  'side_delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'lower_back',
  'hip_flexors',
  'full_body',
  'cardiovascular',
] as const;

export const MUSCLE_LABELS: Record<string, string> = {
  quadriceps: 'Quadriceps',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  adductors: 'Inner thigh',
  abductors: 'Outer hip',
  calves: 'Calves',
  chest: 'Chest',
  upper_back: 'Upper back',
  lats: 'Lats',
  traps: 'Traps',
  rear_delts: 'Rear shoulders',
  front_delts: 'Front shoulders',
  side_delts: 'Side shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  lower_back: 'Lower back',
  hip_flexors: 'Hip flexors',
  full_body: 'Full body',
  cardiovascular: 'Cardiovascular',
};
