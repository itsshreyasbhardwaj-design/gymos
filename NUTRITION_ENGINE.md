# Nutrition engine

`nutritionos-1.0.0`. Meal planning, not dieting: no calorie targets, no portion weighing,
no judgement about what you ate.

## The library

| | Count |
| --- | --- |
| Recipes | 79 |
| Ingredients | 134 |
| Allergens | 10 |

Cuisine mix is India-first by design: Bengali, North Indian, South Indian and everyday
home cooking make up over 60% of the catalog, with selected Indo-Chinese, continental,
Italian and Middle Eastern alongside. Vegetarian, vegan, egg-inclusive and
non-vegetarian are all represented.

Every recipe has a `review_status` of `draft` and a source record stating plainly that it
is an in-house draft, not a tested professional recipe.

## Allergens are derived, not typed

A recipe's allergen set is computed from its ingredient list, so it cannot drift out of
date when an ingredient changes:

```ts
deriveRecipeAllergens(recipe)   // union of every ingredient's allergen tags
```

Two decisions matter:

1. **Optional ingredients still count.** A recipe where the peanuts are optional is
   excluded for a peanut allergy. A planner must not assume you will leave something out.
2. **Allergen exclusion is total.** The recipe disappears from generation, from
   suggestions, from search results you can act on, and from every swap list. There is no
   "we substituted it for you" path.

Diet facts are computed differently and deliberately: `deriveRecipeDietFacts()` looks at
**required** ingredients only by default, because an optional spoon of ghee does not stop
a roti recipe being usable by a vegan. The planner then tells you which optional
ingredients to leave out, and the grocery list omits them.

That asymmetry is intentional. An allergy is a safety constraint; a diet is a preference
with a known workaround.

## Filtering

| Hard (excludes the recipe) | Soft (affects ranking) |
| --- | --- |
| Declared allergens | Preferred cuisines (+6 / −2) |
| Diet (vegan / vegetarian / eggetarian) | High-protein tag (+1) |
| Disliked **required** ingredient | Recently used (−8, −12 within the week) |
| Total time over the stated limit | Comfortably under the time limit (+2) |
| Skill above the stated cooking confidence | |
| Not suggested for the requested slot | |

`filterRecipes()` returns the eligible set, the excluded set **with reasons**, and
exclusion counts by kind, which the UI shows so filtering is never invisible.

## Meal planning

Deterministic, seeded from `(userId, weekStart, date, slot)`:

- breakfast, lunch and dinner for each day; snacks only if asked
- never the same recipe twice in one day
- a 12-recipe rolling window discourages repeats across the week
- servings sized to the household
- a written rationale per meal, and a plan-level explanation naming the allergens
  excluded and how many recipes that removed

If nothing fits a slot, it says so rather than inventing a meal:

> No recipe in the library fits your preferences for dinner. Nothing was invented —
> widen a preference or add your own recipes.

### Swaps

`findMealAlternatives()` re-runs the **same** hard filters. `swapMeal()` re-validates on
the server before writing, so there is no path where a swap slips an allergen through —
and it returns the specific reason when it refuses.

## Grocery lists

`buildGroceryList()`:

- scales each ingredient by `servings / recipe.servings`
- sums only identical `(ingredient, unit)` pairs; mismatched units stay on separate lines
- excludes optional ingredients by default and **lists them as skipped** rather than
  silently dropping them
- omits ingredients the planner excluded for diet or dislike reasons, and says which
- subtracts pantry stock, unit-matched only, and reports fully-covered items in a separate
  "already have" list rather than hiding them
- groups by aisle category

### Prices

GymOS ships **no retail price data**. Every seeded ingredient has
`approx_price_paise_per_unit = null`.

Cost estimates come only from prices **you** record while shopping
(`user_ingredient_prices`). The list always states coverage:

> Cost estimate covers 4 of 23 items — the rest have no price recorded, so the total is a
> floor, not a full basket cost.

With no recorded prices at all, there is no total — the UI shows an em dash, not a zero.

## Pantry

Optional inventory of ingredient, quantity, unit, date added, best-before and notes.
`recipesFromPantry()` ranks recipes by how much of their required ingredient list the
pantry covers, lists what is still missing, and respects every dietary and allergen filter
throughout.

## Nutritional analysis

Not provided. No sourced calorie or macro data ships with GymOS, so recipes show no
nutrition panel. `recipes.nutrition` is `null` for every row and the detail page states
"Not available" rather than displaying an invented number.

## Age and medical safeguards

`assertNoMinorRestriction()` runs on **every** nutrition write path and throws for
under-18 accounts if the payload contains `calorieTarget`, `calorieCeiling`,
`weightGoalKg`, `deficit` or `bodyFatTarget`. These settings are refused by the server,
not merely hidden in the interface.

Minor plans carry an explicit explanation line: *balanced meals with no restriction, no
calorie limits and no weight targets.*

Exercise is never used to justify eating less, and completing a workout never unlocks or
restricts food — there is no code path connecting the two.

If a user records a medical dietary requirement, every generated plan carries a warning
that GymOS does not build therapeutic diets and that a qualified dietitian should review
anything it suggests.
