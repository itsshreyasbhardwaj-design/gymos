import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getNutritionPrefs } from '@/lib/services/nutrition';
import { evaluateRecipe } from '@/lib/engines/nutrition';
import {
  RECIPE_BY_ID,
  RECIPE_SOURCES,
  CUISINE_LABELS,
  deriveRecipeAllergens,
  deriveRecipeDietFacts,
} from '@/lib/content/recipes';
import { INGREDIENT_BY_ID, ALLERGEN_BY_ID } from '@/lib/content/nutrition-base';
import {
  Badge,
  Card,
  CardHeader,
  KeyValue,
  Notice,
  PageHeader,
  ReviewStatusBadge,
} from '@/components/ui';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: RECIPE_BY_ID.get(id)?.name ?? 'Recipe' };
}

export default async function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const recipe = RECIPE_BY_ID.get(id);
  if (!recipe) notFound();

  const prefs = getNutritionPrefs(user.id);
  const evaluation = evaluateRecipe(recipe, prefs);
  const allergens = deriveRecipeAllergens(recipe);
  const facts = deriveRecipeDietFacts(recipe);
  const source = RECIPE_SOURCES[0];
  const omit = new Set(evaluation.omitIngredientIds);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={CUISINE_LABELS[recipe.cuisine] ?? recipe.cuisine}
        title={recipe.name}
        description={`Prep ${recipe.prep} min · cook ${recipe.cook} min · serves ${recipe.servings}`}
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone={evaluation.eligible ? 'ok' : 'warn'}>
          {evaluation.eligible ? 'Fits your preferences' : 'Filtered out for you'}
        </Badge>
        {recipe.diet.map((d) => (
          <Badge key={d} tone="neutral">
            {d.replace(/_/g, ' ')}
          </Badge>
        ))}
        <Badge tone="neutral">{recipe.skill ?? 'beginner'}</Badge>
        <ReviewStatusBadge status="draft" />
      </div>

      {!evaluation.eligible ? (
        <Notice
          tone={evaluation.exclusions.some((e) => e.kind === 'allergen') ? 'bad' : 'warn'}
          title="Why this is not suggested to you"
        >
          <ul className="space-y-1">
            {evaluation.exclusions.map((e, i) => (
              <li key={i}>
                <strong>{e.kind}</strong>: {e.detail}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {allergens.length > 0 ? (
        <Notice tone="warn" title="Allergens in this recipe">
          {allergens.map((a) => ALLERGEN_BY_ID.get(a)?.name ?? a).join(', ')}. Allergens are derived
          from the ingredient list including optional ingredients. Always check the labels on what
          you buy.
        </Notice>
      ) : null}

      <Card>
        <CardHeader title="Ingredients" subtitle={`For ${recipe.servings} serving(s).`} />
        <div className="px-5 pb-5">
          <ul className="space-y-1.5">
            {recipe.ing.map((ri) => {
              const ing = INGREDIENT_BY_ID.get(ri.id);
              const shouldOmit = omit.has(ri.id);
              return (
                <li
                  key={ri.id}
                  className={`flex items-center justify-between gap-3 text-sm py-1.5 border-b border-[var(--border)] last:border-0 ${shouldOmit ? 'opacity-55' : ''}`}
                >
                  <span>
                    {ing?.name ?? ri.id}
                    {ri.optional ? (
                      <span className="text-[var(--text-muted)]"> (optional)</span>
                    ) : null}
                    {shouldOmit ? (
                      <Badge tone="teal" className="ml-2">
                        leave out for your diet
                      </Badge>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-[var(--text-muted)] shrink-0">
                    {ri.qty} {ri.unit}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </Card>

      <Card>
        <CardHeader title="Method" />
        <div className="px-5 pb-5">
          <ol className="space-y-3 text-sm leading-relaxed list-decimal pl-5">
            {recipe.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {recipe.notes ? (
            <p className="text-sm text-[var(--text-muted)] mt-4">{recipe.notes}</p>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Details" />
        <div className="px-5 pb-5">
          <KeyValue
            items={[
              { label: 'Cuisine', value: CUISINE_LABELS[recipe.cuisine] ?? recipe.cuisine },
              { label: 'Suitable for', value: recipe.meals.join(', ') },
              { label: 'Total time', value: `${recipe.prep + recipe.cook} minutes` },
              { label: 'Vegetarian', value: facts.vegetarian ? 'Yes' : 'No' },
              { label: 'Vegan', value: facts.vegan ? 'Yes' : 'No' },
              { label: 'Contains egg', value: facts.containsEgg ? 'Yes' : 'No' },
              { label: 'Nutritional analysis', value: 'Not available' },
            ]}
          />
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Source and review status
        </p>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">{source?.citation}</p>
        <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
          No calorie or macro figures are shown. GymOS ships with no sourced nutritional analysis,
          and would rather show nothing than an invented number.
        </p>
      </Card>
    </div>
  );
}
