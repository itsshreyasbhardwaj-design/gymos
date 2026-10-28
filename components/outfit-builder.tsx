'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Check, Save, Star, Trash2, Wand2, X } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Notice,
  Select,
  BulletList,
} from '@/components/ui';
import { OCCASIONS, WEATHER_BANDS } from '@/lib/engines/outfit';
import {
  saveOutfitAction,
  deleteOutfitAction,
  logOutfitWearAction,
  setOutfitFavouriteAction,
  setOutfitPlanAction,
  setOutfitPlanStatusAction,
  deleteOutfitPlanAction,
  type ActionState,
} from '@/app/(app)/wardrobe/actions';

export interface SuggestionView {
  key: string;
  itemIds: string[];
  picks: { slot: string; itemId: string; itemName: string; colourLabel: string | null }[];
  score: number;
  /** null when the engine could not compare any pairing in this combination. */
  colourScore: number | null;
  colourScoreNote: string | null;
  /** How much of the combination the colour score actually covers. */
  colourPairsScored: number;
  colourPairsTotal: number;
  formalityScore: number;
  weatherScore: number;
  missingSlots: string[];
  explanation: string[];
  summary: string;
}

export interface SavedOutfitView {
  id: string;
  name: string;
  occasion: string;
  source: string;
  rationale: string;
  favourite: boolean;
  timesWorn: number;
  lastWornAt: string | null;
  items: { id: string; name: string; category: string }[];
  missingItemIds: string[];
}

/* ------------------------------------------------------------- suggestions */

