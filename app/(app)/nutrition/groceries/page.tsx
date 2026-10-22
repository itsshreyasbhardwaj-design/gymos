import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/session';
import {
  listGroceryLists,
  getGroceryList,
  getActiveMealPlan,
  userPriceMap,
} from '@/lib/services/nutrition';
import { evaluate } from '@/lib/services/entitlements';
import { formatPaise } from '@/lib/engines/grocery';
import { INGREDIENT_CATALOG } from '@/lib/content/nutrition-base';
import { Button, Card, CardHeader, EmptyState, Notice, PageHeader } from '@/components/ui';
import { GroceryListView, RecordPriceForm } from '@/components/grocery-views';
import { generateGroceryListFormAction } from '../../actions';

export const metadata: Metadata = { title: 'Groceries' };

export default async function GroceriesPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const entitlement = evaluate(user.plan, user.id, 'grocery_lists');
  const lists = listGroceryLists(user.id);
  const mealPlan = getActiveMealPlan(user.id);
  const selectedId = params.list ?? lists[0]?.id;
  const detail = selectedId ? getGroceryList(user.id, selectedId) : null;
  const prices = userPriceMap(user.id);

  if (!entitlement.allowed) {
    return (
      <div className="space-y-6">
        <PageHeader title="Groceries" />
        <Notice tone="warn" title="Grocery lists are part of GymOS Pro">
          {entitlement.reason} Your meal plan and recipes are unaffected.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Groceries"
        description="Built from your meal plan, with pantry stock subtracted and identical units summed."
        action={
          mealPlan ? (
            <form action={generateGroceryListFormAction}>
              <Button type="submit" size="sm">
                Build from meal plan
              </Button>
            </form>
          ) : null
        }
      />

      {!mealPlan ? (
        <Notice tone="neutral">
          Create a meal plan first — a grocery list is generated from planned meals, not guessed.
        </Notice>
      ) : null}

      {lists.length === 0 ? (
        <EmptyState
          title="No grocery lists yet"
          description="Generate one from your active meal plan. Anything already in your pantry is subtracted automatically."
          action={
            mealPlan ? (
              <form action={generateGroceryListFormAction}>
                <Button type="submit">Build my list</Button>
              </form>
            ) : null
          }
        />
      ) : null}

      {lists.length > 1 ? (
        <Card>
          <CardHeader title="Your lists" />
          <div className="px-5 pb-5 space-y-1.5">
            {lists.map((l) => (
              <a
                key={l.id}
                href={`/nutrition/groceries?list=${l.id}`}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm ${l.id === selectedId ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)]'}`}
              >
                <span className="truncate">{l.name}</span>
                <span className="text-xs text-[var(--text-muted)] shrink-0">
                  {l.purchasedCount}/{l.itemCount} ticked
                </span>
              </a>
            ))}
          </div>
        </Card>
      ) : null}

      {detail ? (
        <>
          <GroceryListView
            listId={detail.list.id}
            name={detail.list.name}
            shareToken={detail.list.shareToken}
            items={detail.items.map((i) => ({
              id: i.id,
              name: i.name,
              quantity: i.quantity,
              unit: i.unit,
              categoryLabel: i.categoryLabel,
              purchased: i.purchased,
              estimatedPaise: i.estimatedPaise,
              note: i.note,
              source: i.source,
            }))}
            totalEstimate={formatPaise(detail.totalEstimatedPaise)}
            pricedCount={detail.pricedCount}
          />

          <Card>
            <CardHeader
              title="Record a price"
              subtitle="GymOS ships with no retail price data. Cost estimates only ever come from prices you record yourself."
            />
            <div className="px-5 pb-5">
              <RecordPriceForm
                ingredients={INGREDIENT_CATALOG.map((i) => ({
                  id: i.id,
                  name: i.name,
                  unit: i.unit,
                }))}
                recordedCount={Object.keys(prices).length}
              />
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
