import { EQUIPMENT_CATALOG, EQUIPMENT_BY_ID } from '@/lib/content/equipment';
import type { ExerciseSeed } from '@/lib/content/exercise-types';

export interface EquipmentCheck {
  ok: boolean;
  /** Requirement groups that are not satisfied. Each inner array is an any-of group. */
  missingGroups: string[][];
  /** Flattened, de-duplicated list of equipment that would unblock the exercise. */
  missingIds: string[];
  /** Optional equipment the user happens to have. */
  optionalAvailable: string[];
}

/**
 * Expands a raw equipment selection into everything it functionally provides.
 * `none` is always present: every environment has floor space.
 */
export function expandEquipment(ids: Iterable<string>): Set<string> {
  const out = new Set<string>(['none']);
  const queue: string[] = [];
  for (const id of ids) {
    if (!out.has(id)) {
      out.add(id);
      queue.push(id);
    }
  }
  while (queue.length > 0) {
    const current = queue.pop() as string;
    const seed = EQUIPMENT_BY_ID.get(current);
    for (const implied of seed?.implies ?? []) {
      if (!out.has(implied)) {
        out.add(implied);
        queue.push(implied);
      }
    }
  }
  return out;
}

/**
 * The single authority on "can this person do this exercise with what they have".
 * Every requirement group must be satisfied by at least one available item.
 * An exercise with no requirement groups needs nothing.
 */
export function checkEquipment(
  exercise: Pick<ExerciseSeed, 'equip' | 'optional'>,
  available: Set<string>,
): EquipmentCheck {
  const missingGroups: string[][] = [];
  for (const group of exercise.equip) {
    if (group.length === 0) {
      // A requirement group with no options can never be satisfied; treat as blocking
      // rather than silently passing.
      missingGroups.push([]);
      continue;
    }
    const satisfied = group.some((id) => available.has(id));
    if (!satisfied) missingGroups.push([...group]);
  }
  const missingIds = [...new Set(missingGroups.flat())];
  const optionalAvailable = (exercise.optional ?? []).filter((id) => available.has(id));
  return { ok: missingGroups.length === 0, missingGroups, missingIds, optionalAvailable };
}

export function isEligibleByEquipment(
  exercise: Pick<ExerciseSeed, 'equip' | 'optional'>,
  available: Set<string>,
): boolean {
  return checkEquipment(exercise, available).ok;
}

export function describeMissing(check: EquipmentCheck): string {
  if (check.ok) return '';
  return check.missingGroups
    .map((group) =>
      group.length === 0
        ? 'an unspecified piece of equipment'
        : group.map((id) => EQUIPMENT_BY_ID.get(id)?.name ?? id).join(' or '),
    )
    .join(', plus ');
}

export function equipmentName(id: string): string {
  return EQUIPMENT_BY_ID.get(id)?.name ?? id;
}

/** Equipment requirements rendered for the UI, with optional items marked. */
export function equipmentRequirementSummary(exercise: ExerciseSeed): string[] {
  const required = exercise.equip.map((group) => group.map(equipmentName).join(' or '));
  const optional = (exercise.optional ?? []).map((id) => `${equipmentName(id)} (optional)`);
  if (required.length === 0 && optional.length === 0) return ['No equipment needed'];
  if (required.length === 0) return ['No equipment needed', ...optional];
  return [...required, ...optional];
}

export const ALL_EQUIPMENT_IDS = EQUIPMENT_CATALOG.map((e) => e.id);
