'use client';

import { useMemo, useState, useTransition } from 'react';
import { Check, Trash2, Share2, Plus } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Field, Input, Notice, Select } from '@/components/ui';
import {
  toggleGroceryItemAction,
  deleteGroceryItemAction,
  addGroceryItemAction,
  shareGroceryListAction,
  unshareGroceryListAction,
  recordPriceAction,
  type ActionState,
} from '@/app/(app)/actions';
import { cn } from '@/lib/ui/cn';

interface GroceryItemView {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  categoryLabel: string;
  purchased: boolean;
  estimatedPaise: number | null;
  note: string;
  source: string;
}

export function GroceryListView({
  listId,
  name,
  shareToken,
  items,
  totalEstimate,
  pricedCount,
}: {
  listId: string;
  name: string;
  shareToken: string | null;
  items: GroceryItemView[];
  totalEstimate: string;
  pricedCount: number;
}) {
  const [local, setLocal] = useState(items);
  const [message, setMessage] = useState<ActionState>({});
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const grouped = useMemo(() => {
    const map = new Map<string, GroceryItemView[]>();
    for (const item of local) {
      const list = map.get(item.categoryLabel) ?? [];
      list.push(item);
      map.set(item.categoryLabel, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [local]);

  const done = local.filter((i) => i.purchased).length;

  function toggle(item: GroceryItemView) {
    setLocal((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, purchased: !i.purchased } : i)),
    );
    startTransition(async () => {
      await toggleGroceryItemAction(item.id, !item.purchased);
    });
  }

  function remove(item: GroceryItemView) {
    setLocal((prev) => prev.filter((i) => i.id !== item.id));
    startTransition(async () => {
      await deleteGroceryItemAction(item.id);
    });
  }

  return (
    <Card>
      <CardHeader
        title={name}
        subtitle={`${done} of ${local.length} ticked off · estimate ${totalEstimate}`}
        action={
          <form
            action={(data) =>
              startTransition(async () => {
                setMessage(
                  shareToken
                    ? await unshareGroceryListAction({}, data)
                    : await shareGroceryListAction({}, data),
                );
              })
            }
          >
            <input type="hidden" name="listId" value={listId} />
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              <Share2 className="h-4 w-4" aria-hidden="true" />
              {shareToken ? 'Stop sharing' : 'Share'}
            </Button>
          </form>
        }
      />
      <div className="px-5 pb-5 space-y-4">
        {message.error ? <Notice tone="bad">{message.error}</Notice> : null}
        {message.success ? <Notice tone="ok">{message.success}</Notice> : null}

        {shareToken ? (
          <Notice tone="neutral">
            Read-only share link:{' '}
            <code className="font-mono text-xs break-all">/share/groceries/{shareToken}</code>
            <br />
            Anyone with the link can see the item names and quantities. It contains no other
            personal data.
          </Notice>
        ) : null}

        {pricedCount === 0 ? (
          <Notice tone="warn">
            No cost estimate: GymOS has no retail price data and you have not recorded any prices
            yet. Record a price below and future lists will estimate from it.
          </Notice>
        ) : pricedCount < local.length ? (
          <Notice tone="neutral">
            The estimate covers {pricedCount} of {local.length} items, so it is a floor rather than
            a full basket cost.
          </Notice>
        ) : null}

        {grouped.map(([category, categoryItems]) => (
          <div key={category}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
              {category}
            </p>
            <ul className="space-y-1">
              {categoryItems.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                    item.purchased
                      ? 'border-[var(--border)] bg-[var(--surface-sunken)]'
                      : 'border-[var(--border)]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    aria-pressed={item.purchased}
                    className={cn(
                      'h-6 w-6 shrink-0 rounded-md border grid place-items-center',
                      item.purchased
                        ? 'bg-[var(--accent)] border-[var(--accent)]'
                        : 'border-[var(--border-strong)]',
                    )}
                  >
                    {item.purchased ? <Check className="h-4 w-4 text-white" aria-hidden="true" /> : null}
                    <span className="sr-only">
                      {item.purchased ? 'Mark as not bought' : 'Mark as bought'}: {item.name}
                    </span>
                  </button>
                  <span className={cn('flex-1 text-sm min-w-0', item.purchased && 'line-through opacity-60')}>
                    {item.name}
                    {item.note ? (
                      <span className="block text-xs text-[var(--text-muted)]">{item.note}</span>
                    ) : null}
                  </span>
                  <span className="text-sm tabular-nums text-[var(--text-muted)] shrink-0">
                    {item.quantity ?? ''} {item.unit ?? ''}
                  </span>
                  {item.source === 'manual' ? (
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      className="h-8 w-8 grid place-items-center rounded-lg text-bad-500 hover:bg-bad-100/40"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only">Remove {item.name}</span>
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {adding ? (
          <form
            action={(data) =>
              startTransition(async () => {
                setMessage(await addGroceryItemAction({}, data));
                setAdding(false);
              })
            }
            className="rounded-xl border border-[var(--border)] p-3 space-y-3"
          >
            <input type="hidden" name="listId" value={listId} />
            <div className="grid gap-2 sm:grid-cols-3">
              <Input name="customName" placeholder="Item name" required maxLength={80} aria-label="Item name" />
              <Input name="quantity" type="number" step="any" placeholder="Quantity" aria-label="Quantity" />
              <Input name="unit" placeholder="Unit" maxLength={16} aria-label="Unit" />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                Add item
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add your own item
          </Button>
        )}
      </div>
    </Card>
  );
}

export function RecordPriceForm({
  ingredients,
  recordedCount,
}: {
  ingredients: { id: string; name: string; unit: string }[];
  recordedCount: number;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? '');
  const unit = ingredients.find((i) => i.id === ingredientId)?.unit ?? 'g';

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await recordPriceAction({}, data));
        })
      }
      className="space-y-3"
    >
      <p className="text-sm text-[var(--text-muted)]">
        {recordedCount} price{recordedCount === 1 ? '' : 's'} recorded so far.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Ingredient" htmlFor="price-ingredient">
          <Select
            id="price-ingredient"
            name="ingredientId"
            value={ingredientId}
            onChange={(e) => setIngredientId(e.target.value)}
          >
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price (₹)" htmlFor="price-rupees">
          <Input id="price-rupees" name="rupees" type="number" step="0.5" min="0" required />
        </Field>
        <Field label={`Per how many ${unit}?`} htmlFor="price-qty">
          <Input id="price-qty" name="perQuantity" type="number" step="any" min="0.01" defaultValue={unit === 'piece' ? 1 : 1000} required />
        </Field>
      </div>
      <input type="hidden" name="unit" value={unit} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Record price
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
    </form>
  );
}
