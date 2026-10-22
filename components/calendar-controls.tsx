'use client';

import { useState, useTransition } from 'react';
import { Button, Notice, Select } from '@/components/ui';
import {
  rescheduleSessionAction,
  skipSessionAction,
  type ActionState,
} from '@/app/(app)/actions';

export function RescheduleControls({
  sessionId,
  currentDate,
  weekDates,
}: {
  sessionId: string;
  currentDate: string;
  weekDates: string[];
}) {
  const [date, setDate] = useState(currentDate);
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  function run(fn: typeof rescheduleSessionAction, extra: Record<string, string>) {
    const data = new FormData();
    data.set('sessionId', sessionId);
    for (const [k, v] of Object.entries(extra)) data.set(k, v);
    startTransition(async () => {
      setState(await fn({}, data));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={date}
        onChange={(e) => setDate(e.target.value)}
        aria-label="Move this session to"
        className="w-40 h-9 text-xs"
      >
        {weekDates.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || date === currentDate}
        onClick={() => run(rescheduleSessionAction, { date })}
      >
        Move
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(skipSessionAction, { reason: 'Skipped from the calendar' })}
      >
        Skip
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? (
        <span className="text-xs text-ok-500" role="status">
          {state.success}
        </span>
      ) : null}
    </div>
  );
}
