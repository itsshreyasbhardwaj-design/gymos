'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { Badge, Button, Notice } from '@/components/ui';
import {
  forgetMemoryAction,
  removePreferenceItemAction,
  type ActionState,
} from '@/app/(app)/actions';

export function MemoryControls({
  memoryKey,
  values,
  rawValue,
}: {
  memoryKey: string;
  values: { id: string; label: string }[] | null;
  rawValue: string | null;
}) {
  const [local, setLocal] = useState(values ?? []);
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  function forgetAll() {
    const data = new FormData();
    data.set('key', memoryKey);
    startTransition(async () => {
      setState(await forgetMemoryAction({}, data));
      setLocal([]);
    });
  }

  function removeOne(id: string) {
    const data = new FormData();
    data.set('key', memoryKey);
    data.set('value', id);
    setLocal((prev) => prev.filter((v) => v.id !== id));
    startTransition(async () => {
      setState(await removePreferenceItemAction({}, data));
    });
  }

  return (
    <div className="space-y-3">
      {values ? (
        local.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nothing stored.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {local.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] pl-3 pr-1 py-1 text-sm"
              >
                {v.label}
                <button
                  type="button"
                  onClick={() => removeOne(v.id)}
                  disabled={pending}
                  className="h-6 w-6 grid place-items-center rounded-md hover:bg-[var(--surface-sunken)]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">Forget {v.label}</span>
                </button>
              </span>
            ))}
          </div>
        )
      ) : (
        <code className="text-xs font-mono break-all text-[var(--text-muted)]">{rawValue}</code>
      )}

      <Button variant="ghost" size="sm" onClick={forgetAll} disabled={pending}>
        Forget all of this
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
    </div>
  );
}
