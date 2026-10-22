'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Check, X, Clock } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Notice } from '@/components/ui';
import { swapMealAction, setMealStatusAction } from '@/app/(app)/actions';
import { cn } from '@/lib/ui/cn';

interface MealView {
  id: string;
  date: string;
  slot: string;
  recipeId: string;
  recipeName: string;
  servings: number;
  status: string;
  totalMinutes: number;
  cuisine: string;
  allergens: string[];
  swappedFromRecipeId: string | null;
  alternatives: {
    recipeId: string;
    name: string;
    cuisine: string;
    totalMinutes: number;
    omitIngredientIds: string[];
  }[];
}

const SLOT_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];

export function MealPlanBoard({ dates, meals }: { dates: string[]; meals: MealView[] }) {
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  return (
    <div className="space-y-4">
      {message ? (
        <Notice tone={message.tone === 'ok' ? 'ok' : 'bad'}>{message.text}</Notice>
      ) : null}
      {dates.map((date) => {
        const dayMeals = meals
          .filter((m) => m.date === date)
          .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
        const label = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        });
        return (
          <Card key={date}>
            <CardHeader title={label} subtitle={`${dayMeals.length} meal(s)`} />
            <div className="px-5 pb-5 space-y-2">
              {dayMeals.map((meal) => (
                <MealRow key={meal.id} meal={meal} onMessage={setMessage} />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function MealRow({
  meal,
  onMessage,
}: {
  meal: MealView;
  onMessage: (m: { tone: 'ok' | 'bad'; text: string } | null) => void;
}) {
  const [swapping, setSwapping] = useState(false);
  const [pending, startTransition] = useTransition();

  function swap(recipeId: string) {
    startTransition(async () => {
      const result = await swapMealAction(meal.id, recipeId);
      onMessage(
        result.error
          ? { tone: 'bad', text: result.error }
          : { tone: 'ok', text: result.success ?? 'Swapped.' },
      );
      setSwapping(false);
    });
  }

  function setStatus(status: 'planned' | 'cooked' | 'skipped') {
    startTransition(async () => {
      const result = await setMealStatusAction(meal.id, status);
      if (result.error) onMessage({ tone: 'bad', text: result.error });
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)]">
      <div className="flex items-start justify-between gap-3 p-3.5">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{meal.slot}</p>
          <Link
            href={`/nutrition/recipes/${meal.recipeId}`}
            className="font-medium text-sm hover:text-[var(--accent)]"
          >
            {meal.recipeName}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Badge tone="neutral">{meal.cuisine.replace(/_/g, ' ')}</Badge>
            <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {meal.totalMinutes} min
            </span>
            <span className="text-xs text-[var(--text-muted)]">· {meal.servings} serving(s)</span>
            {meal.status === 'cooked' ? <Badge tone="ok">cooked</Badge> : null}
            {meal.status === 'skipped' ? <Badge tone="neutral">skipped</Badge> : null}
            {meal.swappedFromRecipeId ? <Badge tone="warn">swapped</Badge> : null}
          </div>
        </div>
        <div className="shrink-0 flex gap-1">
          <button
            type="button"
            onClick={() => setStatus(meal.status === 'cooked' ? 'planned' : 'cooked')}
            disabled={pending}
            title="Mark as cooked"
            className={cn(
              'h-9 w-9 grid place-items-center rounded-lg border transition-colors',
              meal.status === 'cooked'
                ? 'border-ok-500 text-ok-500'
                : 'border-[var(--border)] hover:border-[var(--border-strong)]',
            )}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Mark cooked</span>
          </button>
          <button
            type="button"
            onClick={() => setStatus(meal.status === 'skipped' ? 'planned' : 'skipped')}
            disabled={pending}
            title="Skip this meal"
            className="h-9 w-9 grid place-items-center rounded-lg border border-[var(--border)] hover:border-[var(--border-strong)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Skip</span>
          </button>
          <button
            type="button"
            onClick={() => setSwapping((v) => !v)}
            disabled={pending}
            title="Swap this meal"
            className="h-9 w-9 grid place-items-center rounded-lg border border-[var(--border)] hover:border-[var(--border-strong)]"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Swap</span>
          </button>
        </div>
      </div>

      {swapping ? (
        <div className="border-t border-[var(--border)] p-3.5 space-y-1.5">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Every option below is re-checked against your allergens, diet, dislikes, time limit and
            cooking confidence.
          </p>
          {meal.alternatives.length === 0 ? (
            <Notice tone="warn">
              No other recipe in the library fits your preferences for this slot. Widening a
              preference would open more up.
            </Notice>
          ) : (
            meal.alternatives.map((alt) => (
              <button
                key={alt.recipeId}
                type="button"
                disabled={pending}
                onClick={() => swap(alt.recipeId)}
                className="w-full text-left rounded-lg border border-[var(--border)] px-3 py-2 hover:border-[var(--accent)] transition-colors"
              >
                <span className="block text-sm font-medium">{alt.name}</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  {alt.cuisine.replace(/_/g, ' ')} · {alt.totalMinutes} min
                  {alt.omitIngredientIds.length > 0
                    ? ` · leave out the optional ${alt.omitIngredientIds.join(', ')}`
                    : ''}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
