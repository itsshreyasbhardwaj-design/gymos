import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/session';
import { getNutritionPrefs } from '@/lib/services/nutrition';
import { filterRecipes } from '@/lib/engines/nutrition';
import { CUISINE_LABELS, RECIPE_CATALOG, deriveRecipeAllergens } from '@/lib/content/recipes';
import { ALLERGEN_BY_ID } from '@/lib/content/nutrition-base';
import { Notice, PageHeader } from '@/components/ui';
import { RecipeBrowser } from '@/components/recipe-browser';

export const metadata: Metadata = { title: 'Recipes' };

export default async function RecipesPage() {
  const user = await requireUser();
  const prefs = getNutritionPrefs(user.id);
  const report = filterRecipes(prefs);
  const eligibleIds = new Set(report.eligible.map((e) => e.recipe.id));
  const exclusionById = new Map(
    report.excluded.map((e) => [e.recipe.id, e.exclusions.map((x) => x.detail)]),
  );

  const items = RECIPE_CATALOG.map((r) => ({
    id: r.id,
    name: r.name,
    cuisine: r.cuisine,
    cuisineLabel: CUISINE_LABELS[r.cuisine] ?? r.cuisine,
    meals: r.meals,
    diet: r.diet,
    totalMinutes: r.prep + r.cook,
    servings: r.servings,
    skill: r.skill ?? 'beginner',
    allergens: deriveRecipeAllergens(r).map((a) => ALLERGEN_BY_ID.get(a)?.name ?? a),
    eligible: eligibleIds.has(r.id),
    exclusions: exclusionById.get(r.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recipes"
        description={`${RECIPE_CATALOG.length} recipes. ${report.eligible.length} fit your current preferences.`}
      />
      <Notice tone="neutral">
        Recipes are everyday home cooking drafted in-house for GymOS, with review status{' '}
        <strong>draft</strong>. No calorie or macro panel is shown, because no sourced nutritional
        analysis ships with this build.
      </Notice>
      <RecipeBrowser
        items={items}
        cuisines={Object.entries(CUISINE_LABELS).map(([id, label]) => ({ id, label }))}
      />
    </div>
  );
}
