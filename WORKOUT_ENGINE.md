# Workout engine

`workoutos-1.0.0` with programming rules `programming-1.0.0`. Both version strings are
stored on every saved plan, so you can always tell which rules produced it.

## Why it is not a language model

A plan has hard constraints: equipment that must be present, an age band that limits
loading, movement patterns that must be covered, a minute budget that must be respected.
A deterministic function can guarantee those. It is also reproducible — the same inputs
always produce the same plan — which is what makes it testable and what lets GymOS explain
every choice.

The generator is seeded from `(userId, weekStart, dayOfWeek, splitKind)` via a mulberry32
PRNG, used only to break ties between equally-good candidates.

## The twelve steps

1. **Validate the profile.** Without onboarding there is nothing to plan from.
2. **Read interests and age band.**
3. **Choose a split** for the number of days actually selected.
4. **Lay out movement-pattern slots** for each day, by role.
5. **Filter the library** to what the active equipment profile supports.
6. **Apply suitability constraints**: age band, experience level, stated limitations.
7. **Remove dislikes.**
8. **Score candidates.**
9. **Avoid repetition** within a day and across the week.
10. **Apply programming rules** for sets, reps, rest and intensity language.
11. **Fit to the minute budget.**
12. **Write the explanation and rationale, then persist.**

## Split selection

| Days | New / some experience | Regular / experienced |
| --- | --- | --- |
| 1 | Full body | Full body |
| 2 | Full body ×2 | Full body ×2 |
| 3 | Full body ×3 | Lower / Upper / Full body |
| 4 | Upper / Lower ×2 | Upper / Lower ×2 |
| 5 | Upper / Lower / Full / Upper / Lower | Push / Pull / Lower / Upper / Lower |
| 6 | Upper / Lower / Full ×2 | Push / Pull / Lower ×2 |

Interests then modify it: a cardiovascular interest with ≥4 days turns one day into a
conditioning day; a mobility interest with ≥5 days turns the last into a mobility day.
Under-13 accounts get activity sessions on every day.

## Slot templates

Each focus is an ordered list of slots. A slot declares candidate patterns (tried in
order), a role, whether it is droppable, and optionally a category or required muscle.

```ts
upper: [
  { patterns: ['horizontal_push'], role: 'primary',   droppable: false, category: 'compound' },
  { patterns: ['vertical_pull', 'horizontal_pull'], role: 'primary', droppable: false },
  { patterns: ['vertical_push'], role: 'secondary', droppable: true },
  { patterns: ['elbow_extension'], role: 'accessory', droppable: true, muscles: ['triceps'] },
  …
]
```

The `muscles` constraint exists because pattern alone is not enough: a wrist curl and a
triceps pushdown share the `elbow_extension` pattern but train different things.

## Scoring

Hard filters first (equipment, age, level, limitations, dislikes — all non-negotiable),
then candidates are scored:

| Signal | Effect |
| --- | --- |
| Compound in a primary slot | +6 |
| Isolation in a primary slot | −5 |
| Matches the slot's category | +4 / −6 |
| Equipment depth in primary/secondary slots | +2 per group, capped at 3 |
| Not loadable, in a primary slot | −4 |
| Marked a favourite | +8 |
| Already used this day | −100 |
| Already used this week | −7 |
| Logged recently (last 14 days) | −2 |
| Strength interest and loadable | +2 |
| Beginner and a beginner-rated exercise | +3 |
| Optional equipment you own | +1 each |

The equipment-depth term is what stops a fully-equipped gym getting bodyweight push-ups as
its primary press.

## Programming rules

Rest scales with role **and** level:

| Role | new | some | regular | experienced |
| --- | --- | --- | --- | --- |
| primary | 75 s | 90 s | 120 s | 150 s |
| secondary | 60 s | 75 s | 90 s | 90 s |
| accessory | 45 s | 45 s | 60 s | 60 s |
| mobility | 15 s | 15 s | 20 s | 20 s |

### Age bands

