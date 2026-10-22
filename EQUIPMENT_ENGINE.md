# Equipment engine

`lib/engines/equipment.ts` is the single authority on "can this person do this exercise
with what they have". Everything else — generation, substitution, adaptation, search,
FitBrain — asks it.

## The model

An exercise declares **requirement groups**. Each group is an *any-of* set; **every**
group must be satisfied.

```ts
// Barbell bench press: four groups, all required.
equip: [['barbell'], ['weight_plates'], ['flat_bench', 'adjustable_bench'], ['power_rack', 'squat_rack']]

// Single-arm dumbbell row: one group, three ways to satisfy it.
equip: [['dumbbells', 'adjustable_dumbbells', 'kettlebell']]
optional: ['flat_bench', 'adjustable_bench']   // never gates eligibility

// Push-up: no groups at all.
equip: []
```

`optional` equipment never blocks an exercise. It is reported so the generator can prefer
an exercise whose optional equipment you happen to own, and so the UI can show it.

## Implied equipment

Owning one item can functionally provide others, so you do not have to tick every box:

| Item | Implies |
| --- | --- |
| `power_rack` | `squat_rack`, `pull_up_bar` |
| `adjustable_bench` | `flat_bench` → `stable_bench` |
| `flat_bench` | `stable_bench` |
| `adjustable_dumbbells` | `dumbbells` |
| `spin_bike` | `exercise_bike` |
| `functional_trainer` | `cable_machine`, `cable_crossover` |
| `cable_crossover` | `cable_machine` |

`expandEquipment()` resolves this transitively and always includes `none` — every
environment has floor space.

## The check

```ts
checkEquipment(exercise, availableSet) → {
  ok: boolean
  missingGroups: string[][]     // the any-of groups that are not satisfied
  missingIds: string[]
  optionalAvailable: string[]
}
```

An empty requirement group (a data error) is treated as **blocking**, never as silently
passing.

## The catalog

57 equipment types plus `none`, across eight categories:

| Category | Examples |
| --- | --- |
| Bodyweight & basics | mat, stable bench, step, pull-up bar, dip station |
| Free weights | dumbbells, adjustable dumbbells, barbell, plates, kettlebells, EZ bar, medicine ball |
| Resistance | handled bands, loop bands, mini bands, suspension trainer, cable machine |
| Racks & benches | adjustable bench, flat bench, squat rack, power rack, Smith machine |
| Upper-body machines | chest press, incline press, shoulder press, lat pulldown, seated row, pec deck, reverse pec deck, assisted pull-up, cable crossover, functional trainer |
| Lower-body machines | leg press, hack squat, leg extension, seated/lying leg curl, hip thrust, abduction, adduction, calf raise, glute kickback |
| Cardio | treadmill, bike, spin bike, rower, elliptical, stair climber, jump rope, open space |
| Mobility & other | foam roller, stability ball, balance pad, back extension station, ab wheel, sliders, wall space |

Every id is a stable slug. New equipment is additive — adding a type never invalidates an
existing profile.

## Multiple profiles

A user can keep several `gym_profiles` (Home, Main Gym, Travel, Custom), each with its own
`gym_equipment` inventory and an `available` flag per item. Exactly one is active, and the
active profile's expanded set is what every eligibility decision uses.

Marking an item unavailable (a machine is broken, a dumbbell is missing) removes it from
the set immediately, without deleting it.

## What the engine refuses to do

**It never invents an equipment-free equivalent.** If no exercise in the library can fill
a movement-pattern slot with the available equipment, the generator records a `gap` and
the slot is left out, with an explanation naming the cheapest way to unlock it:

> Monday: no horizontal pull exercise is available with your current equipment (needs
> Pull-up bar or Suspension trainer or Smith machine or Squat rack or Power rack / …).
> The slot was left out rather than replaced with something that does not train the same
> thing.

Gap explanations distinguish four different causes, because the fixes differ:

1. no exercise in the library trains this slot at all
2. no age-appropriate option for this profile
3. every option is excluded by preferences or limitations
4. equipment you do not have — ranked so the cheapest unlock is named first
5. the available versions are rated above your experience level

## Coverage, measured

Run against the real 172-exercise library by the test suite:

| Setup | Exercises unlocked |
| --- | --- |
| Bodyweight at home | smallest |
| Dumbbells and bands | more |
| Full commercial gym | most |

The tests assert this ordering holds, and that bodyweight-only genuinely cannot cover the
`vertical_pull` pattern — because pretending otherwise is the failure mode this engine
exists to prevent.

## GymScan

Not implemented. GymOS ships no image-recognition model, so it does not offer to analyse
a photo of your gym. Set-up is presets, search, category browsing and custom entries. The
data model (`equipment_types.is_custom`, `gym_venue_equipment.review_status`) and the
review flow such a feature would need are in place; the recognition is not, and nothing in
the interface implies it is.
