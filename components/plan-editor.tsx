'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Trash2, Plus, ChevronDown } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Notice, Select } from '@/components/ui';
import {
  replaceExerciseAction,
  removeExerciseAction,
  addExerciseAction,
  updateDoseAction,
} from '@/app/(app)/actions';
import { cn } from '@/lib/ui/cn';

interface Alternative {
  id: string;
  name: string;
  reason: string;
  samePattern: boolean;
}

interface PlannedExerciseView {
  id: string;
  exerciseId: string;
  name: string;
  patternLabel: string;
  role: string;
  sets: number;
  repsLow: number | null;
  repsHigh: number | null;
  durationSeconds: number | null;
  restSeconds: number;
  intensityNote: string;
  rationale: string;
  substitutedFrom: string | null;
  alternatives: Alternative[];
  noAlternativeReason: string | null;
}

interface DayView {
  id: string;
  label: string;
  focus: string;
  targetMinutes: number;
  exercises: PlannedExerciseView[];
}

export function PlanEditor({
  days,
  addable,
}: {
  days: DayView[];
  addable: { dayId: string; options: { id: string; name: string; pattern: string }[] }[];
}) {
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  return (
    <div className="space-y-4">
      {message ? (
        <Notice tone={message.tone === 'ok' ? 'ok' : 'bad'} className="sticky top-16 z-20">
          {message.text}
        </Notice>
      ) : null}
      {days.map((day) => (
        <DayCard
          key={day.id}
          day={day}
          addOptions={addable.find((a) => a.dayId === day.id)?.options ?? []}
          onMessage={setMessage}
        />
      ))}
    </div>
  );
}

function DayCard({
  day,
  addOptions,
  onMessage,
}: {
  day: DayView;
  addOptions: { id: string; name: string; pattern: string }[];
  onMessage: (m: { tone: 'ok' | 'bad'; text: string } | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newExerciseId, setNewExerciseId] = useState(addOptions[0]?.id ?? '');
  const [pending, startTransition] = useTransition();

  function submit(fn: typeof addExerciseAction, data: FormData) {
    startTransition(async () => {
      const result = await fn({}, data);
      onMessage(
        result.error ? { tone: 'bad', text: result.error } : { tone: 'ok', text: result.success ?? 'Saved.' },
      );
    });
  }

  return (
    <Card>
      <CardHeader
        title={day.label}
        subtitle={`${day.exercises.length} exercise(s) · target ${day.targetMinutes} min`}
      />
      <div className="px-5 pb-5 space-y-2">
        {day.exercises.map((ex) => (
          <ExerciseRow key={ex.id} exercise={ex} onMessage={onMessage} />
        ))}

        {adding ? (
          <div className="rounded-xl border border-[var(--border)] p-3 space-y-3">
            <Select
              value={newExerciseId}
              onChange={(e) => setNewExerciseId(e.target.value)}
              aria-label="Exercise to add"
            >
              {addOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — {o.pattern}
                </option>
              ))}
            </Select>
            <p className="text-xs text-[var(--text-muted)]">
              Only exercises your equipment, age band, experience and limitations allow are listed.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending || !newExerciseId}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('workoutDayId', day.id);
                  fd.set('exerciseId', newExerciseId);
                  fd.set('sets', '3');
                  fd.set('repsLow', '8');
                  fd.set('repsHigh', '12');
                  fd.set('restSeconds', '60');
                  submit(addExerciseAction, fd);
                  setAdding(false);
                }}
              >
                Add to {day.focus}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)} disabled={addOptions.length === 0}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add an exercise
          </Button>
        )}
      </div>
    </Card>
  );
}

function ExerciseRow({
  exercise,
  onMessage,
}: {
  exercise: PlannedExerciseView;
  onMessage: (m: { tone: 'ok' | 'bad'; text: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sets, setSets] = useState(exercise.sets);
  const [restSeconds, setRestSeconds] = useState(exercise.restSeconds);

  function act(fn: typeof replaceExerciseAction, data: FormData) {
    startTransition(async () => {
      const result = await fn({}, data);
      onMessage(
        result.error ? { tone: 'bad', text: result.error } : { tone: 'ok', text: result.success ?? 'Saved.' },
      );
    });
  }

  const dose = exercise.durationSeconds
    ? `${exercise.sets} × ${exercise.durationSeconds}s`
    : `${exercise.sets} × ${exercise.repsLow}–${exercise.repsHigh}`;

  return (
    <div className="rounded-xl border border-[var(--border)]">
      <div className="flex items-start justify-between gap-3 p-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/exercises/${exercise.exerciseId}`}
              className="font-medium text-sm hover:text-[var(--accent)]"
            >
              {exercise.name}
            </Link>
            <Badge tone="neutral">{exercise.patternLabel}</Badge>
            {exercise.substitutedFrom ? (
              <Badge tone="warn">swapped from {exercise.substitutedFrom}</Badge>
            ) : null}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{exercise.rationale}</p>
          {exercise.intensityNote ? (
            <p className="text-xs text-[var(--accent-2)] mt-1">{exercise.intensityNote}</p>
          ) : null}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold tabular-nums">{dose}</p>
          <p className="text-xs text-[var(--text-muted)]">{exercise.restSeconds}s rest</p>
        </div>
      </div>

      <div className="border-t border-[var(--border)] px-3.5 py-2 flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--surface-sunken)]"
          aria-expanded={open}
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          Edit
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const fd = new FormData();
            fd.set('plannedExerciseId', exercise.id);
            act(removeExerciseAction, fd);
          }}
          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-lg text-bad-500 hover:bg-bad-100/40"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Remove
        </button>
      </div>

      {open ? (
        <div className="border-t border-[var(--border)] p-3.5 space-y-4">
          <div>
            <p className="text-xs font-medium mb-2 inline-flex items-center gap-1.5">
              <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
              Swap for something else
            </p>
            {exercise.alternatives.length === 0 ? (
              <Notice tone="warn">
                {exercise.noAlternativeReason ??
                  'No suitable replacement is available with your current equipment.'}
              </Notice>
            ) : (
              <div className="space-y-1.5">
                {exercise.alternatives.map((alt) => (
                  <button
                    key={alt.id}
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('plannedExerciseId', exercise.id);
                      fd.set('exerciseId', alt.id);
                      fd.set('reason', alt.reason);
                      act(replaceExerciseAction, fd);
                      setOpen(false);
                    }}
                    className="w-full text-left rounded-lg border border-[var(--border)] px-3 py-2 hover:border-[var(--accent)] transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium">{alt.name}</span>
                      {!alt.samePattern ? <Badge tone="warn">partial match</Badge> : null}
                    </span>
                    <span className="block text-xs text-[var(--text-muted)] mt-0.5">{alt.reason}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-medium mb-2">Adjust the dose</p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                Sets
                <Select
                  value={sets}
                  onChange={(e) => setSets(Number(e.target.value))}
                  className="w-20 mt-1"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="text-xs">
                Rest
                <Select
                  value={restSeconds}
                  onChange={(e) => setRestSeconds(Number(e.target.value))}
                  className="w-24 mt-1"
                >
                  {[30, 45, 60, 90, 120, 150, 180].map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('plannedExerciseId', exercise.id);
                  fd.set('sets', String(sets));
                  fd.set('restSeconds', String(restSeconds));
                  if (exercise.repsLow) fd.set('repsLow', String(exercise.repsLow));
                  if (exercise.repsHigh) fd.set('repsHigh', String(exercise.repsHigh));
                  act(updateDoseAction, fd);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
