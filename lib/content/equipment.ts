import type { EQUIPMENT_CATEGORIES } from '@/lib/db/schema';

export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export interface EquipmentSeed {
  id: string;
  name: string;
  category: EquipmentCategory;
  aliases?: string[];
  description?: string;
  /** Owning this item functionally provides these other items too. */
  implies?: string[];
}

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  bodyweight_basic: 'Bodyweight & basics',
  free_weights: 'Free weights',
  resistance: 'Resistance equipment',
  racks_benches: 'Racks & benches',
  upper_machines: 'Upper-body machines',
  lower_machines: 'Lower-body machines',
  cardio: 'Cardio equipment',
  mobility_other: 'Mobility & other',
};

export const EQUIPMENT_CATALOG: EquipmentSeed[] = [
  // ---------------------------------------------------- bodyweight and basics
  {
    id: 'none',
    name: 'No equipment',
    category: 'bodyweight_basic',
    aliases: ['bodyweight', 'floor only'],
    description: 'Floor space only. Every profile has this implicitly.',
  },
  { id: 'exercise_mat', name: 'Exercise mat', category: 'bodyweight_basic', aliases: ['yoga mat'] },
  {
    id: 'stable_bench',
    name: 'Stable bench or sturdy chair',
    category: 'bodyweight_basic',
    aliases: ['chair', 'box', 'sofa edge'],
    description: 'Any stable raised surface that takes your bodyweight.',
  },
  { id: 'step_platform', name: 'Step platform', category: 'bodyweight_basic', aliases: ['aerobic step'] },
  { id: 'pull_up_bar', name: 'Pull-up bar', category: 'bodyweight_basic', aliases: ['chin-up bar', 'doorway bar'] },
  { id: 'dip_station', name: 'Dip station', category: 'bodyweight_basic', aliases: ['parallel bars', 'dip bars'] },

  // -------------------------------------------------------------- free weights
  { id: 'dumbbells', name: 'Dumbbells (fixed)', category: 'free_weights', aliases: ['dbs'] },
  {
    id: 'adjustable_dumbbells',
    name: 'Adjustable dumbbells',
    category: 'free_weights',
    implies: ['dumbbells'],
  },
  { id: 'barbell', name: 'Barbell', category: 'free_weights', aliases: ['olympic bar'] },
  { id: 'weight_plates', name: 'Weight plates', category: 'free_weights', aliases: ['plates', 'discs'] },
  { id: 'kettlebell', name: 'Kettlebells', category: 'free_weights', aliases: ['kb'] },
  { id: 'ez_curl_bar', name: 'EZ curl bar', category: 'free_weights' },
  { id: 'medicine_ball', name: 'Medicine ball', category: 'free_weights', aliases: ['med ball', 'slam ball'] },

  // -------------------------------------------------------------- resistance
  { id: 'resistance_bands', name: 'Resistance bands (handled)', category: 'resistance', aliases: ['tube bands'] },
  { id: 'loop_bands', name: 'Loop bands (long)', category: 'resistance', aliases: ['pull-up bands', 'power bands'] },
  { id: 'mini_bands', name: 'Mini bands', category: 'resistance', aliases: ['glute bands', 'booty bands'] },
  { id: 'suspension_trainer', name: 'Suspension trainer', category: 'resistance', aliases: ['trx', 'straps'] },
  {
    id: 'cable_machine',
    name: 'Cable machine',
    category: 'resistance',
    aliases: ['cable stack', 'cable column'],
  },

  // ------------------------------------------------------------ racks/benches
  { id: 'adjustable_bench', name: 'Adjustable bench', category: 'racks_benches', implies: ['flat_bench', 'stable_bench'] },
  { id: 'flat_bench', name: 'Flat bench', category: 'racks_benches', implies: ['stable_bench'] },
  { id: 'squat_rack', name: 'Squat rack', category: 'racks_benches', aliases: ['squat stands'] },
  { id: 'power_rack', name: 'Power rack', category: 'racks_benches', aliases: ['power cage'], implies: ['squat_rack', 'pull_up_bar'] },
  { id: 'smith_machine', name: 'Smith machine', category: 'racks_benches' },

  // ------------------------------------------------------- upper-body machines
  { id: 'chest_press_machine', name: 'Chest press machine', category: 'upper_machines' },
  { id: 'incline_chest_press_machine', name: 'Incline chest press machine', category: 'upper_machines' },
  { id: 'shoulder_press_machine', name: 'Shoulder press machine', category: 'upper_machines' },
  { id: 'lat_pulldown', name: 'Lat pulldown', category: 'upper_machines' },
  { id: 'seated_row_machine', name: 'Seated row machine', category: 'upper_machines' },
  { id: 'pec_deck', name: 'Pec deck', category: 'upper_machines', aliases: ['chest fly machine'] },
  { id: 'reverse_pec_deck', name: 'Reverse pec deck', category: 'upper_machines', aliases: ['rear delt machine'] },
  { id: 'assisted_pullup_machine', name: 'Assisted pull-up / dip machine', category: 'upper_machines' },
  { id: 'cable_crossover', name: 'Cable crossover', category: 'upper_machines', implies: ['cable_machine'] },
  {
    id: 'functional_trainer',
    name: 'Functional trainer',
    category: 'upper_machines',
    implies: ['cable_machine', 'cable_crossover'],
  },

  // ------------------------------------------------------- lower-body machines
  { id: 'leg_press', name: 'Leg press', category: 'lower_machines' },
  { id: 'hack_squat', name: 'Hack squat', category: 'lower_machines' },
  { id: 'leg_extension', name: 'Leg extension', category: 'lower_machines' },
  { id: 'seated_leg_curl', name: 'Seated leg curl', category: 'lower_machines' },
  { id: 'lying_leg_curl', name: 'Lying leg curl', category: 'lower_machines' },
  { id: 'hip_thrust_machine', name: 'Hip thrust machine', category: 'lower_machines' },
  { id: 'hip_abduction_machine', name: 'Hip abduction machine', category: 'lower_machines' },
  { id: 'hip_adduction_machine', name: 'Hip adduction machine', category: 'lower_machines' },
  { id: 'calf_raise_machine', name: 'Calf raise machine', category: 'lower_machines' },
  { id: 'glute_kickback_machine', name: 'Glute kickback machine', category: 'lower_machines' },

  // ------------------------------------------------------------------- cardio
  { id: 'treadmill', name: 'Treadmill', category: 'cardio' },
  { id: 'exercise_bike', name: 'Exercise bicycle', category: 'cardio', aliases: ['upright bike'] },
  { id: 'spin_bike', name: 'Spin bike', category: 'cardio', implies: ['exercise_bike'] },
  { id: 'rowing_machine', name: 'Rowing machine', category: 'cardio', aliases: ['erg'] },
  { id: 'elliptical', name: 'Elliptical', category: 'cardio', aliases: ['cross trainer'] },
  { id: 'stair_climber', name: 'Stair climber', category: 'cardio', aliases: ['stepmill'] },
  { id: 'jump_rope', name: 'Jump rope', category: 'cardio', aliases: ['skipping rope'] },
  { id: 'open_space', name: 'Open space to run or walk', category: 'cardio', aliases: ['park', 'street', 'track'] },

  // --------------------------------------------------------- mobility / other
  { id: 'foam_roller', name: 'Foam roller', category: 'mobility_other' },
  { id: 'stability_ball', name: 'Stability ball', category: 'mobility_other', aliases: ['swiss ball'] },
  { id: 'balance_pad', name: 'Balance pad', category: 'mobility_other', aliases: ['wobble cushion'] },
  { id: 'back_extension_station', name: 'Back extension station', category: 'mobility_other', aliases: ['roman chair', 'ghd'] },
  { id: 'ab_wheel', name: 'Ab wheel', category: 'mobility_other' },
  { id: 'sliders', name: 'Sliders / furniture gliders', category: 'mobility_other', aliases: ['valslides'] },
  { id: 'wall_space', name: 'Clear wall space', category: 'mobility_other' },
];

