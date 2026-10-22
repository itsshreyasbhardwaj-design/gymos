import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listSessions, materialiseWeek } from '@/lib/services/sessions';
import { getActiveMealPlan } from '@/lib/services/nutrition';
import { getActivePlan, loadPlanningProfile } from '@/lib/services/plans';
import { listActivities } from '@/lib/services/progress';
import { addDays, mondayOf } from '@/lib/engines/nutrition';
import { DAY_NAMES } from '@/lib/engines/workout-templates';
import { Badge, Button, Card, CardHeader, Notice, PageHeader } from '@/components/ui';
import { RescheduleControls } from '@/components/calendar-controls';
import { materialiseWeekFormAction } from '../actions';

export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const plan = getActivePlan(user.id);
  if (plan) materialiseWeek(user.id);

  const today = new Date().toISOString().slice(0, 10);
  const weekStart = params.week ?? mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const sessions = listSessions(user.id, { from: weekStart, to: weekEnd });
  const mealPlan = getActiveMealPlan(user.id);
  const activities = listActivities(user.id, 60).filter(
    (a) => a.date >= weekStart && a.date <= weekEnd,
  );
  const profile = loadPlanningProfile(user.id);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    return {
      date,
      dayName: DAY_NAMES[dow] ?? '',
      isToday: date === today,
      isPast: date < today,
      sessions: sessions.filter((s) => s.scheduledDate === date),
      meals: mealPlan?.meals.filter((m) => m.date === date) ?? [],
      activities: activities.filter((a) => a.date === date),
      isTrainingDay: profile.trainingDays.includes(dow),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description={`Week of ${weekStart}. Workouts, meals and activity in one place.`}
        action={
          <div className="flex gap-2">
            <Link href={`/calendar?week=${addDays(weekStart, -7)}`}>
              <Button variant="secondary" size="sm">
                Previous
              </Button>
            </Link>
            <Link href={`/calendar?week=${addDays(weekStart, 7)}`}>
              <Button variant="secondary" size="sm">
                Next
              </Button>
            </Link>
          </div>
        }
      />

      {sessions.length === 0 && plan ? (
        <Card className="p-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-[var(--text-muted)] flex-1 min-w-48">
            Nothing is scheduled for this week yet.
          </p>
          <form action={materialiseWeekFormAction}>
            <Button type="submit" size="sm">
              Schedule from my plan
            </Button>
          </form>
        </Card>
      ) : null}

      <div className="space-y-3">
        {days.map((day) => (
          <Card
            key={day.date}
            className={day.isToday ? 'border-[var(--accent)]' : undefined}
          >
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {day.dayName}
                  <span className="text-sm font-normal text-[var(--text-muted)]">
                    {day.date.slice(5)}
                  </span>
                  {day.isToday ? <Badge tone="brand">Today</Badge> : null}
                </span>
              }
              subtitle={
                day.sessions.length === 0 && day.isTrainingDay
                  ? 'Training day with nothing scheduled'
                  : day.sessions.length === 0
                    ? 'Rest or light activity'
                    : undefined
              }
            />
            <div className="px-5 pb-5 space-y-2">
              {day.sessions.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl border border-[var(--border)] p-3.5 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/workouts/session/${s.id}`}
                      className="font-medium text-sm hover:text-[var(--accent)] min-w-0"
                    >
                      {s.label}
                    </Link>
                    <Badge
                      tone={
                        s.status === 'completed'
                          ? 'ok'
                          : s.status === 'skipped'
                            ? 'neutral'
                            : s.status === 'in_progress'
                              ? 'brand'
                              : 'neutral'
                      }
                    >
                      {s.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  {s.status === 'scheduled' || s.status === 'in_progress' ? (
                    <RescheduleControls
                      sessionId={s.id}
                      currentDate={s.scheduledDate}
                      weekDates={days.map((d) => d.date)}
                    />
                  ) : null}
                </div>
              ))}

              {day.meals.length > 0 ? (
                <div className="rounded-xl bg-[var(--surface-sunken)] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
                    Meals
                  </p>
                  <ul className="space-y-1">
                    {day.meals.map((m) => (
                      <li key={m.id} className="text-sm flex items-center justify-between gap-2">
                        <Link
                          href={`/nutrition/recipes/${m.recipeId}`}
                          className="hover:text-[var(--accent)] min-w-0 truncate"
                        >
                          <span className="text-[var(--text-muted)] text-xs uppercase mr-2">
                            {m.slot}
                          </span>
                          {m.recipeName}
                        </Link>
                        {m.status === 'cooked' ? <Badge tone="ok">cooked</Badge> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {day.activities.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {day.activities.map((a) => (
                    <Badge key={a.id} tone="teal">
                      {a.kind} {a.minutes ? `${a.minutes} min` : ''}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      <Notice tone="neutral">
        Rest days are part of the plan, not a gap in it. Moving an upcoming session never changes
        anything you have already completed, and nothing is added elsewhere to make up for a skipped
        day.
      </Notice>
    </div>
  );
}