| Band | Behaviour |
| --- | --- |
| **under_13** | Activity sessions only. 1–2 sets, 6–10 practice reps or 20 s holds, no load guidance, no intensity targets. Only exercises flagged `childOk`. |
| **teen_13_17** | Effective level capped at `some` regardless of self-report. Max 3 sets, 8–15 reps, holds capped at 30 s, never trained to failure. Exercises flagged `teenOk: false` are excluded. |
| **adult_18_plus** | Standard ranges by experience. |

### Feedback

Deliberately asymmetric:

| Input | Response |
| --- | --- |
| Discomfort reported | −1 set, note referring to a qualified professional. Always. |
| "Too hard" or very poor recovery | −1 set, narrower rep range, +30 s rest |
| "Too easy" **and** good recovery | exactly one increment: +1–2 reps, or +10 s, or +1 set |
| Nothing reported | no change |

Nothing escalates without positive feedback. Silence is not permission. Set counts stay
capped for minors however often they report a session as easy.

## Limitations

Self-reported sensitivities are a filter, never a diagnosis.

| Limitation | Removes |
| --- | --- |
| Knees | plyometrics, deep knee-forward work, jumping |
| Lower back | loaded spinal flexion, heavy hinging, back squat |
| Shoulders | the whole vertical-push pattern, deep dips, flyes |
| Wrists | loaded wrist-extension positions |
| Neck | bar-on-neck and neck-flexion work |
| Ankles | impact and single-leg ankle loading |
| Pregnancy / postpartum | high impact, intense abdominal flexion — plus explicit deferral to the user's own healthcare professional |
| No jumping | all plyometrics |
| Hard to reach the floor | floor-based work, replaced by standing/seated/bench versions |

Every limitation adds a note to the plan explanation, and the medical disclaimer is shown
alongside.

## Time fitting

A shorter session is a **shorter session**, never the same one rushed:

1. drop droppable slots (accessory, then mobility) from the end
2. then secondary work
3. then shorten rest, down to a 60-second floor
4. then trim sets, keeping at least 2 sets of anything primary

Duration is estimated from the midpoint of the rep range, doubled for unilateral work,
plus a 5-minute warm-up and a 3-minute cool-down.

## Substitution

`findSubstitutes()` ranks replacements by how closely they preserve the training intent:

1. curated regressions (when an easier option was asked for)
2. curated substitutes from the library
3. same pattern **and** overlapping primary muscles
4. same pattern
5. different pattern but overlapping muscles — explicitly labelled *partial match*

Every tier applies the same hard filters, plus a **training-family guard**: a strength
exercise is never replaced by a mobility stretch or a cardio session, even when they share
a muscle tag. (This was a real bug: child's pose was briefly offered as a lat-pulldown
substitute because both list `lats`.)

If nothing survives, the result is empty with a stated reason. The caller must say so
rather than inventing something.

## RealitySync

Seven scenarios, each producing a proposal the user accepts, edits or rejects:

| Scenario | Behaviour |
| --- | --- |
| **A. Different equipment** | Re-map onto the new profile. Keep what works with the same dose; swap what does not; block what has no equivalent. |
| **B. Less time** | Build a genuinely shorter session (see Time fitting). |
| **C. Missed session** | Move to the next free day, or let it go. **Never** adds volume elsewhere. |
| **D. Equipment occupied** | Touch only the affected exercises; offer skipping. |
| **E. Session too hard** | Conservative volume reduction; discomfort always reduces and defers to a professional. |
| **F. Travel** | Scenario A against the travel profile. |
| **G. Schedule change** | Move upcoming sessions onto the new days. Completed sessions never move. |

Every proposal carries: what changed, why, which inputs were considered, whether the
replacement's equipment requirements are satisfied, and alternatives.

Applying a proposal writes a `plan_revisions` row and only ever rewrites the
`planned_snapshot` of a session that has **not** been completed.

## Honest gaps

When a slot cannot be filled, the plan records it and the UI shows it. The generator will
not substitute across movement patterns to hide a gap, and the warning text says so
explicitly. This is the single most important behaviour in the engine.
