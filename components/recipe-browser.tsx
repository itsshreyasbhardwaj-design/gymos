'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Clock, Lock } from 'lucide-react';
import { Badge, Card, Input, Select } from '@/components/ui';
import { cn } from '@/lib/ui/cn';

export interface RecipeListItem {
  id: string;
  name: string;
  cuisine: string;
  cuisineLabel: string;
  meals: string[];
  diet: string[];
  totalMinutes: number;
  servings: number;
  skill: string;
  allergens: string[];
  eligible: boolean;
  exclusions: string[];
}

export function RecipeBrowser({
  items,
  cuisines,
}: {
  items: RecipeListItem[];
  cuisines: { id: string; label: string }[];
}) {
  const [query, setQuery] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [slot, setSlot] = useState('');
  const [view, setView] = useState<'fits' | 'all'>('fits');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (view === 'fits' && !item.eligible) return false;
      if (cuisine && item.cuisine !== cuisine) return false;
      if (slot && !item.meals.includes(slot)) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.cuisineLabel.toLowerCase().includes(q) ||
        item.diet.some((d) => d.includes(q))
      );
    });
  }, [items, query, cuisine, slot, view]);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes…"
            className="pl-9"
            aria-label="Search recipes"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value={cuisine} onChange={(e) => setCuisine(e.target.value)} aria-label="Cuisine">
            <option value="">All cuisines</option>
            {cuisines.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
          <Select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Meal">
            <option value="">Any meal</option>
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </Select>
        </div>
        <div className="flex gap-1.5">
          {(
            [
              ['fits', 'Fits my preferences'],
              ['all', 'Everything'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs transition-colors',
                view === id
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--surface-sunken)] hover:bg-[var(--border)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>

      <p className="text-sm text-[var(--text-muted)]">
        {filtered.length} recipe{filtered.length === 1 ? '' : 's'}
      </p>

      <div className="grid gap-2">
        {filtered.map((item) => (
          <Link
            key={item.id}
            href={`/nutrition/recipes/${item.id}`}
            className="rounded-xl border border-[var(--border)] p-3.5 hover:border-[var(--border-strong)] transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm">{item.name}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 inline-flex items-center gap-2 flex-wrap">
                  <span>{item.cuisineLabel}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {item.totalMinutes} min
                  </span>
                  <span>· serves {item.servings}</span>
                </p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {item.diet.slice(0, 3).map((d) => (
                    <Badge key={d} tone="neutral">
                      {d.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                  {item.allergens.map((a) => (
                    <Badge key={a} tone="warn">
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
              {!item.eligible ? (
                <div className="shrink-0 text-right max-w-40">
                  <Badge tone="neutral">
                    <Lock className="h-3 w-3" aria-hidden="true" /> Filtered out
                  </Badge>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    {item.exclusions.slice(0, 2).join('; ')}
                  </p>
                </div>
              ) : null}
            </div>
          </Link>
        ))}
        {filtered.length === 0 ? (
          <Card className="p-8 text-center text-sm text-[var(--text-muted)]">
            Nothing matches those filters.
          </Card>
        ) : null}
      </div>
    </div>
  );
}
