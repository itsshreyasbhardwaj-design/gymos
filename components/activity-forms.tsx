'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Field, Input, Notice, Select } from '@/components/ui';
import { addActivityAction, deleteActivityAction, type ActionState } from '@/app/(app)/actions';

export function ActivityForm() {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await addActivityAction({}, data));
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Activity" htmlFor="activity-kind">
          <Select id="activity-kind" name="kind" defaultValue="walk">
            <option value="walk">Walk</option>
            <option value="cycle">Cycle</option>
            <option value="run">Run</option>
            <option value="swim">Swim</option>
            <option value="sport">Sport</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Date" htmlFor="activity-date">
          <Input
            id="activity-date"
            name="date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </Field>
        <Field label="Minutes" htmlFor="activity-minutes">
          <Input id="activity-minutes" name="minutes" type="number" min="1" max="600" />
        </Field>
        <Field label="Distance (km)" htmlFor="activity-distance" hint="Optional.">
          <Input id="activity-distance" name="distanceKm" type="number" step="0.1" min="0" />
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        Record activity
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
    </form>
  );
}

export function ActivityList({
  items,
}: {
  items: {
    id: string;
    kind: string;
    date: string;
    minutes: number | null;
    distanceMeters: number | null;
    steps: number | null;
    notes: string;
  }[];
}) {
  const [local, setLocal] = useState(items);
  const [, startTransition] = useTransition();

  if (local.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No activity recorded yet.</p>;
  }

  return (
    <ul className="space-y-1">
      {local.map((a) => (
        <li
          key={a.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm"
        >
          <span className="min-w-0">
            <span className="capitalize">{a.kind}</span>
            <span className="block text-xs text-[var(--text-muted)]">{a.date}</span>
          </span>
          <span className="tabular-nums text-[var(--text-muted)] shrink-0">
            {a.minutes ? `${a.minutes} min` : ''}
            {a.distanceMeters ? ` · ${(a.distanceMeters / 1000).toFixed(1)} km` : ''}
            {a.steps ? ` · ${a.steps.toLocaleString('en-IN')} steps` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              setLocal((prev) => prev.filter((i) => i.id !== a.id));
              startTransition(async () => {
                await deleteActivityAction(a.id);
              });
            }}
            className="h-8 w-8 grid place-items-center rounded-lg text-bad-500 hover:bg-bad-100/40"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Delete this activity record</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
