import { LOWER_BODY } from './exercises-lower';
import { UPPER_BODY } from './exercises-upper';
import { CORE_AND_CONDITIONING } from './exercises-core-cardio';
import type { ExerciseSeed } from './exercise-types';
import { EQUIPMENT_BY_ID } from './equipment';

export const EXERCISE_CATALOG: ExerciseSeed[] = [
  ...LOWER_BODY,
  ...UPPER_BODY,
  ...CORE_AND_CONDITIONING,
];

export const EXERCISE_BY_ID = new Map(EXERCISE_CATALOG.map((e) => [e.id, e]));

/**
 * The exercise instructions in this catalog are internal drafts compiled for GymOS.
 * They are stored with review_status = 'draft' and must be reviewed by a qualified
 * professional before being presented as professional guidance (see EQUIPMENT_ENGINE.md
 * and the admin review queue at /admin/content).
 */
export const EXERCISE_SOURCES = [
  {
    id: 'internal-draft-2026',
    label: 'GymOS internal draft',
    citation:
      'Instructional text drafted in-house for GymOS from general resistance-training practice. Not professionally reviewed.',
    url: null,
    kind: 'internal_draft' as const,
  },
  {
    id: 'who-pa-2020',
    label: 'WHO physical activity guidelines (2020)',
    citation:
      'World Health Organization. WHO guidelines on physical activity and sedentary behaviour, 2020. Used for weekly activity volume targets only.',
    url: 'https://www.who.int/publications/i/item/9789240015128',
    kind: 'guideline' as const,
  },
  {
    id: 'youth-rt-consensus',
    label: 'Youth resistance training consensus positions',
    citation:
      'Programming limits for under-18 accounts follow widely published youth resistance-training position statements (conservative loading, technique-first, supervision). Summarised in-house; consult the primary statements before public launch.',
    url: null,
    kind: 'organisation' as const,
  },
];

export interface ContentIssue {
  kind: string;
  id: string;
  detail: string;
}

/** Structural validation of the exercise catalog. Run in tests and at seed time. */
export function validateExerciseCatalog(catalog: ExerciseSeed[] = EXERCISE_CATALOG): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const ids = new Set<string>();
  for (const ex of catalog) {
    if (ids.has(ex.id)) issues.push({ kind: 'duplicate_id', id: ex.id, detail: 'id appears twice' });
    ids.add(ex.id);
    if (!/^[a-z0-9-]+$/.test(ex.id)) {
      issues.push({ kind: 'bad_slug', id: ex.id, detail: 'id must be kebab-case' });
    }
    if (ex.setup.length === 0) {
      issues.push({ kind: 'missing_setup', id: ex.id, detail: 'no setup instructions' });
    }
    if (ex.steps.length === 0) {
      issues.push({ kind: 'missing_steps', id: ex.id, detail: 'no movement instructions' });
    }
    if (ex.primary.length === 0) {
      issues.push({ kind: 'missing_primary', id: ex.id, detail: 'no primary muscles' });
    }
    for (const group of ex.equip) {
      if (group.length === 0) {
        issues.push({ kind: 'empty_group', id: ex.id, detail: 'equipment group with no options' });
      }
      for (const eq of group) {
        if (!EQUIPMENT_BY_ID.has(eq)) {
          issues.push({ kind: 'unknown_equipment', id: ex.id, detail: eq });
        }
      }
    }
    for (const eq of ex.optional ?? []) {
      if (!EQUIPMENT_BY_ID.has(eq)) {
        issues.push({ kind: 'unknown_optional_equipment', id: ex.id, detail: eq });
      }
    }
  }
  // Relationship targets must exist.
  for (const ex of catalog) {
    for (const [field, list] of [
      ['subs', ex.subs],
      ['prog', ex.prog],
      ['regr', ex.regr],
    ] as const) {
      for (const target of list ?? []) {
        if (!ids.has(target)) {
          issues.push({ kind: `unknown_${field}`, id: ex.id, detail: target });
        }
        if (target === ex.id) {
          issues.push({ kind: `self_${field}`, id: ex.id, detail: target });
        }
      }
    }
  }
  return issues;
}

export { type ExerciseSeed };
