'use client';

import { useMemo, useState, useTransition } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { Button, Field, Input, Notice, Select } from '@/components/ui';
import { addPantryItemAction, deletePantryItemAction, type ActionState } from '@/app/(app)/actions';

interface PantryItemView {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  categoryLabel: string;
  bestBefore: string | null;
  notes: string;
}

export function PantryManager({
  ingredients,
  items,
}: {
  ingredients: { id: string; name: string; unit: string }[];
  items: PantryItemView[];
}) {
  const [local, setLocal] = useState(items);
  const [state, setState] = useState<ActionState>({});
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? '');
  const [pending, startTransition] = useTransition();
  const unit = ingredients.find((i) => i.id === ingredientId)?.unit ?? 'g';

  const grouped = useMemo(() => {
    const map = new Map<string, PantryItemView[]>();
    for (const item of local) {
      const list = map.get(item.categoryLabel) ?? [];
      list.push(item);
      map.set(item.categoryLabel, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [local]);

  return (
    <div className="space-y-5">
      <form
        action={(data) =>
          startTransition(async () => {
            setState(await addPantryItemAction({}, data));
          })
        }
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ingredient" htmlFor="pantry-ingredient">
            <Select
              id="pantry-ingredient"
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
          <Field label={`Quantity (${unit})`} htmlFor="pantry-quantity">
            <Input id="pantry-quantity" name="quantity" type="number" step="any" min="0" required />
          </Field>
          <Field label="Best before" htmlFor="pantry-best-before" hint="Optional.">
            <Input id="pantry-best-before" name="bestBefore" type="date" />
          </Field>
        </div>
        <input type="hidden" name="unit" value={unit} />
        <Button type="submit" disabled={pending}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add to pantry
        </Button>
        {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
        {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
      </form>

      {local.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Your pantry is empty.</p>
      ) : (
        grouped.map(([category, categoryItems]) => (
          <div key={category}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
              {category}
            </p>
            <ul className="space-y-1">
              {categoryItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm"
                >
                  <span className="min-w-0">
                    {item.name}
                    {item.bestBefore ? (
                      <span className="block text-xs text-[var(--text-muted)]">
                        best before {item.bestBefore}
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums text-[var(--text-muted)] shrink-0">
                    {item.quantity} {item.unit}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLocal((prev) => prev.filter((i) => i.id !== item.id));
                      startTransition(async () => {
                        await deletePantryItemAction(item.id);
                      });
                    }}
                    className="h-8 w-8 grid place-items-center rounded-lg text-bad-500 hover:bg-bad-100/40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Remove {item.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
