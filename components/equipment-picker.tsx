'use client';

import { useMemo, useState } from 'react';
import { Search, Check } from 'lucide-react';
import { Badge, Input } from '@/components/ui';
import { cn } from '@/lib/ui/cn';

export interface EquipmentOption {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  aliases: string[];
  description: string;
}

export interface PresetOption {
  key: string;
  label: string;
  description: string;
  ids: string[];
}

/**
 * Equipment DNA selector. Presets are a starting point; every item is individually
 * toggleable, because "a gym" means something different in every building.
 */
export function EquipmentPicker({
  options,
  presets,
  initialSelected = [],
  name = 'equipment',
  showPresets = true,
}: {
  options: EquipmentOption[];
  presets?: PresetOption[];
  initialSelected?: string[];
  name?: string;
  showPresets?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of options) map.set(o.category, o.categoryLabel);
    return [...map.entries()].map(([id, label]) => ({ id, label }));
  }, [options]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((o) => {
      if (o.id === 'none') return false;
      if (activeCategory && o.category !== activeCategory) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.aliases.some((a) => a.toLowerCase().includes(q)) ||
        o.categoryLabel.toLowerCase().includes(q)
      );
    });
  }, [options, query, activeCategory]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function applyPreset(preset: PresetOption) {
    setSelected(new Set(preset.ids));
  }

  const grouped = useMemo(() => {
    const map = new Map<string, EquipmentOption[]>();
    for (const o of visible) {
      const list = map.get(o.categoryLabel) ?? [];
      list.push(o);
      map.set(o.categoryLabel, list);
    }
    return [...map.entries()];
  }, [visible]);

  return (
    <div className="space-y-4">
      {[...selected].map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}

      {showPresets && presets ? (
        <div>
          <p className="text-sm font-medium mb-2">Start from a typical setup</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded-xl border border-[var(--border-strong)] px-3 py-2 text-left hover:border-[var(--accent)] transition-colors"
              >
                <span className="block text-sm font-medium">{preset.label}</span>
                <span className="block text-xs text-[var(--text-muted)]">{preset.ids.length} items</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search equipment…"
            className="pl-9"
            aria-label="Search equipment"
          />
        </div>
        <Badge tone={selected.size > 0 ? 'brand' : 'neutral'}>{selected.size} selected</Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveCategory(null)}
          className={cn(
            'rounded-lg px-2.5 py-1 text-xs transition-colors',
            activeCategory === null
              ? 'bg-[var(--accent)] text-white'
              : 'bg-[var(--surface-sunken)] hover:bg-[var(--border)]',
          )}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCategory(c.id)}
            className={cn(
              'rounded-lg px-2.5 py-1 text-xs transition-colors',
              activeCategory === c.id
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--surface-sunken)] hover:bg-[var(--border)]',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="space-y-5 max-h-[26rem] overflow-y-auto pr-1">
        {grouped.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center">
            Nothing matches “{query}”. Custom equipment can be added from the Equipment page once
            you are set up.
          </p>
        ) : null}
        {grouped.map(([label, items]) => (
          <div key={label}>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
              {label}
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {items.map((item) => {
                const on = selected.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggle(item.id)}
                    aria-pressed={on}
                    className={cn(
                      'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      on
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border)] hover:border-[var(--border-strong)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-5 w-5 shrink-0 rounded-md border grid place-items-center',
                        on ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-[var(--border-strong)]',
                      )}
                    >
                      {on ? <Check className="h-3.5 w-3.5 text-white" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm leading-tight">{item.name}</span>
                      {item.description ? (
                        <span className="block text-xs text-[var(--text-muted)] truncate">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