export const EQUIPMENT_BY_ID = new Map(EQUIPMENT_CATALOG.map((e) => [e.id, e]));

/** Preset inventories offered during onboarding. `none` is always implied. */
export const EQUIPMENT_PRESETS: Record<string, { label: string; description: string; ids: string[] }> = {
  bodyweight_home: {
    label: 'Bodyweight at home',
    description: 'Floor space and a mat, nothing else needed.',
    ids: ['exercise_mat', 'stable_bench', 'wall_space'],
  },
  minimal_home: {
    label: 'Minimal home setup',
    description: 'A mat, a pair of dumbbells and bands.',
    ids: ['exercise_mat', 'stable_bench', 'dumbbells', 'resistance_bands', 'mini_bands', 'wall_space'],
  },
  garage_gym: {
    label: 'Home / garage gym',
    description: 'Barbell, rack, bench, adjustable dumbbells.',
    ids: [
      'exercise_mat',
      'barbell',
      'weight_plates',
      'power_rack',
      'adjustable_bench',
      'adjustable_dumbbells',
      'kettlebell',
      'pull_up_bar',
      'loop_bands',
      'jump_rope',
    ],
  },
  apartment_gym: {
    label: 'Apartment gym',
    description: 'A few machines, dumbbells, treadmill.',
    ids: [
      'exercise_mat',
      'dumbbells',
      'flat_bench',
      'treadmill',
      'exercise_bike',
      'cable_machine',
      'lat_pulldown',
      'leg_press',
      'stability_ball',
    ],
  },
  commercial_gym: {
    label: 'Full commercial gym',
    description: 'Most machines, full free-weight area, cardio floor.',
    ids: [
      'exercise_mat',
      'dumbbells',
      'adjustable_dumbbells',
      'barbell',
      'weight_plates',
      'kettlebell',
      'ez_curl_bar',
      'medicine_ball',
      'resistance_bands',
      'loop_bands',
      'mini_bands',
      'cable_machine',
      'cable_crossover',
      'functional_trainer',
      'adjustable_bench',
      'flat_bench',
      'power_rack',
      'squat_rack',
      'smith_machine',
      'chest_press_machine',
      'incline_chest_press_machine',
      'shoulder_press_machine',
      'lat_pulldown',
      'seated_row_machine',
      'pec_deck',
      'reverse_pec_deck',
      'assisted_pullup_machine',
      'leg_press',
      'hack_squat',
      'leg_extension',
      'seated_leg_curl',
      'lying_leg_curl',
      'hip_thrust_machine',
      'hip_abduction_machine',
      'hip_adduction_machine',
      'calf_raise_machine',
      'treadmill',
      'exercise_bike',
      'spin_bike',
      'rowing_machine',
      'elliptical',
      'stair_climber',
      'pull_up_bar',
      'dip_station',
      'back_extension_station',
      'stability_ball',
      'foam_roller',
    ],
  },
  travel: {
    label: 'Travel setup',
    description: 'Hotel room: bodyweight plus a band and a chair.',
    ids: ['loop_bands', 'mini_bands', 'stable_bench', 'wall_space', 'open_space'],
  },
  outdoor: {
    label: 'Outdoor / park',
    description: 'Open space, a bar and a bench.',
    ids: ['open_space', 'pull_up_bar', 'dip_station', 'stable_bench', 'step_platform'],
  },
};
