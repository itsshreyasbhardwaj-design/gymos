'use client';

import { useState, useTransition } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Badge, Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import {
  archiveProductAction,
  createProductAction,
  deleteJournalEntryAction,
  deletePatchTestAction,
  deleteProductAction,
  observePatchTestAction,
  saveJournalEntryAction,
  setProductRunningLowAction,
  startPatchTestAction,
  updateProductAction,
  type ActionState,
} from '@/app/(app)/grooming/actions';

export interface ProductOption {
  id: string;
  name: string;
}

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Notice tone="bad">{state.error}</Notice>;
  if (state.success) return <Notice tone="ok">{state.success}</Notice>;
  return null;
}

/* ---------------------------------------------------------------- products */

export function ProductForm({ categories }: { categories: readonly string[] }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await createProductAction({}, data));
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product name" htmlFor="product-name" required>
          <Input id="product-name" name="name" required maxLength={120} />
        </Field>
        <Field label="Brand" htmlFor="product-brand" hint="Optional.">
          <Input id="product-brand" name="brand" maxLength={120} />
        </Field>
        <Field label="Shelf category" htmlFor="product-category">
          <Select id="product-category" name="category" defaultValue="other">
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price (₹)" htmlFor="product-price" hint="Optional. What you paid.">
          <Input id="product-price" name="priceRupees" type="number" step="0.01" min="0" />
        </Field>
        <Field label="Opened on" htmlFor="product-opened" hint="Optional.">
          <Input id="product-opened" name="openedAt" type="date" />
        </Field>
        <Field
          label="Period after opening (months)"
          htmlFor="product-pao"
          hint="The number inside the open-jar symbol on the packaging."
        >
          <Input id="product-pao" name="paoMonths" type="number" min="1" max="120" step="1" />
        </Field>
        <Field label="Printed expiry" htmlFor="product-expiry" hint="Optional.">
          <Input id="product-expiry" name="expiresAt" type="date" />
        </Field>
        <Field
          label="Key ingredients"
          htmlFor="product-ingredients"
          hint="Comma separated, in your own words. Used only to spot the same thing twice."
        >
          <Input id="product-ingredients" name="keyIngredients" maxLength={400} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="product-notes" hint="Optional.">
        <Textarea id="product-notes" name="notes" rows={2} maxLength={1000} />
      </Field>
      <Button type="submit" disabled={pending}>
        Add product
      </Button>
      <Result state={state} />
    </form>
  );
}

export interface EditableProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  keyIngredients: string[];
  openedAt: string | null;
  expiresAt: string | null;
  paoMonths: number | null;
  pricePaise: number | null;
  runningLow: boolean;
  notes: string;
}

