import type { MovementPattern } from '@/lib/content/exercise-types';
import type { SlotRole } from './programming';

export interface SlotTemplate {
  /** Candidate patterns in preference order. The first with an eligible exercise wins. */
  patterns: MovementPattern[];
  role: SlotRole;
  /** Accessory slots are dropped first when the session has to fit a shorter window. */
  droppable: boolean;
  /** Restrict to this exercise category when set (e.g. isolation for a fly slot). */
  category?: 'compound' | 'accessory' | 'isolation' | 'cardio' | 'mobility' | 'skill';
  /**
   * Require one of these primary muscles. Stops a pattern-only match putting, say, a
   * wrist curl into a triceps slot just because both are tagged elbow_extension.
   */
  muscles?: string[];
  label?: string;
}

export type FocusKind =
  | 'full_body'
  | 'upper'
  | 'lower'
  | 'push'
  | 'pull'
  | 'conditioning'
  | 'mobility'
  | 'activity';

export const FOCUS_LABELS: Record<FocusKind, string> = {
  full_body: 'Full body',
  upper: 'Upper body',
  lower: 'Lower body',
  push: 'Push',
  pull: 'Pull',
  conditioning: 'Cardio & conditioning',
  mobility: 'Mobility & recovery',
  activity: 'Activity session',
};

export const DAY_TEMPLATES: Record<FocusKind, SlotTemplate[]> = {
  full_body: [
    { patterns: ['squat'], role: 'primary', droppable: false, category: 'compound' },
    { patterns: ['horizontal_push'], role: 'primary', droppable: false, category: 'compound' },
    { patterns: ['horizontal_pull', 'vertical_pull'], role: 'secondary', droppable: false },
    { patterns: ['hinge'], role: 'secondary', droppable: true },
    { patterns: ['lunge'], role: 'accessory', droppable: true },
    { patterns: ['core_anti_extension', 'core_anti_rotation'], role: 'accessory', droppable: true },
  ],
  upper: [
    { patterns: ['horizontal_push'], role: 'primary', droppable: false, category: 'compound' },
    { patterns: ['vertical_pull', 'horizontal_pull'], role: 'primary', droppable: false },
    { patterns: ['vertical_push'], role: 'secondary', droppable: true },
    { patterns: ['horizontal_pull'], role: 'secondary', droppable: true },
    { patterns: ['elbow_flexion'], role: 'accessory', droppable: true, muscles: ['biceps'] },
    { patterns: ['elbow_extension'], role: 'accessory', droppable: true, muscles: ['triceps'] },
    { patterns: ['shoulder_isolation'], role: 'accessory', droppable: true, muscles: ['side_delts', 'front_delts'] },
    { patterns: ['core_anti_extension'], role: 'accessory', droppable: true },
  ],
  lower: [
    { patterns: ['squat'], role: 'primary', droppable: false, category: 'compound' },
    { patterns: ['hinge'], role: 'primary', droppable: false },
    { patterns: ['lunge'], role: 'secondary', droppable: true },
    { patterns: ['knee_isolation'], role: 'accessory', droppable: true },
    { patterns: ['hip_isolation'], role: 'accessory', droppable: true },
    { patterns: ['calf'], role: 'accessory', droppable: true },
    { patterns: ['core_anti_rotation', 'core_anti_extension'], role: 'accessory', droppable: true },
  ],
  push: [
    { patterns: ['horizontal_push'], role: 'primary', droppable: false, category: 'compound' },
    { patterns: ['vertical_push'], role: 'primary', droppable: false },
    { patterns: ['horizontal_push'], role: 'secondary', droppable: true, category: 'isolation' },
    { patterns: ['shoulder_isolation'], role: 'accessory', droppable: true, muscles: ['side_delts', 'front_delts'] },
    { patterns: ['elbow_extension'], role: 'accessory', droppable: true, muscles: ['triceps'] },
    { patterns: ['core_anti_extension'], role: 'accessory', droppable: true },
  ],
  pull: [
    { patterns: ['vertical_pull'], role: 'primary', droppable: false },
    { patterns: ['horizontal_pull'], role: 'primary', droppable: false, category: 'compound' },
    { patterns: ['horizontal_pull'], role: 'secondary', droppable: true, category: 'isolation' },
    { patterns: ['elbow_flexion'], role: 'accessory', droppable: true, muscles: ['biceps'] },
    { patterns: ['hinge'], role: 'accessory', droppable: true },
    { patterns: ['core_anti_rotation'], role: 'accessory', droppable: true },
  ],
  conditioning: [
    { patterns: ['cardio_steady', 'cardio_interval'], role: 'conditioning', droppable: false },
    { patterns: ['core_anti_extension', 'core_anti_rotation'], role: 'accessory', droppable: true },
    { patterns: ['mobility'], role: 'mobility', droppable: true },
  ],
  mobility: [
    { patterns: ['mobility'], role: 'mobility', droppable: false },
    { patterns: ['mobility'], role: 'mobility', droppable: false },
    { patterns: ['mobility'], role: 'mobility', droppable: true },
    { patterns: ['balance'], role: 'mobility', droppable: true },
    { patterns: ['cardio_steady'], role: 'conditioning', droppable: true },
  ],
  activity: [
    { patterns: ['cardio_steady'], role: 'conditioning', droppable: false },
    { patterns: ['squat', 'lunge'], role: 'primary', droppable: false },
    { patterns: ['horizontal_push'], role: 'secondary', droppable: true },
    { patterns: ['horizontal_pull'], role: 'secondary', droppable: true },
    { patterns: ['balance', 'core_anti_extension'], role: 'accessory', droppable: true },
    { patterns: ['mobility'], role: 'mobility', droppable: true },
  ],
};

/** Extra slots appended when the user has a matching training interest. */
export const INTEREST_SLOTS: Record<string, SlotTemplate> = {
  cardiovascular: {
    patterns: ['cardio_interval', 'cardio_steady'],
    role: 'conditioning',
    droppable: true,
    label: 'Conditioning finisher',
  },
  general_endurance: {
    patterns: ['cardio_steady'],
    role: 'conditioning',
    droppable: true,
    label: 'Endurance finisher',
  },
  mobility_flexibility: {
    patterns: ['mobility'],
    role: 'mobility',
    droppable: true,
    label: 'Mobility finisher',
  },
  recreational_sports: {
    patterns: ['balance', 'rotation'],
    role: 'accessory',
    droppable: true,
    label: 'Sports support',
  },
};

export const TRAINING_INTERESTS = [
  { id: 'general_fitness', label: 'General fitness' },
  { id: 'strength_skills', label: 'Strength skills' },
  { id: 'cardiovascular', label: 'Cardiovascular fitness' },
  { id: 'mobility_flexibility', label: 'Mobility and flexibility' },
  { id: 'recreational_sports', label: 'Recreational sports' },
  { id: 'general_endurance', label: 'General endurance' },
  { id: 'balanced_activity', label: 'Balanced physical activity' },
] as const;

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
