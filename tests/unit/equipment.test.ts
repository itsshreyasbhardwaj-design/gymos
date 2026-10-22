import { describe, it, expect } from 'vitest';
import {
  expandEquipment,
  checkEquipment,
  isEligibleByEquipment,
  describeMissing,
  equipmentRequirementSummary,
} from '@/lib/engines/equipment';
import { EXERCISE_BY_ID, EXERCISE_CATALOG } from '@/lib/content/exercises';
import { EQUIPMENT_PRESETS } from '@/lib/content/equipment';

const ex = (id: string) => {
  const found = EXERCISE_BY_ID.get(id);
  if (!found) throw new Error(`missing fixture exercise ${id}`);
  return found;
};

describe('expandEquipment', () => {
  it('always includes "none"', () => {
    expect(expandEquipment([]).has('none')).toBe(true);
  });

  it('expands implied equipment transitively', () => {
    const set = expandEquipment(['power_rack']);
    expect(set.has('squat_rack')).toBe(true);
    expect(set.has('pull_up_bar')).toBe(true);
  });

  it('expands a chain: adjustable bench implies flat bench implies stable bench', () => {
    const set = expandEquipment(['adjustable_bench']);
    expect(set.has('flat_bench')).toBe(true);
    expect(set.has('stable_bench')).toBe(true);
  });

  it('does not invent equipment that was not implied', () => {
    const set = expandEquipment(['dumbbells']);
    expect(set.has('barbell')).toBe(false);
  });
});

describe('checkEquipment', () => {
  it('passes exercises with no requirements', () => {
    const result = checkEquipment(ex('push-up'), expandEquipment([]));
    expect(result.ok).toBe(true);
    expect(result.missingGroups).toEqual([]);
  });

  it('satisfies an any-of group with one matching item', () => {
    expect(checkEquipment(ex('dumbbell-row'), expandEquipment(['kettlebell'])).ok).toBe(true);
    expect(checkEquipment(ex('dumbbell-row'), expandEquipment(['dumbbells'])).ok).toBe(true);
  });

  it('requires EVERY group, not just one', () => {
    // Barbell bench press needs bar + plates + bench + rack.
    const partial = expandEquipment(['barbell', 'weight_plates']);
    const result = checkEquipment(ex('barbell-bench-press'), partial);
    expect(result.ok).toBe(false);
    expect(result.missingGroups.length).toBeGreaterThanOrEqual(2);

    const complete = expandEquipment(['barbell', 'weight_plates', 'flat_bench', 'power_rack']);
    expect(checkEquipment(ex('barbell-bench-press'), complete).ok).toBe(true);
  });

  it('never gates on optional equipment', () => {
    const noOptional = expandEquipment([]);
    const result = checkEquipment(ex('reverse-lunge'), noOptional);
    expect(result.ok).toBe(true);
    expect(result.optionalAvailable).toEqual([]);
  });

  it('reports optional equipment the user happens to own', () => {
    const result = checkEquipment(ex('reverse-lunge'), expandEquipment(['dumbbells']));
    expect(result.optionalAvailable).toContain('dumbbells');
  });

  it('treats an empty requirement group as blocking rather than silently passing', () => {
    const broken = { equip: [[]] as string[][], optional: [] };
    expect(checkEquipment(broken, expandEquipment(['barbell'])).ok).toBe(false);
  });

  it('describes what is missing in human terms', () => {
    const result = checkEquipment(ex('lat-pulldown-ex'), expandEquipment([]));
    expect(describeMissing(result)).toMatch(/Lat pulldown|Cable machine/i);
  });
});

describe('equipment coverage across presets', () => {
  it('unlocks strictly more exercises as equipment grows', () => {
    const count = (ids: string[]) =>
      EXERCISE_CATALOG.filter((e) => isEligibleByEquipment(e, expandEquipment(ids))).length;
    const bodyweight = count(EQUIPMENT_PRESETS.bodyweight_home!.ids);
    const minimal = count(EQUIPMENT_PRESETS.minimal_home!.ids);
    const commercial = count(EQUIPMENT_PRESETS.commercial_gym!.ids);
    expect(bodyweight).toBeLessThan(minimal);
    expect(minimal).toBeLessThan(commercial);
  });

  it('leaves genuine gaps with bodyweight only rather than claiming full coverage', () => {
    const set = expandEquipment(EQUIPMENT_PRESETS.bodyweight_home!.ids);
    const usable = EXERCISE_CATALOG.filter((e) => isEligibleByEquipment(e, set));
    expect(usable.length).toBeLessThan(EXERCISE_CATALOG.length);
    const patterns = new Set(usable.map((e) => e.pattern));
    // A machine-dependent pattern cannot be covered by bodyweight alone.
    expect(patterns.has('vertical_pull')).toBe(false);
  });
});

describe('equipmentRequirementSummary', () => {
  it('says "No equipment needed" when nothing is required', () => {
    expect(equipmentRequirementSummary(ex('push-up'))[0]).toBe('No equipment needed');
  });

  it('joins any-of groups with "or"', () => {
    expect(equipmentRequirementSummary(ex('dumbbell-row'))[0]).toContain(' or ');
  });

  it('marks optional equipment as optional', () => {
    expect(equipmentRequirementSummary(ex('reverse-lunge')).join(' ')).toContain('(optional)');
  });
});
