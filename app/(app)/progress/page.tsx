import type { Metadata } from 'next';
import Link from 'next/link';
import { Trophy, Activity } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { progressOverview, listActivities, loggedExerciseIds, exerciseHistory } from '@/lib/services/progress';
import { getConsent } from '@/lib/services/account';
import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader, Stat } from '@/components/ui';
import { ProgressCharts } from '@/components/progress-charts';
import { ActivityForm, ActivityList } from '@/components/activity-forms';

export const metadata: Metadata = { title: 'Progress' };

export default async function ProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ exercise?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const overview = progressOverview(user.id, user.plan, 8);
  const activities = listActivities(user.id, 20);
  const exercises = loggedExerciseIds(user.id).slice(0, 25);
  const selected = params.exercise ?? exercises[0]?.exerciseId;
  const trend = selected ? exerciseHistory(user.id, selected, user.plan) : null;
  const biometricsOn = getConsent(user.id, 'biometrics');

  const hasData = overview.totals.setsLogged > 0 || overview.totals.activityMinutes > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Progress"
        description="Everything here comes from sets and activities you logged. Nothing is predicted or estimated."
      />

      {overview.windowLimited ? (
        <Notice tone="neutral">
          Your free plan charts the last 30 days (from {overview.windowStart}). Nothing older is
          deleted — GymOS Pro simply shows all of it.
        </Notice>
      ) : null}

      {!hasData ? (
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          title="Nothing logged yet"
          description="Complete a workout or record an activity and your charts will fill in."
          action={<LinkButton href="/workouts">Go to workouts</LinkButton>}
        />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Sessions completed" value={overview.totals.sessionsCompleted} tone="brand" />
            <Stat label="Sets logged" value={overview.totals.setsLogged} />
            <Stat label="Different exercises" value={overview.totals.distinctExercises} />
            <Stat
              label="Total load moved"
              value={`${overview.totals.volumeKg.toLocaleString('en-IN')} kg`}
              hint="only sets where you recorded a weight"
              tone="teal"
            />
          </div>

          <Card>
            <CardHeader title="Consistency" subtitle={overview.consistencyNote} />
            <div className="px-5 pb-5">
              <ProgressCharts
                weeks={overview.weeks}
                muscleBalance={overview.muscleBalance}
                trend={
                  trend
                    ? { name: trend.exerciseName, points: trend.points }
                    : null
                }
              />
            </div>
          </Card>

          {exercises.length > 0 ? (
            <Card>
              <CardHeader title="Exercise trend" subtitle="Pick an exercise you have logged." />
              <div className="px-5 pb-5 flex flex-wrap gap-1.5">
                {exercises.map((ex) => (
                  <Link
                    key={ex.exerciseId}
                    href={`/progress?exercise=${ex.exerciseId}`}
                    className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${ex.exerciseId === selected ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-sunken)] hover:bg-[var(--border)]'}`}
                  >
                    {ex.name} ({ex.sets})
                  </Link>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      )}

      <Card>
        <CardHeader
          title="Milestones"
          subtitle="Your own bests — never compared with anyone else."
          action={<Trophy className="h-5 w-5 text-[var(--accent-2)]" aria-hidden="true" />}
        />
        <div className="px-5 pb-5 space-y-1.5">
          {overview.milestones.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Milestones appear as you log sets — first time doing a movement, most reps, heaviest
              set, longest hold.
            </p>
          ) : (
            overview.milestones.map((m, i) => (
              <div
                key={`${m.exerciseId}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm"
              >
                <span>{m.label}</span>
                <span className="text-xs text-[var(--text-muted)] shrink-0">
                  {m.achievedAt.slice(0, 10)}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Other activity"
          subtitle="Walks, rides, sport — movement that is not a logged workout still counts."
        />
        <div className="px-5 pb-5 space-y-4">
          <ActivityForm />
          <ActivityList
            items={activities.map((a) => ({
              id: a.id,
              kind: a.kind,
              date: a.date,
              minutes: a.minutes,
              distanceMeters: a.distanceMeters,
              steps: a.steps,
              notes: a.notes,
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Meal planning"
          subtitle="Tracked as organisation, never as a score."
        />
        <div className="px-5 pb-5 grid gap-3 grid-cols-2">
          <Stat label="Meals planned" value={overview.mealsPlanned} />
          <Stat label="Meals cooked" value={overview.mealsCooked} />
        </div>
      </Card>

      <Notice tone="neutral" title="What GymOS will not show you">
        No body-composition estimates, no predicted one-rep maxes, no comparison against other
        people, and no scoring of how you look. Adherence is reported as plain information, not as
        a streak you can break.{' '}
        {biometricsOn
          ? 'Optional biometric records are switched on for your account; you can withdraw that in Settings → Privacy at any time, which also deletes them.'
          : 'Optional biometric records are switched off for your account.'}
      </Notice>
    </div>
  );
}
