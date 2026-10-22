import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listPantry, pantrySuggestions } from '@/lib/services/nutrition';
import { evaluate } from '@/lib/services/entitlements';
import { INGREDIENT_CATALOG } from '@/lib/content/nutrition-base';
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from '@/components/ui';
import { PantryManager } from '@/components/pantry-manager';

export const metadata: Metadata = { title: 'Pantry' };

export default async function PantryPage() {
  const user = await requireUser();
  const entitlement = evaluate(user.plan, user.id, 'pantry');

  if (!entitlement.allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pantry" />
        <Notice tone="warn" title="Pantry tracking is part of GymOS Pro">
          {entitlement.reason}
        </Notice>
      </div>
    );
  }

  const items = listPantry(user.id);
  const suggestions = pantrySuggestions(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pantry"
        description="What you already have. Grocery lists subtract it automatically."
      />

      <Card>
        <CardHeader title="Add to your pantry" />
        <div className="px-5 pb-5">
          <PantryManager
            ingredients={INGREDIENT_CATALOG.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
            items={items.map((i) => ({
              id: i.id,
              name: i.name,
              quantity: i.quantity,
              unit: i.unit,
              categoryLabel: i.categoryLabel,
              bestBefore: i.bestBefore,
              notes: i.notes,
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Could you cook this tonight?"
          subtitle="Recipes you have most of the ingredients for — still filtered by your diet and allergens."
        />
        <div className="px-5 pb-5 space-y-2">
          {suggestions.length === 0 ? (
            <EmptyState
              title="Nothing to suggest yet"
              description="Add a few staples to your pantry and GymOS will match them against recipes you can actually eat."
            />
          ) : (
            suggestions.map((s) => (
              <Link
                key={s.recipe.id}
                href={`/nutrition/recipes/${s.recipe.id}`}
                className="block rounded-xl border border-[var(--border)] p-3.5 hover:border-[var(--border-strong)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{s.recipe.name}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {s.missing.length === 0
                        ? 'You have everything required.'
                        : `Still need: ${s.missing.slice(0, 5).join(', ')}${s.missing.length > 5 ? '…' : ''}`}
                    </p>
                  </div>
                  <Badge tone={s.coverage === 1 ? 'ok' : 'neutral'}>
                    {Math.round(s.coverage * 100)}%
                  </Badge>
                </div>
              </Link>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
