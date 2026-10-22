'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Play,
  Pause,
  RotateCcw,
  ArrowLeftRight,
  TriangleAlert,
  X,
  Timer,
  BookOpen,
} from 'lucide-react';
import { Badge, Button, Card, Notice, Select, Textarea } from '@/components/ui';
import {
  logSetAction,
  deleteSetAction,
  completeSessionAction,
  substituteInSessionAction,
} from '@/app/(app)/actions';
import { cn } from '@/lib/ui/cn';

export interface GuidedExercise {
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
  loadable: boolean;
  unilateral: boolean;
  equipment: string[];
  setup: string[];
  steps: string[];
  cues: string[];
  safety: string[];
  reviewStatus: string;
  mediaStatus: string;
  alternatives: { id: string; name: string; reason: string }[];
  noAlternativeReason: string | null;
}

export interface LoggedSet {
  exerciseId: string;
  setIndex: number;
  reps: number | null;
  weightGrams: number | null;
  durationSeconds: number | null;
  skipped: boolean;
}

/**
 * GuidedMode: one exercise at a time, large controls, and every set written to the
 * server as it happens so a refresh or a dead battery never loses a session.
 */
export function GuidedMode({
  sessionId,
  label,
  exercises,
  initialLogs,
  units,
}: {
  sessionId: string;
  label: string;
  exercises: GuidedExercise[];
  initialLogs: LoggedSet[];
  units: 'metric' | 'imperial';
}) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [logs, setLogs] = useState<LoggedSet[]>(initialLogs);
  const [error, setError] = useState<string | null>(null);
  const [showFinish, setShowFinish] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);
  const restSeconds = restUntil == null ? null : Math.max(0, Math.ceil((restUntil - now) / 1000));
  const [pending, startTransition] = useTransition();
  /*
   * Assigned once on mount. Both are impure values, so they are produced in an effect
   * rather than during render, and read only from callbacks.
   */
  const startedAt = useRef<number | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  useEffect(() => {
    if (startedAt.current == null) startedAt.current = Date.now();
    if (idempotencyKey.current == null) {
      idempotencyKey.current = `${sessionId}:${Math.random().toString(36).slice(2)}:${Date.now()}`;
    }
  }, [sessionId]);
  const elapsedSeconds = useCallback(
    () => Math.round((Date.now() - (startedAt.current ?? Date.now())) / 1000),
    [],
  );
  const getIdempotencyKey = useCallback(() => idempotencyKey.current ?? sessionId, [sessionId]);

  const current = exercises[index];
  const loggedForCurrent = useMemo(
    () => logs.filter((l) => l.exerciseId === current?.exerciseId).sort((a, b) => a.setIndex - b.setIndex),
    [logs, current],
  );
  const nextSetIndex = loggedForCurrent.length + 1;
  const totalPlanned = exercises.reduce((sum, e) => sum + e.sets, 0);
  const totalLogged = logs.filter((l) => !l.skipped).length;

  // ---------------------------------------------------------------- rest timer
  useEffect(() => {
    if (restUntil == null) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current >= restUntil) setRestUntil(null);
    };
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [restUntil]);

  const weightToGrams = useCallback(
    (value: string): number | null => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      return units === 'imperial' ? Math.round(n * 453.592) : Math.round(n * 1000);
    },
    [units],
  );

  const gramsToDisplay = useCallback(
    (grams: number | null): string => {
      if (grams == null) return '';
      return units === 'imperial'
        ? `${(grams / 453.592).toFixed(1)} lb`
        : `${(grams / 1000).toFixed(1)} kg`;
    },
    [units],
  );

  function logCurrentSet(values: { reps: number; weight: string; holdSeconds: number }, skipped = false) {
    if (!current) return;
    const payload = {
      sessionId,
      exerciseId: current.exerciseId,
      setIndex: nextSetIndex,
      reps: current.durationSeconds ? null : values.reps,
      weightGrams: current.durationSeconds ? null : weightToGrams(values.weight),
      durationSeconds: current.durationSeconds ? values.holdSeconds : null,
      skipped,
    };
    // Optimistic: the server call is idempotent on (session, exercise, set).
    setLogs((prev) => [...prev.filter((l) => !(l.exerciseId === payload.exerciseId && l.setIndex === payload.setIndex)), payload]);
    if (!skipped && current.restSeconds > 0) {
      const until = Date.now() + current.restSeconds * 1000;
      setNow(Date.now());
      setRestUntil(until);
    }
    startTransition(async () => {
      const result = await logSetAction(payload);
      if (result.error) {
        setError(result.error);
        setLogs((prev) =>
          prev.filter((l) => !(l.exerciseId === payload.exerciseId && l.setIndex === payload.setIndex)),
        );
      } else {
        setError(null);
      }
    });
  }

  function undoLastSet() {
    const last = loggedForCurrent[loggedForCurrent.length - 1];
    if (!last || !current) return;
    setLogs((prev) => prev.filter((l) => !(l.exerciseId === last.exerciseId && l.setIndex === last.setIndex)));
    startTransition(async () => {
      await deleteSetAction(sessionId, current.exerciseId, last.setIndex);
    });
  }

  function swapExercise(toExerciseId: string, reason: string) {
    if (!current) return;
    startTransition(async () => {
      const result = await substituteInSessionAction({
        sessionId,
        fromExerciseId: current.exerciseId,
        toExerciseId,
        reason,
      });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  if (!current) {
    return (
      <Card className="p-6 text-center">
        <p className="font-medium">This session has no exercises.</p>
        <Link href="/workouts" className="text-sm text-[var(--accent)] mt-2 inline-block">
          Back to workouts
        </Link>
      </Card>
    );
  }

  if (showFinish) {
    return (
      <FinishPanel
        sessionId={sessionId}
        totalLogged={totalLogged}
        totalPlanned={totalPlanned}
        getElapsedSeconds={elapsedSeconds}
        getIdempotencyKey={getIdempotencyKey}
        onCancel={() => setShowFinish(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
          <p className="text-sm font-medium">
            Exercise {index + 1} of {exercises.length}
          </p>
        </div>
        <Link
          href="/workouts"
          className="h-10 w-10 grid place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
          title="Leave — your logged sets are already saved"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Leave the workout</span>
        </Link>
      </div>

      <div className="h-1.5 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
        <div
          className="h-full bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${totalPlanned > 0 ? (totalLogged / totalPlanned) * 100 : 0}%` }}
        />
      </div>

      {error ? (
        <Notice tone="bad">
          {error} Your earlier sets are still saved.
        </Notice>
      ) : null}

      {/* ------------------------------------------------------- rest timer */}
      {restSeconds != null ? (
        <Card className="p-4 border-[var(--accent)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Timer className="h-6 w-6 text-[var(--accent)]" aria-hidden="true" />
              <div>
                <p className="text-xs text-[var(--text-muted)]">Rest</p>
                <p className="text-3xl font-semibold tabular-nums" aria-live="polite">
                  {Math.floor(restSeconds / 60)}:{String(restSeconds % 60).padStart(2, '0')}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRestUntil((t) => (t == null ? null : t + 30_000))}
              >
                +30s
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRestUntil(null)}>
                Skip
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {/* -------------------------------------------------- current exercise */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-tight">{current.name}</h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <Badge tone="neutral">{current.patternLabel}</Badge>
              {current.unilateral ? <Badge tone="neutral">each side</Badge> : null}
              {current.equipment.map((e) => (
                <Badge key={e} tone="teal">
                  {e}
                </Badge>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm text-[var(--text-muted)]">Target</p>
            <p className="text-lg font-semibold tabular-nums">
              {current.durationSeconds
                ? `${current.sets} × ${current.durationSeconds}s`
                : `${current.sets} × ${current.repsLow}–${current.repsHigh}`}
            </p>
          </div>
        </div>

        {current.intensityNote ? (
          <p className="text-sm text-[var(--accent-2)] mt-3">{current.intensityNote}</p>
        ) : null}

        <div className="flex flex-wrap gap-1.5 mt-3">
          <Button variant="ghost" size="sm" onClick={() => setShowInstructions((v) => !v)}>
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            {showInstructions ? 'Hide' : 'How to do it'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowSwap((v) => !v)}>
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            Swap
          </Button>
        </div>

        {showInstructions ? (
          <div className="mt-3 rounded-xl bg-[var(--surface-sunken)] p-4 space-y-3 text-sm leading-relaxed">
            <div>
              <p className="font-medium text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">
                Set-up
              </p>
              <p>{current.setup.join(' ')}</p>
            </div>
            <div>
              <p className="font-medium text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">
                Movement
              </p>
              <ol className="list-decimal pl-5 space-y-1">
                {current.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
            {current.cues.length > 0 ? (
              <div>
                <p className="font-medium text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">
                  Cues
                </p>
                <p>{current.cues.join(' ')}</p>
              </div>
            ) : null}
            {current.safety.length > 0 ? (
              <Notice tone="warn">{current.safety.join(' ')}</Notice>
            ) : null}
            <p className="text-xs text-[var(--text-muted)]">
              {current.mediaStatus === 'placeholder'
                ? 'No demonstration video is available for this exercise. GymOS does not ship licensed media, and will not imply a demonstration exists.'
                : null}{' '}
              {current.reviewStatus === 'draft'
                ? 'These instructions are an internal draft awaiting professional review.'
                : null}
            </p>
          </div>
        ) : null}

        {showSwap ? (
          <div className="mt-3 space-y-2">
            {current.alternatives.length === 0 ? (
              <Notice tone="warn">
                {current.noAlternativeReason ?? 'No suitable replacement is available right now.'}
              </Notice>
            ) : (
              current.alternatives.map((alt) => (
                <button
                  key={alt.id}
                  type="button"
                  disabled={pending}
                  onClick={() => swapExercise(alt.id, alt.reason)}
                  className="w-full text-left rounded-xl border border-[var(--border)] px-3.5 py-3 hover:border-[var(--accent)] transition-colors"
                >
                  <span className="block font-medium text-sm">{alt.name}</span>
                  <span className="block text-xs text-[var(--text-muted)] mt-0.5">{alt.reason}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </Card>

      {/* ---------------------------------------------------------- set list */}
      <Card className="p-5">
        <p className="text-sm font-medium mb-3">
          Sets logged: {loggedForCurrent.filter((l) => !l.skipped).length} of {current.sets}
        </p>
        <div className="space-y-1.5 mb-4">
          {Array.from({ length: Math.max(current.sets, loggedForCurrent.length) }, (_, i) => {
            const setIndex = i + 1;
            const log = loggedForCurrent.find((l) => l.setIndex === setIndex);
            return (
              <div
                key={setIndex}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm',
                  log
                    ? log.skipped
                      ? 'bg-[var(--surface-sunken)] text-[var(--text-muted)]'
                      : 'bg-[var(--accent-soft)]'
                    : 'border border-dashed border-[var(--border)]',
                )}
              >
                <span className="font-medium">Set {setIndex}</span>
                <span className="tabular-nums">
                  {log ? (
                    log.skipped ? (
                      'skipped'
                    ) : (
                      <>
                        {log.durationSeconds ? `${log.durationSeconds}s` : `${log.reps} reps`}
                        {log.weightGrams ? ` · ${gramsToDisplay(log.weightGrams)}` : ''}
                      </>
                    )
                  ) : (
                    <span className="text-[var(--text-muted)]">not logged</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {/* ------------------------------------------------------- log input */}
        {/*
          Keyed by exercise so React resets the inputs when the exercise changes,
          instead of synchronising them inside an effect.
        */}
        <SetLogger
          key={current.exerciseId}
          exercise={current}
          units={units}
          setIndex={nextSetIndex}
          pending={pending}
          canUndo={loggedForCurrent.length > 0}
          onLog={(values) => logCurrentSet(values, false)}
          onSkip={(values) => logCurrentSet(values, true)}
          onUndo={undoLastSet}
        />
      </Card>

      {/* -------------------------------------------------------- navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          size="lg"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Previous</span>
        </Button>
        {index < exercises.length - 1 ? (
          <Button
            className="flex-1"
            size="lg"
            onClick={() => {
              setIndex((i) => i + 1);
              setRestUntil(null);
            }}
          >
            Next exercise
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </Button>
        ) : (
          <Button className="flex-1" size="lg" onClick={() => setShowFinish(true)}>
            Finish workout
            <Check className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {index < exercises.length - 1 ? (
        <Button variant="ghost" className="w-full" onClick={() => setShowFinish(true)}>
          Finish early — what you logged still counts
        </Button>
      ) : null}

      <p className="text-xs text-[var(--text-muted)] text-center">
        Every set is saved as you log it. You can close this page and come back.
      </p>
    </div>
  );
}

function SetLogger({
  exercise,
  units,
  setIndex,
  pending,
  canUndo,
  onLog,
  onSkip,
  onUndo,
}: {
  exercise: GuidedExercise;
  units: 'metric' | 'imperial';
  setIndex: number;
  pending: boolean;
  canUndo: boolean;
  onLog: (values: { reps: number; weight: string; holdSeconds: number }) => void;
  onSkip: (values: { reps: number; weight: string; holdSeconds: number }) => void;
  onUndo: () => void;
}) {
  const [reps, setReps] = useState(exercise.repsLow ?? 10);
  // Weight carries across sets of the same exercise, which is why this lives here.
  const [weight, setWeight] = useState('');
  const [holdSeconds, setHoldSeconds] = useState(exercise.durationSeconds ?? 30);
  const values = { reps, weight, holdSeconds };

  return (
    <div className="space-y-3">
      {exercise.durationSeconds ? (
        <HoldInput value={holdSeconds} onChange={setHoldSeconds} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Stepper label="Reps" value={reps} onChange={setReps} min={1} max={100} />
          {exercise.loadable ? (
            <label className="block">
              <span className="text-xs font-medium text-[var(--text-muted)]">
                Weight ({units === 'imperial' ? 'lb' : 'kg'}) — optional
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                min="0"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                className="w-full mt-1 h-14 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-xl font-semibold tabular-nums text-center outline-none focus:border-[var(--accent)]"
                placeholder="—"
              />
            </label>
          ) : null}
        </div>
      )}

      <Button size="xl" className="w-full" onClick={() => onLog(values)} disabled={pending}>
        <Check className="h-5 w-5" aria-hidden="true" />
        Log set {setIndex}
      </Button>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => onSkip(values)} disabled={pending}>
          Skip this set
        </Button>
        <Button variant="ghost" onClick={onUndo} disabled={pending || !canUndo}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Undo
        </Button>
      </div>
    </div>
  );
}

function Stepper({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div>
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <div className="flex items-stretch gap-1 mt-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="h-14 w-12 grid place-items-center rounded-xl border border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="h-5 w-5" aria-hidden="true" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
          className="flex-1 h-14 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-xl font-semibold tabular-nums text-center outline-none focus:border-[var(--accent)]"
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="h-14 w-12 grid place-items-center rounded-xl border border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]"
          aria-label={`Increase ${label}`}
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function HoldInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-[var(--text-muted)]">Hold time (seconds)</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={5}
          max={600}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-14 rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] text-xl font-semibold tabular-nums text-center outline-none focus:border-[var(--accent)]"
          aria-label="Hold time in seconds"
        />
        <Button
          variant="secondary"
          className="h-14"
          onClick={() => {
            if (running) {
              setRunning(false);
              onChange(elapsed || value);
            } else {
              setElapsed(0);
              setRunning(true);
            }
          }}
        >
          {running ? <Pause className="h-5 w-5" aria-hidden="true" /> : <Play className="h-5 w-5" aria-hidden="true" />}
          {running ? `${elapsed}s` : 'Time it'}
        </Button>
      </div>
    </div>
  );
}

function FinishPanel({
  sessionId,
  totalLogged,
  totalPlanned,
  getElapsedSeconds,
  getIdempotencyKey,
  onCancel,
}: {
  sessionId: string;
  totalLogged: number;
  totalPlanned: number;
  getElapsedSeconds: () => number;
  getIdempotencyKey: () => string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [difficulty, setDifficulty] = useState<'too_easy' | 'about_right' | 'hard' | 'too_hard'>('about_right');
  const [recovery, setRecovery] = useState<'fresh' | 'ok' | 'tired' | 'very_tired'>('ok');
  const [discomfort, setDiscomfort] = useState(false);
  const [discomfortNote, setDiscomfortNote] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish() {
    startTransition(async () => {
      const result = await completeSessionAction({
        sessionId,
        durationSeconds: getElapsedSeconds(),
        notes,
        difficulty,
        recovery,
        discomfortReported: discomfort,
        discomfortNote,
        idempotencyKey: getIdempotencyKey(),
      });
      if (result.error) setError(result.error);
      else router.push(`/workouts/session/${sessionId}?done=1`);
    });
  }

  return (
    <Card className="p-5 space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Finish this workout</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {totalLogged} of {totalPlanned} planned sets logged. However much that is, it counts.
        </p>
      </div>

      {error ? <Notice tone="bad">{error}</Notice> : null}

      <div>
        <p className="text-sm font-medium mb-2">How did that feel?</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['too_easy', 'Too easy'],
              ['about_right', 'About right'],
              ['hard', 'Hard but OK'],
              ['too_hard', 'Too hard'],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              onClick={() => setDifficulty(value)}
              className={cn(
                'rounded-xl border px-3 py-3 text-sm transition-colors',
                difficulty === value
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'border-[var(--border)] hover:border-[var(--border-strong)]',
              )}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">How recovered did you feel going in?</p>
        <Select value={recovery} onChange={(e) => setRecovery(e.target.value as never)}>
          <option value="fresh">Fresh</option>
          <option value="ok">Okay</option>
          <option value="tired">Tired</option>
          <option value="very_tired">Very tired</option>
        </Select>
      </div>

      <div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={discomfort}
            onChange={(e) => setDiscomfort(e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-[var(--accent)]"
          />
          <span>
            <span className="font-medium">Something felt uncomfortable or painful</span>
            <span className="block text-[var(--text-muted)] mt-0.5">
              GymOS will ease off your next session. It cannot tell you what caused it.
            </span>
          </span>
        </label>
        {discomfort ? (
          <>
            <Textarea
              className="mt-2"
              rows={2}
              placeholder="Where, and during which exercise? (optional)"
              value={discomfortNote}
              onChange={(e) => setDiscomfortNote(e.target.value)}
              maxLength={500}
            />
            <Notice tone="warn" className="mt-2">
              <span className="inline-flex items-start gap-2">
                <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                Do not train through pain. If it continues, please see a doctor or physiotherapist.
                GymOS cannot diagnose anything.
              </span>
            </Notice>
          </>
        ) : null}
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Notes (optional)</p>
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          placeholder="Anything worth remembering next time."
        />
      </div>

      <div className="flex gap-2">
        <Button size="lg" className="flex-1" onClick={finish} disabled={pending}>
          {pending ? 'Saving…' : 'Save and finish'}
        </Button>
        <Button size="lg" variant="ghost" onClick={onCancel} disabled={pending}>
          Keep going
        </Button>
      </div>
    </Card>
  );
}