export function ProductRow({
  product,
  expiry,
  categories,
}: {
  product: EditableProduct;
  expiry: { state: string; reason: string };
  categories: readonly string[];
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  const tone =
    expiry.state === 'expired'
      ? 'bad'
      : expiry.state === 'use_soon'
        ? 'warn'
        : expiry.state === 'fresh'
          ? 'ok'
          : 'neutral';
  const label =
    expiry.state === 'expired'
      ? 'Past date'
      : expiry.state === 'use_soon'
        ? 'Use soon'
        : expiry.state === 'fresh'
          ? 'In date'
          : 'No date recorded';

  return (
    <li className="rounded-xl border border-[var(--border)] px-3.5 py-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {product.name}
            {product.brand ? (
              <span className="text-[var(--text-muted)] font-normal"> · {product.brand}</span>
            ) : null}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{expiry.reason}</p>
          {product.pricePaise != null ? (
            <p className="text-xs text-[var(--text-muted)] tabular-nums">
              ₹{(product.pricePaise / 100).toFixed(2)} — the price you recorded
            </p>
          ) : null}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <Badge tone={tone}>{label}</Badge>
          {product.runningLow ? <Badge tone="warn">Running low</Badge> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setState(await setProductRunningLowAction(product.id, !product.runningLow));
            })
          }
        >
          {product.runningLow ? 'Not running low' : 'Running low'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setState(await archiveProductAction(product.id, true));
            })
          }
        >
          Used up
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setState(await deleteProductAction(product.id));
            })
          }
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      </div>

      {/* A printed expiry or a period-after-opening figure is often read off the
          packaging later than the product was added, so the dates have to be
          editable: an expiry nobody can correct is worse than no expiry at all. */}
      <details className="rounded-lg border border-[var(--border)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">
          <Pencil className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />
          Edit details and dates
        </summary>
        <form
          action={(data) =>
            startTransition(async () => {
              setState(await updateProductAction({}, data));
            })
          }
          className="pt-3 space-y-3"
        >
          <input type="hidden" name="productId" value={product.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product name" htmlFor={`edit-name-${product.id}`} required>
              <Input
                id={`edit-name-${product.id}`}
                name="name"
                required
                maxLength={120}
                defaultValue={product.name}
              />
            </Field>
            <Field label="Brand" htmlFor={`edit-brand-${product.id}`}>
              <Input
                id={`edit-brand-${product.id}`}
                name="brand"
                maxLength={120}
                defaultValue={product.brand}
              />
            </Field>
            <Field label="Shelf category" htmlFor={`edit-category-${product.id}`}>
              <Select
                id={`edit-category-${product.id}`}
                name="category"
                defaultValue={product.category}
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Price (₹)" htmlFor={`edit-price-${product.id}`}>
              <Input
                id={`edit-price-${product.id}`}
                name="priceRupees"
                type="number"
                step="0.01"
                min="0"
                defaultValue={
                  product.pricePaise == null ? '' : (product.pricePaise / 100).toFixed(2)
                }
              />
            </Field>
            <Field label="Opened on" htmlFor={`edit-opened-${product.id}`}>
              <Input
                id={`edit-opened-${product.id}`}
                name="openedAt"
                type="date"
                defaultValue={product.openedAt ?? ''}
              />
            </Field>
            <Field
              label="Period after opening (months)"
              htmlFor={`edit-pao-${product.id}`}
              hint="The number inside the open-jar symbol on the packaging."
            >
              <Input
                id={`edit-pao-${product.id}`}
                name="paoMonths"
                type="number"
                min="1"
                max="120"
                step="1"
                defaultValue={product.paoMonths ?? ''}
              />
            </Field>
            <Field label="Printed expiry" htmlFor={`edit-expiry-${product.id}`}>
              <Input
                id={`edit-expiry-${product.id}`}
                name="expiresAt"
                type="date"
                defaultValue={product.expiresAt ?? ''}
              />
            </Field>
            <Field
              label="Key ingredients"
              htmlFor={`edit-ingredients-${product.id}`}
              hint="Comma separated, in your own words."
            >
              <Input
                id={`edit-ingredients-${product.id}`}
                name="keyIngredients"
                maxLength={400}
                defaultValue={product.keyIngredients.join(', ')}
              />
            </Field>
          </div>
          <Field label="Notes" htmlFor={`edit-notes-${product.id}`}>
            <Textarea
              id={`edit-notes-${product.id}`}
              name="notes"
              rows={2}
              maxLength={1000}
              defaultValue={product.notes}
            />
          </Field>
          <p className="text-xs text-[var(--text-muted)]">
            Clearing a date removes it, and the expiry note above goes back to saying there is
            nothing to compare. GymOS never fills one of these in for you.
          </p>
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            Save changes
          </Button>
        </form>
      </details>

      <Result state={state} />
    </li>
  );
}

/* ----------------------------------------------------------------- journal */