export function SuggestionControls({
  occasion,
  weather,
}: {
  occasion: string;
  weather: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (nextOccasion: string, nextWeather: string) => {
    startTransition(() => {
      router.replace(`/wardrobe/outfits?occasion=${nextOccasion}&weather=${nextWeather}`);
    });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Occasion" htmlFor="suggest-occasion">
        <Select
          id="suggest-occasion"
          value={occasion}
          disabled={pending}
          onChange={(event) => go(event.target.value, weather)}
        >
          {OCCASIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Weather today" htmlFor="suggest-weather">
        <Select
          id="suggest-weather"
          value={weather}
          disabled={pending}
          onChange={(event) => go(occasion, event.target.value)}
        >
          {WEATHER_BANDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

export function SuggestionList({
  suggestions,
  occasion,
}: {
  suggestions: SuggestionView[];
  occasion: string;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}

      {suggestions.map((suggestion) => (
        <Card key={suggestion.key} className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="font-medium">{suggestion.summary}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {suggestion.picks.map((pick) => (
                  <Badge key={pick.itemId} tone="neutral">
                    {pick.slot.replace('_', ' ')}: {pick.itemName}
                  </Badge>
                ))}
              </div>
            </div>
            {suggestion.colourScore === null ? (
              <Badge tone="neutral">colour not scored</Badge>
            ) : (
              <Badge tone="brand">colour {Math.round(suggestion.colourScore * 100)}%</Badge>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
              Why these go together
            </p>
            <BulletList items={suggestion.explanation} />
          </div>

          {suggestion.colourScore === null ? (
            <p className="text-xs text-[var(--text-muted)]">
              {suggestion.colourScoreNote ?? 'Colour is not scored for this combination.'}{' '}
              Formality {Math.round(suggestion.formalityScore * 100)}%, weather{' '}
              {Math.round(suggestion.weatherScore * 100)}% — computed from the formality levels and
              warmth levels you recorded, nothing else.
            </p>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              Match on colour {Math.round(suggestion.colourScore * 100)}%
              {/*
               * The caveat belongs in this sentence, not only in the bullet list
               * above: this is the sentence that claims where the numbers come
               * from, so it is the one a wearer would quote back. A colour score
               * measured from some of the pairings is a number about those
               * pairings, and saying so here is the difference between a
               * measurement and an overclaim.
               */}
              {suggestion.colourPairsScored < suggestion.colourPairsTotal
                ? ` (the ${suggestion.colourPairsScored} of ${suggestion.colourPairsTotal} pairings GymOS could compare; the rest are not counted either way)`
                : ''}
              , formality {Math.round(suggestion.formalityScore * 100)}%, weather{' '}
              {Math.round(suggestion.weatherScore * 100)}% — computed from the colours, formality
              levels and warmth levels you recorded, nothing else.
            </p>
          )}

          <form
            action={(data) =>
              startTransition(async () => {
                setState(await saveOutfitAction({}, data));
              })
            }
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="occasion" value={occasion} />
            <input type="hidden" name="source" value="suggested" />
            <input type="hidden" name="rationale" value={suggestion.explanation.join(' ')} />
            {suggestion.itemIds.map((id) => (
              <input key={id} type="hidden" name="itemIds" value={id} />
            ))}
            <Field label="Save as" htmlFor={`save-${suggestion.key}`}>
              <Input
                id={`save-${suggestion.key}`}
                name="name"
                required
                maxLength={80}
                defaultValue={suggestion.picks
                  .slice(0, 2)
                  .map((pick) => pick.itemName)
                  .join(' + ')}
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={pending}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save this combination
            </Button>
          </form>
        </Card>
      ))}
    </div>
  );
}

export function SavedOutfitList({ outfits }: { outfits: SavedOutfitView[] }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  const act = (fn: () => Promise<ActionState>) => {
    startTransition(async () => {
      setState(await fn());
    });
  };

  return (
    <div className="space-y-3">
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}

      {outfits.map((outfit) => (
        <Card key={outfit.id} className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">{outfit.name}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {outfit.items.map((item) => item.name).join(', ') || 'No items left on this outfit'}
              </p>
              {outfit.missingItemIds.length > 0 ? (
                <p className="text-xs text-warn-500 mt-1">
                  {outfit.missingItemIds.length} item
                  {outfit.missingItemIds.length === 1 ? '' : 's'} on this outfit are no longer in
                  your wardrobe.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge tone="neutral">{outfit.occasion}</Badge>
              <Badge tone="neutral">
                {outfit.source === 'suggested' ? 'from a suggestion' : 'your own'}
              </Badge>
            </div>
          </div>

          {outfit.rationale ? (
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">{outfit.rationale}</p>
          ) : null}

          <p className="text-xs text-[var(--text-muted)]">
            Worn {outfit.timesWorn} {outfit.timesWorn === 1 ? 'time' : 'times'}
            {outfit.lastWornAt ? `, last on ${outfit.lastWornAt}` : ' so far'}.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => act(() => logOutfitWearAction(outfit.id))}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Wore this
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => act(() => setOutfitFavouriteAction(outfit.id, !outfit.favourite))}
            >
              <Star className="h-4 w-4" aria-hidden="true" />
              {outfit.favourite ? 'Unfavourite' : 'Favourite'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              disabled={pending}
              onClick={() => act(() => deleteOutfitAction(outfit.id))}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- planner */

export interface PlanDayView {
  date: string;
  label: string;
  plans: {
    id: string;
    occasion: string;
    status: string;
    note: string;
    outfitName: string | null;
    itemNames: string[];
  }[];
}

export function WeekPlanner({
  days,
  outfits,
}: {
  days: PlanDayView[];
  outfits: { id: string; name: string }[];
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  const hasOutfits = outfits.length > 0;
  const statusTone = useMemo(
    () =>
      ({ planned: 'neutral', worn: 'ok', skipped: 'neutral' }) as Record<
        string,
        'neutral' | 'ok'
      >,
    [],
  );

  const act = (fn: () => Promise<ActionState>) => {
    startTransition(async () => {
      setState(await fn());
    });
  };

  return (
    <div className="space-y-4">
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {days.map((day) => (
          <Card key={day.date}>
            <CardHeader title={day.label} subtitle={day.date} />
            <div className="px-5 pb-5 space-y-3">
              {day.plans.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Nothing planned.</p>
              ) : (
                day.plans.map((plan) => (
                  <div
                    key={plan.id}
                    className="rounded-xl border border-[var(--border)] p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {plan.outfitName ?? 'No outfit attached'}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {plan.occasion}
                          {plan.itemNames.length > 0 ? ` · ${plan.itemNames.join(', ')}` : ''}
                        </p>
                        {plan.note ? (
                          <p className="text-xs text-[var(--text-muted)] mt-1">{plan.note}</p>
                        ) : null}
                      </div>
                      <Badge tone={statusTone[plan.status] ?? 'neutral'}>{plan.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => act(() => setOutfitPlanStatusAction(plan.id, 'worn'))}
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Wore it
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => act(() => setOutfitPlanStatusAction(plan.id, 'skipped'))}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Wore something else
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="quiet"
                        disabled={pending}
                        onClick={() => act(() => deleteOutfitPlanAction(plan.id))}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                  </div>
                ))
              )}

              {hasOutfits ? (
                <form
                  action={(data) =>
                    startTransition(async () => {
                      setState(await setOutfitPlanAction({}, data));
                    })
                  }
                  className="space-y-2 pt-1"
                >
                  <input type="hidden" name="date" value={day.date} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Outfit" htmlFor={`plan-outfit-${day.date}`}>
                      <Select id={`plan-outfit-${day.date}`} name="outfitId" required>
                        {outfits.map((outfit) => (
                          <option key={outfit.id} value={outfit.id}>
                            {outfit.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Occasion" htmlFor={`plan-occasion-${day.date}`}>
                      <Select id={`plan-occasion-${day.date}`} name="occasion" defaultValue="casual">
                        {OCCASIONS.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Note" htmlFor={`plan-note-${day.date}`} hint="Optional.">
                    <Input id={`plan-note-${day.date}`} name="note" maxLength={200} />
                  </Field>
                  <Button type="submit" size="sm" variant="secondary" disabled={pending}>
                    <CalendarDays className="h-4 w-4" aria-hidden="true" />
                    Plan this day
                  </Button>
                </form>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  Save an outfit first and it will be assignable here.
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function GenerateHint() {
  return (
    <p className="text-sm text-[var(--text-muted)] flex items-center gap-2">
      <Wand2 className="h-4 w-4" aria-hidden="true" />
      Suggestions are rebuilt from your wardrobe each time you change the occasion or the weather.
    </p>
  );
}
