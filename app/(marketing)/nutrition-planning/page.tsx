import type { Metadata } from 'next';
import { Badge, BulletList, Card, LinkButton, Notice, PageHeader, Section } from '@/components/ui';
import { RECIPE_CATALOG, CUISINE_LABELS, deriveRecipeAllergens } from '@/lib/content/recipes';
import { ALLERGEN_CATALOG, INGREDIENT_CATALOG } from '@/lib/content/nutrition-base';

export const metadata: Metadata = {
  title: 'Nutrition planning',
  description: 'Flexible, balanced meal planning with allergens treated as a safety constraint.',
};

export default function NutritionPlanningPage() {
  const byCuisine = Object.entries(CUISINE_LABELS)
    .map(([id, label]) => ({ id, label, count: RECIPE_CATALOG.filter((r) => r.cuisine === id).length }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const byDiet = [
    { label: 'Vegan', count: RECIPE_CATALOG.filter((r) => r.diet.includes('vegan')).length },
    { label: 'Vegetarian', count: RECIPE_CATALOG.filter((r) => r.diet.includes('vegetarian')).length },
    { label: 'Egg-inclusive', count: RECIPE_CATALOG.filter((r) => r.diet.includes('eggetarian')).length },
    { label: 'Non-vegetarian', count: RECIPE_CATALOG.filter((r) => r.diet.includes('non_vegetarian')).length },
    { label: 'High protein', count: RECIPE_CATALOG.filter((r) => r.diet.includes('high_protein')).length },
  ];

  const allergenImpact = ALLERGEN_CATALOG.map((a) => ({
    name: a.name,
    blocked: RECIPE_CATALOG.filter((r) => deriveRecipeAllergens(r).includes(a.id)).length,
  })).sort((x, y) => y.blocked - x.blocked);

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 space-y-14">
      <PageHeader
        eyebrow="NutritionOS"
        title="Meal planning, not dieting"
        description="No calorie targets. No weighing food. No moralising about what you ate. GymOS helps you decide what to cook, respects what you cannot or will not eat, and builds the shopping list."
      />

      <Section
        title="An India-first recipe library"
        description={`${RECIPE_CATALOG.length} recipes built on ${INGREDIENT_CATALOG.length} catalogued ingredients.`}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-5">
            <p className="font-semibold text-sm mb-3">By cuisine</p>
            <div className="space-y-1.5">
              {byCuisine.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span>{c.label}</span>
                  <span className="tabular-nums text-[var(--text-muted)]">{c.count}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-5">
            <p className="font-semibold text-sm mb-3">By dietary pattern</p>
            <div className="space-y-1.5">
              {byDiet.map((d) => (
                <div key={d.label} className="flex items-center justify-between text-sm">
                  <span>{d.label}</span>
                  <span className="tabular-nums text-[var(--text-muted)]">{d.count}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Section>

      <Section
        title="Allergens are a hard filter, not a hint"
        description="Allergen tags are derived from the ingredient list rather than typed by hand, so they cannot drift out of date."
      >
        <Card className="p-5 space-y-4">
          <BulletList
            items={[
              'A declared allergen removes the recipe entirely — from generation, from suggestions, and from the swap list.',
              'Optional ingredients still count. A recipe where the peanuts are "optional" is still excluded for a peanut allergy, because a planner should not assume you will leave something out.',
              'Swapping a meal re-runs the same filter on the server. There is no path where a swap slips an allergen through.',
              'Nothing is silently substituted. If a recipe does not fit, it disappears and the planner tells you how many were removed and why.',
            ]}
          />
          <div>
            <p className="text-sm font-medium mb-2">
              How many of the {RECIPE_CATALOG.length} recipes each allergen removes
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allergenImpact.map((a) => (
                <Badge key={a.name} tone={a.blocked > 0 ? 'warn' : 'neutral'}>
                  {a.name}: {a.blocked}
                </Badge>
              ))}
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Grocery and pantry">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-5">
            <p className="font-semibold text-sm">What the grocery list does</p>
            <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
              Scales each ingredient by servings, sums identical units, subtracts what is already in
              your pantry, groups by aisle, and lets you tick items off, add your own and share a
              read-only copy.
            </p>
          </Card>
          <Card className="p-5">
            <p className="font-semibold text-sm">What the pantry does</p>
            <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
              Tracks what you already have, suggests recipes you could mostly make from it, and
              keeps your dietary rules applied the whole way through.
            </p>
          </Card>
        </div>
        <Notice tone="warn" title="On prices and nutrition numbers">
          GymOS ships with no retail price data and no sourced nutritional analysis, so it shows
          neither rather than inventing both. Grocery totals come only from prices you record while
          shopping, and the list always says how many items that covers. Recipes show no calorie or
          macro panel.
        </Notice>
      </Section>

      <Section title="Age and medical safeguards">
        <Card className="p-5">
          <BulletList
            items={[
              'Under-18 accounts cannot be given calorie ceilings, weight targets or restrictive plans. The server refuses those settings, it does not merely hide them.',
              'Exercise is never used to justify eating less, and finishing a workout never unlocks or restricts food.',
              'If you record a medical dietary requirement, GymOS says plainly that it does not build therapeutic diets and asks you to have a qualified dietitian review anything it suggests.',
              'Recipes are everyday home cooking written in-house for GymOS. They carry a review status and are labelled as drafts.',
            ]}
          />
        </Card>
      </Section>

      <div className="flex flex-wrap gap-3">
        <LinkButton href="/signup" size="lg">
          Plan this week&apos;s meals
        </LinkButton>
        <LinkButton href="/pricing" variant="secondary" size="lg">
          See plans
        </LinkButton>
      </div>
    </div>
  );
}
