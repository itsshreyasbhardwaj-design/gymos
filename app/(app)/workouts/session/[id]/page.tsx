import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { CircleCheck, Trophy, RotateCcw } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getSession, startSession } from '@/lib/services/sessions';
import { loadPlanningProfile, getPreference } from '@/lib/services/plans';
import { activeEquipmentSet, listGymProfiles } from '@/lib/services/equipment';
import { getProfile } from '@/lib/services/account';
import { NotFoundError } from '@/lib/services/equipment';
import { EXERCISE_BY_ID } from '@/lib/content/exercises';
import { MOVEMENT_PATTERN_LABELS } from '@/lib/content/exercise-types';
import { equipmentRequirementSummary } from '@/lib/engines/equipment';
import { findSubstitutes } from '@/lib/engines/substitution';
import { buildLimitationFilter } from '@/lib/engines/programming';
import { Badge, Button, Card, CardHeader, KeyValue, LinkButton, Notice, PageHeader } from '@/components/ui';
import { GuidedMode, type GuidedExercise } from '@/components/guided-mode';
import { QuickAdapt } from '@/components/quick-adapt';
import { revertSessionAction } from '../../../actions';

export const metadata: Metadata = { title: 'Workout' };

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { done } = await searchParams;

  let session;
  try {
    session = getSession(user.id, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const profile = getProfile(user.id);
  const planning = loadPlanningProfile(user.id);
  const equipment = activeEquipmentSet(user.id);
  const gyms = listGymProfiles(user.id);
  const lim = buildLimitationFilter(planning.limitations);
  const filters = {
    availableEquipment: equipment.set,
    ageBand: planning.ageBand,
    level: planning.experience,
    excludedExerciseIds: new Set([
      ...lim.excludedExerciseIds,
      ...getPreference<string[]>(user.id, 'disliked_exercises', []),
    ]),
    excludedPatterns: lim.excludedPatterns,
  };

  /* ------------------------------------------------------------ completed */
  if (session.status === 'completed') {
    const byExercise = new Map<string, typeof session.logs>();
    for (const log of session.logs) {
      const list = byExercise.get(log.exerciseId) ?? [];
      list.push(log);
      byExercise.set(log.exerciseId, list);
    }
    const totalVolumeKg = Math.round(
      session.logs.reduce((s, l) => s + (l.reps ?? 0) * (l.weightGrams ?? 0), 0) / 1000,
    );

    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Completed"
          title={session.label}
          description={`${session.scheduledDate}${session.durationSeconds ? ` · ${Math.round(session.durationSeconds / 60)} minutes` : ''}`}
          action={
            <LinkButton href="/workouts" variant="secondary" size="sm">
              Back to workouts
            </LinkButton>
          }
        />

        {done ? (
          <Notice tone="ok" title="Session saved">
            <span className="inline-flex items-center gap-2">
              <CircleCheck className="h-4 w-4" aria-hidden="true" />
              Everything you logged is recorded. This workout is now part of your history and will
              never be rewritten by a replan.
            </span>
          </Notice>
        ) : null}

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-[var(--text-muted)]">Sets logged</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {session.logs.filter((l) => !l.skipped).length}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[var(--text-muted)]">Exercises</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">{byExercise.size}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[var(--text-muted)]">Total load</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">{totalVolumeKg} kg</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[var(--text-muted)]">Duration</p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {session.durationSeconds ? Math.round(session.durationSeconds / 60) : '—'} min
            </p>
          </Card>
        </div>

        <Card>
          <CardHeader title="What you did" />
          <div className="px-5 pb-5 space-y-3">
            {[...byExercise.entries()].map(([exerciseId, logs]) => (
              <div key={exerciseId} className="rounded-xl border border-[var(--border)] p-3.5">
                <Link
                  href={`/exercises/${exerciseId}`}
                  className="font-medium text-sm hover:text-[var(--accent)]"
                >
                  {EXERCISE_BY_ID.get(exerciseId)?.name ?? exerciseId}
                </Link>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {logs
                    .sort((a, b) => a.setIndex - b.setIndex)
                    .map((log) => (
                      <Badge key={log.setIndex} tone={log.skipped ? 'neutral' : 'brand'}>
                        {log.skipped
                          ? 'skipped'
                          : log.durationSeconds
                            ? `${log.durationSeconds}s`
                            : `${log.reps}${log.weightGrams ? ` × ${(log.weightGrams / 1000).toFixed(1)}kg` : ''}`}
                      </Badge>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {session.feedback ? (
          <Card>
            <CardHeader
              title="Your feedback"
              subtitle="This shapes your next session."
              action={<Trophy className="h-5 w-5 text-[var(--accent-2)]" aria-hidden="true" />}
            />
            <div className="px-5 pb-5">
              <KeyValue
                items={[
                  { label: 'Difficulty', value: session.feedback.difficulty?.replace(/_/g, ' ') ?? '—' },
                  { label: 'Recovery', value: session.feedback.recovery?.replace(/_/g, ' ') ?? '—' },
                  {
                    label: 'Discomfort reported',
                    value: session.feedback.discomfortReported ? 'Yes' : 'No',
                  },
                ]}
              />
              {session.feedback.discomfortReported ? (
                <Notice tone="warn" className="mt-3">
                  You reported discomfort. GymOS has reduced the volume of your next session. It
                  cannot tell you what caused it — if it continues, please see a qualified
                  professional.
                </Notice>
              ) : null}
            </div>
          </Card>
        ) : null}

        {session.notes ? (
          <Card className="p-5">
            <p className="text-sm font-medium mb-1">Your notes</p>
            <p className="text-sm text-[var(--text-muted)]">{session.notes}</p>
          </Card>
        ) : null}
      </div>
    );
  }

  /* --------------------------------------------------------- not started */
  if (session.status === 'scheduled') {
    const exercises = session.exercises;
    return (
      <div className="space-y-6">
        <PageHeader
          title={session.label}
          description={`Scheduled for ${session.scheduledDate} · ${exercises.length} exercise(s)`}
        />

        {session.source === 'adapted' ? (
          <Card className="p-4 flex flex-wrap items-center gap-3">
            <Badge tone="brand">Adapted by RealitySync</Badge>
            <p className="text-sm text-[var(--text-muted)] flex-1 min-w-48">
              This session was changed from the original plan.
            </p>
            <form action={async (fd: FormData) => {
              'use server';
              await revertSessionAction({}, fd);
            }}>
              <input type="hidden" name="sessionId" value={session.id} />
              <Button type="submit" variant="ghost" size="sm">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Revert to the plan
              </Button>
            </form>
          </Card>
        ) : null}

        <Card>
          <CardHeader title="What's planned" subtitle="Nothing is logged until you start." />
          <div className="px-5 pb-5 space-y-2">
            {exercises.map((ex, i) => {
              const seed = EXERCISE_BY_ID.get(ex.exerciseId);
              return (
                <div key={`${ex.exerciseId}-${i}`} className="rounded-xl border border-[var(--border)] p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/exercises/${ex.exerciseId}`}
                        className="font-medium text-sm hover:text-[var(--accent)]"
                      >
                        {ex.name}
                      </Link>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        {seed ? equipmentRequirementSummary(seed).join(', ') : ''}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums shrink-0">
                      {ex.durationSeconds
                        ? `${ex.sets} × ${ex.durationSeconds}s`
                        : `${ex.sets} × ${ex.repsLow}–${ex.repsHigh}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="flex flex-wrap gap-2">
          <form
            action={async () => {
              'use server';
              const u = await requireUser();
              startSession(u.id, id);
              // Without this the router can serve the cached "scheduled" view.
              revalidatePath(`/workouts/session/${id}`);
            }}
          >
            <Button type="submit" size="lg">
              Start workout
            </Button>
          </form>
          <QuickAdapt sessionId={session.id} plan={user.plan} gyms={gyms} />
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------- guided mode */
  const guided: GuidedExercise[] = session.exercises.map((ex) => {
    const seed = EXERCISE_BY_ID.get(ex.exerciseId);
    const subs = seed ? findSubstitutes(seed, filters, { limit: 5 }) : { options: [], noMatchReason: null };
    return {
      exerciseId: ex.exerciseId,
      name: ex.name,
      patternLabel: MOVEMENT_PATTERN_LABELS[ex.slotPattern] ?? ex.slotPattern,
      role: ex.role,
      sets: ex.sets,
      repsLow: ex.repsLow ?? null,
      repsHigh: ex.repsHigh ?? null,
      durationSeconds: ex.durationSeconds ?? null,
      restSeconds: ex.restSeconds,
      intensityNote: ex.intensityNote,
      loadable: seed?.loadable !== false,
      unilateral: seed?.unilateral === true,
      equipment: seed ? equipmentRequirementSummary(seed) : [],
      setup: seed?.setup ?? [],
      steps: seed?.steps ?? [],
      cues: seed?.cues ?? [],
      safety: seed?.safety ?? [],
      reviewStatus: 'draft',
      mediaStatus: 'placeholder',
      alternatives: subs.options.map((o) => ({
        id: o.exercise.id,
        name: o.exercise.name,
        reason: o.reason,
      })),
      noAlternativeReason: subs.options.length === 0 ? (subs.noMatchReason ?? null) : null,
    };
  });

  return (
    <GuidedMode
      sessionId={session.id}
      label={session.label}
      exercises={guided}
      initialLogs={session.logs.map((l) => ({
        exerciseId: l.exerciseId,
        setIndex: l.setIndex,
        reps: l.reps,
        weightGrams: l.weightGrams,
        durationSeconds: l.durationSeconds,
        skipped: l.skipped,
      }))}
      units={profile?.units ?? 'metric'}
    />
  );
}
