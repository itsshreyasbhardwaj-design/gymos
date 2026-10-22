import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/session';
import {
  getActiveMealPlan,
  getNutritionPrefs,
  mealAlternatives,
  listMealPlanHistory,
} from '@/lib/services/nutrition';
import { getEntitlement } from '@/lib/engines/entitlements';
import { ALLERGEN_BY_ID } from '@/lib/content/nutrition-base';
import {
  BulletList,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Notice,
  PageHeader,
} from '@/components/ui';
import { MealPlanBoard } from '@/components/meal-plan-board';
import { generateMealPlanFormAction } from '../../actions';

export const metadata: Metadata = { title: 'Meal plan' };

export default async function MealPlanPage() {
  const user = await requireUser();
  const plan = getActiveMealPlan(user.id);
  const prefs = getNutritionPrefs(user.id);
  const allowedDays = getEntitlement(user.plan, 'meal_plan_days').limitValue;
  const history = listMealPlanHistory(user.id);

  if (!plan) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Meal plan"
          description="Balanced suggestions from your preferences — never a diet, never a calorie target."
        />
        <EmptyState
          title="No meal plan yet"
          description={`GymOS will suggest ${allowedDays ?? 7} day(s) of meals that fit your diet, allergens, time limit and cooking confidence.`}
          action={
            <form action={generateMealPlanFormAction}>
              <Button type="submit">Plan my meals</Button>
            </form>
          }
        />
        <Notice tone="neutral">
          Nothing is generated until you ask. GymOS does not guess what you want to eat.
        </Notice>
      </div>
    );
  }

  // Alternatives are resolved server-side so the swap list is always re-filtered.
  const mealsWithAlternatives = plan.meals.map((meal) => ({
    ...meal,
    alternatives: mealAlternatives(user.id, meal.id),
  }));

  const dates = [...new Set(plan.meals.map((m) => m.date))].sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meal plan"
        description={`Week of ${plan.weekStart} · ${plan.meals.length} meals`}
        action={
          <form action={generateMealPlanFormAction}>
            <Button type="submit" variant="secondary" size="sm">
              Regenerate
            </Button>
          </form>
        }
      />

      {prefs.allergenIds.length > 0 ? (
        <Notice tone="warn" title="Allergen filtering is active">
          {prefs.allergenIds.map((a) => ALLERGEN_BY_ID.get(a)?.name ?? a).join(', ')} are excluded
          from every meal and every swap option on this page. Check labels yourself too.
        </Notice>
      ) : null}

      <MealPlanBoard dates={dates} meals={mealsWithAlternatives} />

      <Card>
        <CardHeader title="How this plan was built" />
        <div className="px-5 pb-5">
          <BulletList items={plan.explanation} />
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <LinkButton href="/nutrition/groceries" variant="secondary">
          Build the grocery list
        </LinkButton>
        <LinkButton href="/nutrition/recipes" variant="ghost">
          Browse recipes
        </LinkButton>
      </div>

      {history.length > 1 ? (
        <Card>
          <CardHeader title="Previous weeks" />
          <div className="px-5 pb-5 space-y-1.5">
            {history.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-[var(--border)] last:border-0"
              >
                <span>Week of {h.weekStart}</span>
                <span className="text-xs text-[var(--text-muted)]">{h.mealCount} meals</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