export function JournalForm({
  today,
  products,
  entry,
}: {
  today: string;
  products: ProductOption[];
  entry?: { date: string; comfort: number | null; concerns: string[]; note: string } | null;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await saveJournalEntryAction({}, data));
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" htmlFor="journal-date" required>
          <Input
            id="journal-date"
            name="date"
            type="date"
            required
            defaultValue={entry?.date ?? today}
          />
        </Field>
        <Field
          label="How comfortable did your skin feel? (1-5)"
          htmlFor="journal-comfort"
          hint="Your own rating. GymOS never scores your skin or your appearance."
        >
          <Select id="journal-comfort" name="comfort" defaultValue={String(entry?.comfort ?? '')}>
            <option value="">Not recording this</option>
            <option value="1">1 — uncomfortable</option>
            <option value="2">2</option>
            <option value="3">3 — neutral</option>
            <option value="4">4</option>
            <option value="5">5 — very comfortable</option>
          </Select>
        </Field>
      </div>
      <Field
        label="Anything you want to note"
        htmlFor="journal-concerns"
        hint="Comma separated, in your own words. GymOS does not infer or interpret these."
      >
        <Input
          id="journal-concerns"
          name="concerns"
          maxLength={400}
          defaultValue={entry?.concerns.join(', ') ?? ''}
        />
      </Field>
      {products.length > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="block text-sm font-medium">Products used</legend>
          <div className="flex flex-wrap gap-2">
            {products.map((product) => (
              <label
                key={product.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-sm"
              >
                <input type="checkbox" name="productIdsUsed" value={product.id} />
                {product.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Field label="Notes" htmlFor="journal-note" hint="Optional.">
        <Textarea
          id="journal-note"
          name="note"
          rows={3}
          maxLength={1000}
          defaultValue={entry?.note ?? ''}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        Save entry
      </Button>
      <Result state={state} />
    </form>
  );
}

export function JournalEntryRow({
  entry,
}: {
  entry: { id: string; date: string; comfort: number | null; concerns: string[]; note: string };
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <li className="rounded-xl border border-[var(--border)] px-3.5 py-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium tabular-nums">{entry.date}</p>
          {entry.concerns.length > 0 ? (
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              You noted: {entry.concerns.join(', ')}
            </p>
          ) : null}
          {entry.note ? <p className="mt-1 leading-relaxed">{entry.note}</p> : null}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {entry.comfort != null ? (
            <Badge tone="neutral">comfort {entry.comfort}/5, your rating</Badge>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setState(await deleteJournalEntryAction(entry.id));
              })
            }
            className="h-8 w-8 grid place-items-center rounded-lg text-bad-500 hover:bg-bad-100/40"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Delete entry for {entry.date}</span>
          </button>
        </div>
      </div>
      <Result state={state} />
    </li>
  );
}

/* ------------------------------------------------------------- patch tests */

export function PatchTestForm({
  products,
  windowOptions,
  defaultWindowHours,
}: {
  products: ProductOption[];
  windowOptions: readonly number[];
  defaultWindowHours: number;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  if (products.length === 0) {
    return (
      <Notice tone="neutral">
        Add a product above first — a patch test is always attached to one of your own products.
      </Notice>
    );
  }

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await startPatchTestAction({}, data));
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Product" htmlFor="patch-product" required>
          <Select id="patch-product" name="productId" required>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Observation window"
          htmlFor="patch-window"
          hint="Nothing can be concluded before the window closes."
        >
          <Select id="patch-window" name="windowHours" defaultValue={String(defaultWindowHours)}>
            {windowOptions.map((hours) => (
              <option key={hours} value={String(hours)}>
                {hours} hours
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Where on your skin, and anything else" htmlFor="patch-note" hint="Optional.">
        <Textarea id="patch-note" name="note" rows={2} maxLength={1000} />
      </Field>
      <Button type="submit" disabled={pending}>
        Start patch test
      </Button>
      <Result state={state} />
    </form>
  );
}

export function PatchTestRow({
  test,
  verdict,
}: {
  test: {
    id: string;
    productName: string;
    startedAt: string;
    checkAt: string;
    outcome: string;
    note: string;
  };
  verdict: { code: string; label: string; detail: string; windowClosed: boolean };
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  const tone =
    verdict.code === 'reaction_observed'
      ? 'bad'
      : verdict.code === 'in_progress'
        ? 'neutral'
        : verdict.code === 'no_reaction_observed'
          ? 'ok'
          : 'warn';

  return (
    <li className="rounded-xl border border-[var(--border)] px-3.5 py-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{test.productName}</p>
          <p className="text-xs text-[var(--text-muted)]">
            started {new Date(test.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            {' · window closes '}
            {new Date(test.checkAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <p className="mt-1 leading-relaxed">{verdict.detail}</p>
          {test.note ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">Your note: {test.note}</p>
          ) : null}
        </div>
        <Badge tone={tone}>{verdict.label}</Badge>
      </div>

      {test.outcome === 'pending' ? (
        <form
          action={(data) =>
            startTransition(async () => {
              setState(await observePatchTestAction({}, data));
            })
          }
          className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
        >
          <input type="hidden" name="testId" value={test.id} />
          {/* No default: "no reaction" is never the answer the app picks for you. */}
          <Select name="outcome" defaultValue="" required aria-label="What you observed">
            <option value="">What did you see?</option>
            <option value="no_reaction">I saw no reaction</option>
            <option value="reaction">I saw a reaction</option>
            <option value="unsure">I could not tell</option>
          </Select>
          <Input name="note" maxLength={1000} placeholder="What you saw (optional)" aria-label="Observation note" />
          <Button type="submit" variant="secondary" size="sm" disabled={pending}>
            Record
          </Button>
        </form>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setState(await deletePatchTestAction(test.id));
          })
        }
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        Delete
      </Button>
      <Result state={state} />
    </li>
  );
}
