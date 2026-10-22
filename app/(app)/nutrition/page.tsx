import type { Metadata } from 'next';
import Link from 'next/link';
import { UtensilsCrossed, ShoppingCart, Package, BookOpen } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getNutritionPrefs, getActiveMealPlan, listGroceryLists, listPantry } from '@/lib/services/nutrition';
import { filterRecipes } from '@/lib/engines/nutrition';
import { ALLERGEN_BY_ID, INGREDIENT_BY_ID, INGREDIENT_CATALOG, ALLERGEN_CATALOG } from '@/lib/content/nutrition-base';
import { CUISINE_LABELS, RECIPE_CATALOG } from '@/lib/content/recipes';
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader, Stat } from '@/components/ui';
import { NutritionPrefsForm } from '@/components/nutrition-forms';

export const metadata: Metadata = { title: 'Nutrition' };

export default async function NutritionPage() {
  const user = await requireUser();
  const prefs = getNutritionPrefs(user.id);
  const report = filterRecipes(prefs);
  const mealPlan = getActiveMealPlan(user.id);
  const lists = listGroceryLists(user.id);
  const pantry = listPantry(user.id);

  const allergenBlocked = report.excluded.filter((e) =>
    e.exclusions.some((x) => x.kind === 'allergen'),
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nutrition"
        description="Flexible meal planning. No calorie targets, no weighing, no judgement about what you ate."
      />

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Stat label="Recipes you can use" value={report.eligible.length} tone="brand" />
        <Stat label="Excluded by allergens" value={allergenBlocked} tone={allergenBlocked > 0 ? 'warn' : 'neutral'} />
        <Stat label="Pantry items" value={pantry.length} />
        <Stat label="Grocery lists" value={lists.length} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <UtensilsCrossed className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
          <h2 className="font-semibold mt-3">Meal plan</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {mealPlan
              ? `Active plan for the week of ${mealPlan.weekStart} — ${mealPlan.meals.length} meals.`
              : 'No plan yet.'}
          </p>
          <LinkButton href="/nutrition/meal-plan" size="sm" className="mt-3">
            {mealPlan ? 'Open plan' : 'Plan this week'}
          </LinkButton>
        </Card>
        <Card className="p-5">
          <BookOpen className="h-5 w-5 text-[var(--accent-2)]" aria-hidden="true" />
          <h2 className="font-semibold mt-3">Recipes</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {RECIPE_CATALOG.length} recipes, India-first. {report.eligible.length} match your
            preferences.
          </p>
          <LinkButton href="/nutrition/recipes" variant="secondary" size="sm" className="mt-3">
            Browse recipes
          </LinkButton>
        </Card>
        <Card className="p-5">
          <ShoppingCart className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
          <h2 className="font-semibold mt-3">Groceries</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Consolidated from your meal plan, with pantry stock subtracted.
          </p>
          <LinkButton href="/nutrition/groceries" variant="secondary" size="sm" className="mt-3">
            Grocery lists
          </LinkButton>
        </Card>
        <Card className="p-5">
          <Package className="h-5 w-5 text-[var(--accent-2)]" aria-hidden="true" />
          <h2 className="font-semibold mt-3">Pantry</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Track what you have and get recipe suggestions from it.
          </p>
          <LinkButton href="/nutrition/pantry" variant="secondary" size="sm" className="mt-3">
            Open pantry
          </LinkButton>
        </Card>
      </div>

      {prefs.allergenIds.length > 0 ? (
        <Notice tone="warn" title="Allergens are applied as a hard rule">
          {prefs.allergenIds.map((a) => ALLERGEN_BY_ID.get(a)?.name ?? a).join(', ')} —{' '}
          {allergenBlocked} recipe(s) are excluded entirely, including any where the allergen is
          only an optional ingredient. Always check labels yourself as well.
        </Notice>
      ) : null}

      {prefs.medicalDietaryNote ? (
        <Notice tone="warn" title="You recorded a medical dietary requirement">
          GymOS does not build therapeutic diets. Please have a qualified dietitian review anything
          it suggests before relying on it.
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title="Your food preferences"
          subtitle="Changing these re-filters every suggestion immediately."
        />
        <div className="px-5 pb-5">
          <NutritionPrefsForm
            prefs={prefs}
            allergens={ALLERGEN_CATALOG.map((a) => ({ id: a.id, name: a.name }))}
            cuisines={Object.entries(CUISINE_LABELS).map(([id, label]) => ({ id, label }))}
            ingredients={INGREDIENT_CATALOG.filter((i) =>
              ['vegetables', 'dairy', 'pulses_legumes', 'meat_fish', 'nuts_seeds'].includes(i.category),
            ).map((i) => ({ id: i.id, name: i.name }))}
            isMinor={user.ageBand !== 'adult_18_plus'}
          />
        </div>
      </Card>

      {Object.keys(report.exclusionCounts).length > 0 ? (
        <Card>
          <CardHeader
            title="What your filters remove"
            subtitle="Shown so nothing is invisible. A recipe can be excluded for more than one reason."
          />
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            {Object.entries(report.exclusionCounts).map(([kind, count]) => (
              <Badge key={kind} tone={kind === 'allergen' ? 'bad' : 'neutral'}>
                {kind}: {count}
              </Badge>
            ))}
          </div>
        </Card>
      ) : null}

      <Notice tone="neutral">
        Recipes are everyday home cooking drafted in-house for GymOS, with a review status of{' '}
        <strong>draft</strong>. No calorie or macro data ships, because none of it is sourced —
        GymOS would rather show nothing than invent a number.{' '}
        {prefs.dislikedIngredientIds.length > 0
          ? `Ingredients you avoid: ${prefs.dislikedIngredientIds.map((i) => INGREDIENT_BY_ID.get(i)?.name ?? i).join(', ')}.`
          : null}
      </Notice>
    </div>
  );
}
