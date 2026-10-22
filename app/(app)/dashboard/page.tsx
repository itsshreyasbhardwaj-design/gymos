import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Dumbbell,
  Clock,
  UtensilsCrossed,
  CalendarClock,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getProfile, listNotifications } from '@/lib/services/account';
import {
  todaySession,
  nextSession,
  missedSessions,
  listSessions,
  materialiseWeek,
} from '@/lib/services/sessions';
import { getActivePlan } from '@/lib/services/plans';
import { getActiveMealPlan } from '@/lib/services/nutrition';
import { activeEquipmentSet, listGymProfiles } from '@/lib/services/equipment';
import { progressOverview } from '@/lib/services/progress';
import { mondayOf, addDays } from '@/lib/engines/nutrition';
import { DAY_SHORT } from '@/lib/engines/workout-templates';
import { describeConsistency } from '@/lib/engines/progress';
import {
  Badge,
  BulletList,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Notice,
  PageHeader,
  Stat,
} from '@/components/ui';
import { QuickAdapt } from '@/components/quick-adapt';
import { regeneratePlanFormAction } from '../actions';

export const metadata: Metadata = { title: 'Today' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const profile = getProfile(user.id);
  const plan = getActivePlan(user.id);

  // Keep the current week scheduled without the user having to ask.
  if (plan) materialiseWeek(user.id);

  const today = new Date().toISOString().slice(0, 10);
  const monday = mondayOf(today);
  const current = todaySession(user.id, today);
  const upcoming = current ? null : nextSession(user.id);
  const missed = missedSessions(user.id);
  const week = listSessions(user.id, { from: monday, to: addDays(monday, 6) });
  const mealPlan = getActiveMealPlan(user.id);
  const todaysMeals = mealPlan?.meals.filter((m) => m.date === today) ?? [];
  const equipment = activeEquipmentSet(user.id);
  const gyms = listGymProfiles(user.id);
  const overview = progressOverview(user.id, user.plan, 4);
  const notifications = listNotifications(user.id, 5).filter((n) => !n.readAt);

  const completedThisWeek = week.filter((s) => s.status === 'completed').length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={profile?.ageBand === 'adult_18_plus' ? undefined : 'Age-appropriate mode'}
        title={`${greeting}, ${profile?.displayName?.split(' ')[0] ?? 'there'}`}
        description={
          equipment.profileName
            ? `Training at ${equipment.profileName} — ${equipment.set.size - 1} item(s) available.`
            : 'No equipment profile yet.'
        }
        action={
          gyms.length > 1 ? (
            <LinkButton href="/equipment" variant="secondary" size="sm">
              Switch location
            </LinkButton>
          ) : null
        }
      />

      {params.welcome ? (
        <Notice tone="teal" title="Your plan is ready">
          Everything here is editable. Swap an exercise, change your days, or regenerate the whole
          plan — nothing you log is ever overwritten.
        </Notice>
      ) : null}

      {notifications.map((n) => (
        <Notice key={n.id} tone="warn" title={n.title}>
          {n.body}
        </Notice>
      ))}

      {/* ---------------------------------------------------------- today */}
      {current ? (
        <Card>
          <CardHeader
            title={current.label}
            subtitle={
              current.status === 'completed'
                ? 'Completed today. Well done.'
                : current.status === 'in_progress'
                  ? 'In progress — pick up where you left off.'
                  : "Today's session"
            }
            action={
              <Badge tone={current.status === 'completed' ? 'ok' : 'brand'}>
                {current.status === 'completed'
                  ? 'Done'
                  : current.status === 'in_progress'
                    ? 'In progress'
                    : 'Scheduled'}
              </Badge>
            }
          />
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            {current.status === 'completed' ? (
              <LinkButton href={`/workouts/session/${current.id}`} variant="secondary">
                View summary
              </LinkButton>
            ) : (
              <>
                <LinkButton href={`/workouts/session/${current.id}`} size="lg">
                  <Dumbbell className="h-4 w-4" aria-hidden="true" />
                  {current.status === 'in_progress' ? 'Continue workout' : 'Start workout'}
                </LinkButton>
                <QuickAdapt sessionId={current.id} plan={user.plan} gyms={gyms} />
              </>
            )}
          </div>
        </Card>
      ) : upcoming ? (
        <Card>
          <CardHeader
            title={`Next: ${upcoming.label}`}
            subtitle={`Scheduled for ${upcoming.scheduledDate}`}
            action={<Badge tone="neutral">Rest day today</Badge>}
          />
          <div className="px-5 pb-5 flex flex-wrap gap-2">
            <LinkButton href={`/workouts/session/${upcoming.id}`} variant="secondary">
              Preview the session
            </LinkButton>
            <LinkButton href="/calendar" variant="ghost">
              Open calendar
            </LinkButton>
          </div>
        </Card>
      ) : plan ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title="No sessions scheduled this week"
          description="Your plan exists but no days are scheduled yet."
          action={
            <form action={regeneratePlanFormAction}>
              <Button type="submit">Schedule this week</Button>
            </form>
          }
        />
      ) : (
        <EmptyState
          icon={<Dumbbell className="h-5 w-5" />}
          title="No plan yet"
          description="Generate a weekly plan from your equipment, your days and your experience."
          action={
            <form action={regeneratePlanFormAction}>
              <Button type="submit">Build my plan</Button>
            </form>
          }
        />
      )}

      {/* --------------------------------------------------------- missed */}
      {missed.length > 0 ? (
        <Card>
          <CardHeader
            title={`${missed.length} session${missed.length === 1 ? '' : 's'} went by`}
            subtitle="Nothing is added to your other days to compensate. Move it, or let it go."
            action={<TriangleAlert className="h-5 w-5 text-warn-500" aria-hidden="true" />}
          />
          <div className="px-5 pb-5 space-y-2">
            {missed.slice(0, 3).map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.label}</p>
                  <p className="text-xs text-[var(--text-muted)]">{m.scheduledDate}</p>
                </div>
                <QuickAdapt sessionId={m.id} plan={user.plan} gyms={gyms} missed />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat
          label="This week"
          value={`${completedThisWeek}/${week.length}`}
          hint="sessions logged"
          tone="brand"
        />
        <Stat label="Sets logged" value={overview.totals.setsLogged} hint="last 4 weeks" />
        <Stat
          label="Total load"
          value={`${overview.totals.volumeKg.toLocaleString('en-IN')} kg`}
          hint="from sets where you recorded a weight"
        />
        <Stat
          label="Other activity"
          value={`${overview.totals.activityMinutes} min`}
          hint="walks, rides, sport"
          tone="teal"
        />
      </div>

      {/* ----------------------------------------------------------- week */}
      <Card>
        <CardHeader
          title="Your week"
          subtitle={describeConsistency(completedThisWeek, week.length)}
          action={
            <LinkButton href="/calendar" variant="ghost" size="sm">
              Calendar
            </LinkButton>
          }
        />
        <div className="px-5 pb-5 grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }, (_, i) => {
            const date = addDays(monday, i);
            const session = week.find((s) => s.scheduledDate === date);
            const isToday = date === today;
            const tone =
              session?.status === 'completed'
                ? 'bg-[var(--accent)] text-white'
                : session?.status === 'skipped'
                  ? 'bg-[var(--surface-sunken)] text-[var(--text-muted)] line-through'
                  : session
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'bg-[var(--surface-sunken)] text-[var(--text-muted)]';
            return (
              <div key={date} className="text-center">
                <p className="text-[11px] text-[var(--text-muted)] mb-1">{DAY_SHORT[(i + 1) % 7]}</p>
                <div
                  className={`rounded-lg py-3 text-xs ${tone} ${isToday ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--surface-raised)]' : ''}`}
                  title={session?.label ?? 'Rest'}
                >
                  {session ? (session.status === 'completed' ? '✓' : '•') : '–'}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ----------------------------------------------------------- food */}
      <Card>
        <CardHeader
          title="Today's meals"
          subtitle={
            mealPlan
              ? `From your plan for the week of ${mealPlan.weekStart}`
              : 'No meal plan yet — GymOS will not guess what you want to eat.'
          }
          action={
            <LinkButton href="/nutrition/meal-plan" variant="ghost" size="sm">
              Meal plan
            </LinkButton>
          }
        />
        <div className="px-5 pb-5">
          {todaysMeals.length > 0 ? (
            <ul className="space-y-2">
              {todaysMeals.map((meal) => (
                <li
                  key={meal.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                      {meal.slot}
                    </p>
                    <Link
                      href={`/nutrition/recipes/${meal.recipeId}`}
                      className="text-sm font-medium hover:text-[var(--accent)]"
                    >
                      {meal.recipeName}
                    </Link>
                  </div>
                  <span className="text-xs text-[var(--text-muted)] shrink-0 inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    {meal.totalMinutes} min
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <UtensilsCrossed className="h-5 w-5 text-[var(--text-muted)]" aria-hidden="true" />
              <p className="text-sm text-[var(--text-muted)] flex-1 min-w-48">
                Nothing planned for today.
              </p>
              <LinkButton href="/nutrition/meal-plan" variant="secondary" size="sm">
                Plan meals
              </LinkButton>
            </div>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------- plan rationale */}
      {plan ? (
        <Card>
          <CardHeader
            title="Why your plan looks like this"
            subtitle={`${plan.splitKind.replace(/_/g, ' ')} · generated by ${plan.generatorVersion}`}
            action={<Sparkles className="h-5 w-5 text-[var(--accent-2)]" aria-hidden="true" />}
          />
          <div className="px-5 pb-5">
            <BulletList items={plan.explanation} />
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton href="/workouts/plan" variant="secondary" size="sm">
                Open and edit the plan
              </LinkButton>
              <LinkButton href="/fitbrain" variant="ghost" size="sm">
                Ask FitBrain about it
              </LinkButton>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
