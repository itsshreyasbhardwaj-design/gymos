'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dumbbell, Clock, Info, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, Notice, Select, Skeleton } from '@/components/ui';
import { cn } from '@/lib/ui/cn';

interface PreviewExercise {
  name: string;
  exerciseId: string;
  pattern: string;
  role: string;
  sets: number;
  repsLow: number | null;
  repsHigh: number | null;
  durationSeconds: number | null;
  restSeconds: number;
  rationale: string;
}

interface PreviewDay {
  label: string;
  focusLabel: string;
  estimatedMinutes: number;
  targetMinutes: number;
  gaps: { pattern: string; needed: string }[];
  exercises: PreviewExercise[];
}

interface PreviewResponse {
  splitKind: string;
  equipmentCount: number;
  explanation: string[];
  warnings: string[];
  days: PreviewDay[];
}

const PRESETS = [
  { id: 'bodyweight_home', label: 'Bodyweight at home' },
  { id: 'minimal_home', label: 'Dumbbells and bands' },
  { id: 'garage_gym', label: 'Home / garage gym' },
  { id: 'apartment_gym', label: 'Apartment gym' },
  { id: 'commercial_gym', label: 'Full commercial gym' },
  { id: 'travel', label: 'Hotel room / travel' },
  { id: 'outdoor', label: 'Park / outdoors' },
];

export function PlanPreview() {
  const router = useRouter();
  const [preset, setPreset] = useState('minimal_home');
  const [minutes, setMinutes] = useState(45);
  const [experience, setExperience] = useState('some');
  const [days, setDays] = useState(3);
  const [result, setResult] = useState<{ key: string; data: PreviewResponse | null; error: string | null }>(
    { key: '', data: null, error: null },
  );
  const [dayIndex, setDayIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  const requestKey = `${preset}|${minutes}|${experience}|${days}`;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/preview/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset, minutes, experience, days, interests: ['general_fitness'] }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Preview unavailable');
        return (await res.json()) as PreviewResponse;
      })
      .then((json) => {
        if (!cancelled) setResult({ key: requestKey, data: json, error: null });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({
            key: requestKey,
            data: null,
            error: 'The preview could not load. The planner itself is unaffected.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [preset, minutes, experience, days, requestKey]);

  // Derived rather than stored: no loading flag to keep in sync inside an effect.
  const fresh = result.key === requestKey;
  const data = fresh ? result.data : null;
  const error = fresh ? result.error : null;
  const loading = !fresh;
  const day = data?.days[Math.min(dayIndex, Math.max(0, (data?.days.length ?? 1) - 1))];

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--border)] bg-[var(--surface-sunken)] p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-4">
          <Badge tone="teal">Example output</Badge>
          <span className="text-xs text-[var(--text-muted)]">
            Generated live by the real GymOS planner. Nothing is saved.
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">What you have</span>
            <Select
              value={preset}
              onChange={(e) => startTransition(() => setPreset(e.target.value))}
              className="mt-1"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">Time per session</span>
            <Select
              value={minutes}
              onChange={(e) => startTransition(() => setMinutes(Number(e.target.value)))}
              className="mt-1"
            >
              {[20, 30, 45, 60, 75].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">Experience</span>
            <Select
              value={experience}
              onChange={(e) => startTransition(() => setExperience(e.target.value))}
              className="mt-1"
            >
              <option value="new">New to exercise</option>
              <option value="some">Some experience</option>
              <option value="regular">Regularly active</option>
              <option value="experienced">Experienced</option>
            </Select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--text-muted)]">Days a week</span>
            <Select
              value={days}
              onChange={(e) => startTransition(() => setDays(Number(e.target.value)))}
              className="mt-1"
            >
              {[1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {d} {d === 1 ? 'day' : 'days'}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {error ? <Notice tone="warn">{error}</Notice> : null}

        {loading || pending ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-9 w-48" />
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : data && day ? (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {data.days.map((d, i) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setDayIndex(i)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm transition-colors',
                    i === dayIndex
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--surface-sunken)] hover:bg-[var(--border)]',
                  )}
                >
                  {d.focusLabel}
                </button>
              ))}
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                about {day.estimatedMinutes} min
              </span>
            </div>

            <ol className="space-y-2 fade-up">
              {day.exercises.map((ex, i) => (
                <li
                  key={`${ex.exerciseId}-${i}`}
                  className="rounded-xl border border-[var(--border)] p-3 sm:p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-tight">{ex.name}</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{ex.rationale}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold tabular-nums">
                        {ex.durationSeconds
                          ? `${ex.sets} × ${ex.durationSeconds}s`
                          : `${ex.sets} × ${ex.repsLow}–${ex.repsHigh}`}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">{ex.restSeconds}s rest</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>

            {day.gaps.length > 0 ? (
              <Notice tone="warn" className="mt-4">
                <span className="inline-flex items-start gap-2">
                  <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>
                      {day.gaps.length} movement pattern
                      {day.gaps.length === 1 ? '' : 's'} could not be filled
                    </strong>{' '}
                    with this equipment ({day.gaps.map((g) => g.pattern.replace(/_/g, ' ')).join(', ')}).
                    GymOS leaves the slot out rather than pretending a bodyweight move is an equal
                    replacement. Unlocking it needs {day.gaps[0]?.needed}.
                  </span>
                </span>
              </Notice>
            ) : null}

            <details className="mt-4 group">
              <summary className="cursor-pointer text-sm font-medium inline-flex items-center gap-1.5">
                <Info className="h-4 w-4" aria-hidden="true" />
                Why this plan?
              </summary>
              <ul className="mt-2 space-y-1.5 text-sm text-[var(--text-muted)] leading-relaxed">
                {data.explanation.map((line, i) => (
                  <li key={i}>• {line}</li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
      </div>

      <div className="border-t border-[var(--border)] p-4 sm:p-5 flex flex-wrap items-center gap-3">
        <Dumbbell className="h-5 w-5 text-[var(--accent-2)]" aria-hidden="true" />
        <p className="text-sm text-[var(--text-muted)] flex-1 min-w-48">
          Signed in, you pick your exact equipment item by item — not a preset — and the plan is
          saved, editable and adapts when things change.
        </p>
        <Button onClick={() => router.push('/signup')}>Build my fitness plan</Button>
      </div>
    </Card>
  );
}
