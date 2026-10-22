'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Heart, ThumbsDown, Check, Lock } from 'lucide-react';
import { Badge, Card, Input, Select } from '@/components/ui';
import { cn } from '@/lib/ui/cn';

export interface ExerciseListItem {
  id: string;
  name: string;
  pattern: string;
  patternLabel: string;
  category: string;
  level: string;
  primary: string[];
  primaryLabels: string[];
  equipmentSummary: string[];
  available: boolean;
  ageOk: boolean;
  levelOk: boolean;
  favourite: boolean;
  disliked: boolean;
  performed: boolean;
  aliases: string[];
}

export function ExerciseBrowser({
  items,
  patterns,
  muscles,
  profileName,
}: {
  items: ExerciseListItem[];
  patterns: { id: string; label: string }[];
  muscles: { id: string; label: string }[];
  profileName: string | null;
}) {
  const [query, setQuery] = useState('');
  const [pattern, setPattern] = useState('');
  const [muscle, setMuscle] = useState('');
  const [level, setLevel] = useState('');
  const [view, setView] = useState<'available' | 'all' | 'favourites' | 'performed'>('available');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (view === 'available' && !item.available) return false;
      if (view === 'favourites' && !item.favourite) return false;
      if (view === 'performed' && !item.performed) return false;
      if (pattern && item.pattern !== pattern) return false;
      if (muscle && !item.primary.includes(muscle)) return false;
      if (level && item.level !== level) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.aliases.some((a) => a.toLowerCase().includes(q)) ||
        item.primaryLabels.some((m) => m.toLowerCase().includes(q)) ||
        item.patternLabel.toLowerCase().includes(q)
      );
    });
  }, [items, query, pattern, muscle, level, view]);

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
            placeholder="Search by name, muscle or movement…"
            className="pl-9"
            aria-label="Search exercises"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Select value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Movement pattern">
            <option value="">All movement patterns</option>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select value={muscle} onChange={(e) => setMuscle(e.target.value)} aria-label="Muscle group">
            <option value="">All muscle groups</option>
            {muscles.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
          <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Experience level">
            <option value="">Any experience level</option>
            <option value="new">New to exercise</option>
            <option value="some">Some experience</option>
            <option value="regular">Regularly active</option>
            <option value="experienced">Experienced</option>
          </Select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['available', `Works with ${profileName ?? 'my equipment'}`],
              ['all', 'Everything'],
              ['favourites', 'Favourites'],
              ['performed', 'Recently performed'],
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
        {filtered.length} exercise{filtered.length === 1 ? '' : 's'}
      </p>

      <div className="grid gap-2">
        {filtered.map((item) => (
          <Link
            key={item.id}
            href={`/exercises/${item.id}`}
            className="rounded-xl border border-[var(--border)] p-3.5 hover:border-[var(--border-strong)] transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{item.name}</span>
                  {item.favourite ? (
                    <Heart className="h-3.5 w-3.5 text-[var(--accent)]" aria-label="Favourite" />
                  ) : null}
                  {item.disliked ? (
                    <ThumbsDown className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-label="Avoided" />
                  ) : null}
                  {item.performed ? (
                    <Check className="h-3.5 w-3.5 text-ok-500" aria-label="Recently performed" />
                  ) : null}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {item.patternLabel} · {item.primaryLabels.join(', ')}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {item.equipmentSummary.join(', ')}
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <Badge tone={item.available ? 'ok' : 'neutral'}>
                  {item.available ? 'Available' : <><Lock className="h-3 w-3" aria-hidden="true" /> Locked</>}
                </Badge>
                {!item.levelOk ? <Badge tone="warn">above your level</Badge> : null}
                {!item.ageOk ? <Badge tone="warn">not for your age band</Badge> : null}
              </div>
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
