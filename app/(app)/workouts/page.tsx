import type { Metadata } from 'next';
import Link from 'next/link';
import { Dumbbell, History, CalendarRange, Sparkles } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getActivePlan, listPlanHistory } from '@/lib/services/plans';
import { listSessions, materialiseWeek } from '@/lib/services/sessions';
import { activeEquipmentSet } from '@/lib/services/equipment';
import { mondayOf, addDays } from '@/lib/engines/nutrition';
import {
  Badge,
  BulletList,
  Button,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  PageHeader,
} from '@/components/ui';
import { regeneratePlanFormAction } from '../actions';

export const metadata: Metadata = { title: 'Workouts' };

export default async function WorkoutsPage() {
  const user = await requireUser();
  const plan = getActivePlan(user.id);
  if (plan) materialiseWeek(user.id);

  const monday = mondayOf(new Date().toISOString().slice(0, 10));
  const week = listSessions(user.id, { from: monday, to: addDays(monday, 6) });
  const recent = listSessions(user.id, { status: ['completed'], limit: 5 });
  const equipment = activeEquipmentSet(user.id);
  const history = listPlanHistory(user.id);

  return (
    <div className="space-y-7">
      <PageHeader
        title="Workouts"
        description={
          plan
            ? `${plan.name} — ${plan.splitKind.replace(/_/g, ' ')}, built for ${equipment.profileName ?? 'your equipment'}.`
            : 'No active plan yet.'
        }
        action={
          <form action={regeneratePlanFormAction}>
            <Button type="submit" variant={plan ? 'secondary' : 'primary'}>
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {plan ? 'Regenerate plan' : 'Build my plan'}
            </Button>
          </form>
        }
      />

      {!plan ? (
        <EmptyState
          icon={<Dumbbell className="h-5 w-5" />}
          title="Let's build your first plan"
          description="GymOS will pick movement patterns first, then the best exercise you can actually do for each one with the equipment in your active profile."
          action={
            <form action={regeneratePlanFormAction}>
              <Button type="submit">Build my plan</Button>
            </form>
          }
        />
      ) : (
        <>
          <Card>
            <CardHeader
              title="This week"
              subtitle={`${week.filter((s) => s.status === 'completed').length} of ${week.length} logged`}
              action={
                <LinkButton href="/calendar" variant="ghost" size="sm">
                  <CalendarRange className="h-4 w-4" aria-hidden="true" />
                  Calendar
                </LinkButton>
              }
            />
            <div className="px-5 pb-5 space-y-2">
              {week.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  Nothing scheduled this week yet.
                </p>
              ) : null}
              {week.map((session) => (
                <Link
                  key={session.id}
                  href={`/workouts/session/${session.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-4 py-3 hover:border-[var(--border-strong)] transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{session.label}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {session.scheduledDate}
                      {session.setCount > 0 ? ` · ${session.setCount} sets logged` : ''}
                    </p>
                  </div>
                  <Badge
                    tone={
                      session.status === 'completed'
                        ? 'ok'
                        : session.status === 'in_progress'
                          ? 'brand'
                          : session.status === 'skipped'
                            ? 'neutral'
                            : 'neutral'
                    }
                  >
                    {session.status.replace('_', ' ')}
                  </Badge>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Your plan"
              subtitle="Edit any day, swap exercises, change sets and reps."
              action={
                <LinkButton href="/workouts/plan" size="sm">
                  Open plan
                </LinkButton>
              }
            />
            <div className="px-5 pb-5">
              <BulletList items={plan.explanation.slice(0, 4)} />
            </div>
          </Card>
        </>
      )}

      <Card>
        <CardHeader
          title="Recent sessions"
          action={
            <LinkButton href="/workouts/history" variant="ghost" size="sm">
              <History className="h-4 w-4" aria-hidden="true" />
              Full history
            </LinkButton>
          }
        />
        <div className="px-5 pb-5 space-y-2">
          {recent.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              Nothing logged yet. Your history fills in as you train.
            </p>
          ) : (
            recent.map((s) => (
              <Link
                key={s.id}
                href={`/workouts/session/${s.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 hover:border-[var(--border-strong)]"
              >
                <span className="text-sm truncate">{s.label}</span>
                <span className="text-xs text-[var(--text-muted)] shrink-0">
                  {s.scheduledDate} · {s.setCount} sets
                </span>
              </Link>
            ))
          )}
        </div>
      </Card>

      {history.length > 1 ? (
        <Card>
          <CardHeader
            title="Plan versions"
            subtitle="Generating a new plan never touches workouts you have already completed."
          />
          <div className="px-5 pb-5 space-y-1.5">
            {history.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-[var(--border)] last:border-0"
              >
                <span className="truncate">
                  v{p.version} · {p.name}
                </span>
                <span className="text-xs text-[var(--text-muted)] shrink-0">
                  {p.isActive ? <Badge tone="brand">Active</Badge> : p.createdAt.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
