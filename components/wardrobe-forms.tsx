'use client';

import { useMemo, useState, useTransition } from 'react';
import { Plus, Shirt, Trash2, Archive, WashingMachine, CheckCircle2, Pencil, Save, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import { CATEGORY_OPTIONS, SLOT_LABELS, tagCheckboxes } from '@/lib/engines/outfit';
import {
  createWardrobeItemAction,
  updateWardrobeItemAction,
  archiveWardrobeItemAction,
  deleteWardrobeItemAction,
  logItemWearAction,
  setItemCareFlagAction,
  type ActionState,
} from '@/app/(app)/wardrobe/actions';

export interface WardrobeItemView {
  id: string;
  name: string;
  category: string;
  slot: string | null;
  colors: string[];
  unrecognisedColors: string[];
  fabric: string;
  sizeLabel: string;
  occasionTags: string[];
  seasonTags: string[];
  formality: number;
  warmth: number;
  favourite: boolean;
  needsCare: boolean;
  timesWorn: number;
  lastWornAt: string | null;
  archived: boolean;
  assetId: string | null;
  notes: string;
}

const FORMALITY_LABELS = [
  '1 — training or lounging',
  '2 — casual',
  '3 — smart casual',
  '4 — work',
  '5 — formal',
];

const WARMTH_LABELS = [
  '1 — for hot weather',
  '2 — light',
  '3 — mid weight',
  '4 — warm',
  '5 — for cold weather',
];

const OCCASION_TAGS = ['casual', 'work', 'formal', 'active'];
const SEASON_TAGS = ['summer', 'monsoon', 'winter', 'spring', 'autumn', 'all season'];

/* ----------------------------------------------------------------- add item */

export function WardrobeItemForm({
  photoUpload,
}: {
  /** Honest state of the photo option, decided on the server. */
  photoUpload: { enabled: boolean; reason: string };
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          if (photoUpload.enabled) {
            const file = data.get('photo');
            if (file instanceof File && file.size > 0) {
              const body = new FormData();
              body.set('file', file);
              body.set('kind', 'photo');
              const response = await fetch('/api/media', { method: 'POST', body });
              const payload: unknown = await response.json().catch(() => null);
              const id =
                payload && typeof payload === 'object' && 'id' in payload
                  ? String((payload as { id: unknown }).id)
                  : '';
              if (!response.ok || !id) {
                const message =
                  payload && typeof payload === 'object' && 'error' in payload
                    ? String((payload as { error: unknown }).error)
                    : 'That photo could not be saved, so nothing was added.';
                setState({ error: message });
                return;
              }
              data.set('assetId', id);
            }
          }
          data.delete('photo');
          setState(await createWardrobeItemAction({}, data));
        })
      }
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="wardrobe-name" required hint="Whatever you call it.">
          <Input id="wardrobe-name" name="name" required maxLength={80} placeholder="Navy linen shirt" />
        </Field>
        <Field
          label="Kind of garment"
          htmlFor="wardrobe-category"
          required
          hint="This decides which part of an outfit it can fill."
        >
          <Select id="wardrobe-category" name="category" required defaultValue="shirt">
            {CATEGORY_OPTIONS.filter((group) => group.categories.length > 0).map((group) => (
              <optgroup key={group.slot} label={SLOT_LABELS[group.slot]}>
                {group.categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Colours"
          htmlFor="wardrobe-colours"
          hint="Comma separated, main colour first. GymOS matches names it knows, such as navy, tan, olive, rust."
        >
          <Input id="wardrobe-colours" name="colours" placeholder="navy, white" />
        </Field>
        <Field label="Fabric" htmlFor="wardrobe-fabric" hint="Optional, for your own reference.">
          <Input id="wardrobe-fabric" name="fabric" maxLength={60} placeholder="linen" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Formality" htmlFor="wardrobe-formality" hint="Your own call on a 1-5 scale.">
          <Select id="wardrobe-formality" name="formality" defaultValue="2">
            {FORMALITY_LABELS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Warmth" htmlFor="wardrobe-warmth" hint="How warm it is to wear.">
          <Select id="wardrobe-warmth" name="warmth" defaultValue="2">
            {WARMTH_LABELS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Size label"
          htmlFor="wardrobe-size"
          hint="As printed on the garment. Not a body measurement."
        >
          <Input id="wardrobe-size" name="sizeLabel" maxLength={30} placeholder="M" />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What you wear it for</legend>
        <div className="flex flex-wrap gap-3">
          {OCCASION_TAGS.map((tag) => (
            <label key={tag} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="occasionTags" value={tag} className="h-4 w-4" />
              {tag}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Season</legend>
        <div className="flex flex-wrap gap-3">
          {SEASON_TAGS.map((tag) => (
            <label key={tag} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="seasonTags" value={tag} className="h-4 w-4" />
              {tag}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Notes" htmlFor="wardrobe-notes" hint="Optional.">
        <Textarea id="wardrobe-notes" name="notes" rows={2} maxLength={500} />
      </Field>

      {photoUpload.enabled ? (
        <Field
          label="Photo (optional)"
          htmlFor="wardrobe-photo"
          hint="Stored encrypted in your private media, metadata stripped. It is only ever shown back to you. GymOS does not analyse it — there is no image analysis in this build."
        >
          <Input id="wardrobe-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
        </Field>
      ) : (
        <Notice tone="neutral" title="Photos are off">
          {photoUpload.reason} Everything else on this page works without a photo.
        </Notice>
      )}

      <Button type="submit" disabled={pending}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add item
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
    </form>
  );
}

/* ---------------------------------------------------------------- edit item */

const KNOWN_CATEGORIES = CATEGORY_OPTIONS.flatMap((group) => group.categories);

/**
 * Edits one item in place. Every input is seeded from the stored row, so saving
 * changes only what was actually typed over. Fields this form does not carry —
 * the photo, the care flag, the archive flag — are not sent, and the action
 * leaves them alone.
 */
function ItemEditForm({
  item,
  onDone,
  onResult,
}: {
  item: WardrobeItemView;
  onDone: () => void;
  onResult: (state: ActionState) => void;
}) {
  const [pending, startTransition] = useTransition();
  // A category typed outside the picker (an import, or an older build) must stay
  // selectable, or saving the form would silently rewrite it.
  const ownCategory = KNOWN_CATEGORIES.includes(item.category) ? null : item.category;
  // Same hazard for the two checkbox groups, and worse: this form declares both
  // groups present, so whatever it does not render is what the save clears. A
  // tag outside the fixed lists therefore has to be on screen, already ticked,
  // or editing anything at all would erase it.
  const occasionBoxes = tagCheckboxes(OCCASION_TAGS, item.occasionTags);
  const seasonBoxes = tagCheckboxes(SEASON_TAGS, item.seasonTags);

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          const result = await updateWardrobeItemAction({}, data);
          onResult(result);
          if (!result.error) onDone();
        })
      }
      className="space-y-3 rounded-xl border border-[var(--border)] p-3"
    >
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="occasionTagsPresent" value="1" />
      <input type="hidden" name="seasonTagsPresent" value="1" />

      <Field label="Name" htmlFor={`edit-name-${item.id}`} required>
        <Input
          id={`edit-name-${item.id}`}
          name="name"
          required
          maxLength={80}
          defaultValue={item.name}
        />
      </Field>

      <Field label="Kind of garment" htmlFor={`edit-category-${item.id}`} required>
        <Select
          id={`edit-category-${item.id}`}
          name="category"
          required
          defaultValue={item.category}
        >
          {ownCategory ? <option value={ownCategory}>{ownCategory}</option> : null}
          {CATEGORY_OPTIONS.filter((group) => group.categories.length > 0).map((group) => (
            <optgroup key={group.slot} label={SLOT_LABELS[group.slot]}>
              {group.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      <Field
        label="Colours"
        htmlFor={`edit-colours-${item.id}`}
        hint="Comma separated, main colour first. Clearing this removes the colours, and suggestions then say colour was not scored."
      >
        <Input
          id={`edit-colours-${item.id}`}
          name="colours"
          defaultValue={item.colors.join(', ')}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fabric" htmlFor={`edit-fabric-${item.id}`}>
          <Input
            id={`edit-fabric-${item.id}`}
            name="fabric"
            maxLength={60}
            defaultValue={item.fabric}
          />
        </Field>
        <Field label="Size label" htmlFor={`edit-size-${item.id}`} hint="As printed on the garment.">
          <Input
            id={`edit-size-${item.id}`}
            name="sizeLabel"
            maxLength={30}
            defaultValue={item.sizeLabel}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Formality" htmlFor={`edit-formality-${item.id}`} hint="Your own call, 1-5.">
          <Select
            id={`edit-formality-${item.id}`}
            name="formality"
            defaultValue={String(item.formality)}
          >
            {FORMALITY_LABELS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Warmth" htmlFor={`edit-warmth-${item.id}`} hint="How warm it is to wear.">
          <Select id={`edit-warmth-${item.id}`} name="warmth" defaultValue={String(item.warmth)}>
            {WARMTH_LABELS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What you wear it for</legend>
        <div className="flex flex-wrap gap-3">
          {occasionBoxes.map(({ tag, checked }) => (
            <label key={tag} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="occasionTags"
                value={tag}
                defaultChecked={checked}
                className="h-4 w-4"
              />
              {tag}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Season</legend>
        <div className="flex flex-wrap gap-3">
          {seasonBoxes.map(({ tag, checked }) => (
            <label key={tag} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="seasonTags"
                value={tag}
                defaultChecked={checked}
                className="h-4 w-4"
              />
              {tag}
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Notes" htmlFor={`edit-notes-${item.id}`} hint="Optional.">
        <Textarea
          id={`edit-notes-${item.id}`}
          name="notes"
          rows={2}
          maxLength={500}
          defaultValue={item.notes}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          <Save className="h-4 w-4" aria-hidden="true" />
          Save changes
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------------- grid */

export function WardrobeGrid({ items }: { items: WardrobeItemView[] }) {
  const [slot, setSlot] = useState('all');
  const [occasion, setOccasion] = useState('all');
  const [query, setQuery] = useState('');
  const [careOnly, setCareOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  const slots = useMemo(() => {
    const present = new Set<string>();
    for (const item of items) if (item.slot) present.add(item.slot);
    return [...present].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (slot !== 'all' && item.slot !== slot) return false;
      if (occasion !== 'all' && !item.occasionTags.includes(occasion)) return false;
      if (careOnly && !item.needsCare) return false;
      if (!needle) return true;
      return (
        item.name.toLowerCase().includes(needle) ||
        item.category.toLowerCase().includes(needle) ||
        item.colors.some((c) => c.toLowerCase().includes(needle))
      );
    });
  }, [items, slot, occasion, query, careOnly]);

  const act = (fn: () => Promise<ActionState>) => {
    startTransition(async () => {
      setState(await fn());
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Part of an outfit" htmlFor="wardrobe-filter-slot">
          <Select
            id="wardrobe-filter-slot"
            value={slot}
            onChange={(event) => setSlot(event.target.value)}
          >
            <option value="all">All</option>
            {slots.map((value) => (
              <option key={value} value={value}>
                {value.replace('_', ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Occasion tag" htmlFor="wardrobe-filter-occasion">
          <Select
            id="wardrobe-filter-occasion"
            value={occasion}
            onChange={(event) => setOccasion(event.target.value)}
          >
            <option value="all">All</option>
            {OCCASION_TAGS.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search" htmlFor="wardrobe-filter-search">
          <Input
            id="wardrobe-filter-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="name, kind or colour"
          />
        </Field>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={careOnly}
              onChange={(event) => setCareOnly(event.target.checked)}
              className="h-4 w-4"
            />
            In the wash only
          </label>
        </div>
      </div>

      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}

      <p className="text-sm text-[var(--text-muted)]">
        Showing {filtered.length} of {items.length} items.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((item) => (
          <Card key={item.id} className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              {item.assetId ? (
                // The ONLY way media is shown: the authenticated handler, never a public URL.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/media/${item.assetId}`}
                  alt={`Your photo of ${item.name}`}
                  className="h-16 w-16 rounded-lg object-cover border border-[var(--border)]"
                />
              ) : (
                <div className="h-16 w-16 rounded-lg grid place-items-center bg-[var(--surface-sunken)] text-[var(--text-muted)]">
                  <Shirt className="h-5 w-5" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm leading-tight">{item.name}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {item.category}
                  {item.sizeLabel ? ` · size ${item.sizeLabel}` : ''}
                  {item.fabric ? ` · ${item.fabric}` : ''}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {item.colors.length > 0 ? item.colors.join(', ') : 'No colour recorded'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Badge tone="neutral">formality {item.formality}/5</Badge>
              <Badge tone="neutral">warmth {item.warmth}/5</Badge>
              {item.needsCare ? <Badge tone="warn">in the wash</Badge> : null}
              {item.archived ? <Badge tone="neutral">stored away</Badge> : null}
              {item.unrecognisedColors.length > 0 ? (
                <Badge tone="neutral">colour not in the table</Badge>
              ) : null}
            </div>

            <p className="text-xs text-[var(--text-muted)]">
              Worn {item.timesWorn} {item.timesWorn === 1 ? 'time' : 'times'}
              {item.lastWornAt ? `, last on ${item.lastWornAt}` : ' so far'}.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => act(() => logItemWearAction(item.id))}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Wore it
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                aria-expanded={editing === item.id}
                onClick={() => setEditing(editing === item.id ? null : item.id)}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {editing === item.id ? 'Close editor' : 'Edit'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => act(() => setItemCareFlagAction(item.id, !item.needsCare))}
              >
                <WashingMachine className="h-4 w-4" aria-hidden="true" />
                {item.needsCare ? 'Ready to wear' : 'Needs a wash'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => act(() => archiveWardrobeItemAction(item.id, !item.archived))}
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                {item.archived ? 'Unstore' : 'Store away'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="quiet"
                disabled={pending}
                onClick={() => act(() => deleteWardrobeItemAction(item.id))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            </div>

            {editing === item.id ? (
              <ItemEditForm
                item={item}
                onDone={() => setEditing(null)}
                onResult={(result) => setState(result)}
              />
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
