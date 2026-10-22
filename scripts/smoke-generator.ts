import { generatePlan } from '../lib/engines/workout-generator';
import { expandEquipment } from '../lib/engines/equipment';
import { EQUIPMENT_PRESETS } from '../lib/content/equipment';

function show(title: string, plan: ReturnType<typeof generatePlan>) {
  console.log(`\n=== ${title} | split=${plan.splitKind} ===`);
  for (const d of plan.days.filter((x) => !x.isRest)) {
    console.log(` ${d.label} (${d.estimatedMinutes}/${d.targetMinutes} min)`);
    for (const e of d.exercises) {
      const dose = e.durationSeconds ? `${e.sets}x${e.durationSeconds}s` : `${e.sets}x${e.repsLow}-${e.repsHigh}`;
      console.log(`   - ${e.name} [${e.slotPattern}/${e.role}] ${dose} rest ${e.restSeconds}s`);
    }
    if (d.gaps.length) console.log(`   gaps: ${d.gaps.map((g) => g.pattern).join(', ')}`);
  }
  if (plan.warnings.length) console.log(' warnings:', plan.warnings.length);
  plan.warnings.slice(0, 3).forEach((w) => console.log('   !', w));
}

const gymEquip = expandEquipment(EQUIPMENT_PRESETS.commercial_gym!.ids);
const bodyweight = expandEquipment(EQUIPMENT_PRESETS.bodyweight_home!.ids);
const travel = expandEquipment(EQUIPMENT_PRESETS.travel!.ids);

show(
  'adult regular, 4 days, commercial gym, 60 min',
  generatePlan({
    profile: {
      userId: 'u1',
      ageBand: 'adult_18_plus',
      experience: 'regular',
      interests: ['strength_skills', 'general_fitness'],
      trainingDays: [1, 2, 4, 5],
      sessionMinutes: 60,
      limitations: [],
    },
    availableEquipment: gymEquip,
    gymProfileName: 'Main Gym',
    weekStart: '2026-10-19',
  }),
);

show(
  'beginner, 3 days, bodyweight only, 30 min',
  generatePlan({
    profile: {
      userId: 'u2',
      ageBand: 'adult_18_plus',
      experience: 'new',
      interests: ['general_fitness', 'mobility_flexibility'],
      trainingDays: [1, 3, 5],
      sessionMinutes: 30,
      limitations: [],
    },
    availableEquipment: bodyweight,
    gymProfileName: 'Home',
    weekStart: '2026-10-19',
  }),
);

show(
  'teen 15, 3 days, travel kit, 40 min',
  generatePlan({
    profile: {
      userId: 'u3',
      ageBand: 'teen_13_17',
      experience: 'experienced',
      interests: ['recreational_sports', 'cardiovascular'],
      trainingDays: [2, 4, 6],
      sessionMinutes: 40,
      limitations: [],
    },
    availableEquipment: travel,
    gymProfileName: 'Travel',
    weekStart: '2026-10-19',
  }),
);

show(
  'adult with knee + lower back sensitivity, 20 min, minimal home',
  generatePlan({
    profile: {
      userId: 'u4',
      ageBand: 'adult_18_plus',
      experience: 'some',
      interests: ['general_fitness'],
      trainingDays: [1, 4],
      sessionMinutes: 20,
      limitations: ['knee', 'lower_back'],
    },
    availableEquipment: expandEquipment(EQUIPMENT_PRESETS.minimal_home!.ids),
    weekStart: '2026-10-19',
  }),
);

show(
  'under 13 activity, 2 days, bodyweight',
  generatePlan({
    profile: {
      userId: 'u5',
      ageBand: 'under_13',
      experience: 'some',
      interests: ['balanced_activity'],
      trainingDays: [3, 6],
      sessionMinutes: 35,
      limitations: [],
    },
    availableEquipment: bodyweight,
    weekStart: '2026-10-19',
  }),
);

// determinism check
const mk = () =>
  generatePlan({
    profile: {
      userId: 'u1',
      ageBand: 'adult_18_plus',
      experience: 'regular',
      interests: ['strength_skills'],
      trainingDays: [1, 3, 5],
      sessionMinutes: 50,
      limitations: [],
    },
    availableEquipment: gymEquip,
    weekStart: '2026-10-19',
  });
console.log(
  '\ndeterministic:',
  JSON.stringify(mk().days) === JSON.stringify(mk().days) ? 'yes' : 'NO',
);
