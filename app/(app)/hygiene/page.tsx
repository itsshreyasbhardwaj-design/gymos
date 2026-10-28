import type { Metadata } from 'next';
import { CalendarClock, ListChecks, PackageOpen } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { hygieneDashboard, listRoutines, listSupplies } from '@/lib/services/hygiene';
import { dayOfWeek, todayListCounts } from '@/lib/engines/hygiene';
import { evaluate } from '@/lib/services/entitlements';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  Notice,
  PageHeader,
  Stat,
} from '@/components/ui';
import {
  RoutineComposer,
  RoutineManager,
  SupplyManager,
  TodayChecklist,
} from '@/components/hygiene-forms';

export const metadata: Metadata = { title: 'Hygiene' };

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function cadenceLabel(routine: {
  cadence: string;
  daysOfWeek: number[];
  everyNDays: number | null;
}): string {
  const named = routine.daysOfWeek
    .map((d) => DAY_LABELS[d])
    .filter((d): d is string => Boolean(d))
    .join(', ');
  if (routine.cadence === 'daily') return 'Every day';
  if (routine.cadence === 'weekly') {
    return named ? `Weekly on ${named}` : 'Every 7 days from the last time you completed it';
  }
  if (routine.everyNDays) return `Every ${routine.everyNDays} days`;
  return named ? `On ${named}` : 'No interval set yet, so it is not being scheduled';
}

export default async function HygienePage() {
  const user = await requireUser();
  const dashboard = hygieneDashboard(user.id);
  const routines = listRoutines(user.id);
  const entitlement = evaluate(user.plan, user.id, 'care_routines');
  // The header describes the list rendered below it, so both come from the same views.
  const todayCounts = todayListCounts(dashboard.due, dashboard.today);
  // The runway view is derived; the edit form needs the stored values it came from.
  const storedSupplies = new Map(listSupplies(user.id).map((s) => [s.id, s]));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Personal care"
        title="Hygiene"
        description="Your own routines, the days they fall on, and the supplies behind them. GymOS counts what you tick and nothing else: there is no cleanliness score here, no grade and no streak to break."
      />

      <Notice tone="neutral" title="What this page stores">
        Routine names, task labels, the dates you tick, and the replacement intervals you type in.
        No photos, no recordings and no measurements — this module works the same whatever your
        account settings are, and nothing on it is ever shared.
      </Notice>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Tasks to tick today"
          value={todayCounts.tasksStillToTick}
          hint={todayCounts.note}
          // Decided in the engine, where it is unit-tested. See TodayListCounts.tone.
          tone={todayCounts.tone}
        />
        <Stat
          label="Active routines"
          value={dashboard.activeRoutineCount}
          hint={
            entitlement.limit == null
              ? 'Unlimited on your plan'
              : `${entitlement.current ?? 0} of ${entitlement.limit} used`
          }
        />
        <Stat
          label="Supplies to restock"
          value={dashboard.restock.length}
          hint={`${dashboard.supplies.length} tracked`}
          tone={dashboard.restock.length > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader
          title="Today"
          subtitle={`${dashboard.today}. Tick what you have done; leave the rest. Ticking twice changes nothing, and anything you tick stays here until tomorrow so you can un-tick it.`}
        />
        <div className="px-5 pb-5">
          {routines.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
              title="No routines yet"
              description="Build one below — a name, how often it comes round, and the tasks you want to tick."
            />
          ) : (
            <TodayChecklist
              today={dashboard.today}
              routines={dashboard.todayList.map((r) => ({
                routineId: r.routineId,
                routineName: r.routineName,
                category: r.category,
                due: r.due,
                detail: r.detail,
                tasks: r.tasks,
              }))}
            />
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Coming up"
            subtitle="The next seven days, from the cadences you set."
          />
          <div className="px-5 pb-5">
            {dashboard.upcoming.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                Nothing else falls in the next seven days.
              </p>
            ) : (
              <KeyValue
                items={dashboard.upcoming.map((u) => ({
                  label: `${u.date} · ${DAY_LABELS[dayOfWeek(u.date)] ?? ''}`,
                  value: (
                    <span>
                      {u.routineName}{' '}
                      <span className="text-[var(--text-muted)]">
                        ({u.taskCount} task{u.taskCount === 1 ? '' : 's'})
                      </span>
                    </span>
                  ),
                }))}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent activity"
            subtitle={`Counts over the last ${dashboard.summary.windowDays} days (${dashboard.summary.windowStart} to ${dashboard.summary.windowEnd}).`}
          />
          <div className="px-5 pb-5 space-y-3">
            <p className="text-sm">{dashboard.summary.note}</p>
            {dashboard.summary.perRoutine.length === 0 ? null : (
              <KeyValue
                items={dashboard.summary.perRoutine.map((row) => ({
                  label: dashboard.routineNames[row.routineId] ?? 'Deleted routine',
                  value: (
                    <span className="tabular-nums">
                      {row.taskTicks} tick{row.taskTicks === 1 ? '' : 's'} on {row.daysRecorded} day
                      {row.daysRecorded === 1 ? '' : 's'}
                      {row.lastRecordedOn ? (
                        <span className="text-[var(--text-muted)]"> · last {row.lastRecordedOn}</span>
                      ) : null}
                    </span>
                  ),
                }))}
              />
            )}
            <p className="text-xs text-[var(--text-muted)]">
              These are counts of what you recorded, not a measure of you. Days with nothing
              recorded are simply days with nothing recorded.
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Supplies"
          subtitle="Days left are worked out only from the dates and intervals you enter. Where you have not entered them, GymOS says so instead of estimating. Edit corrects a date or an interval later."
          action={
            dashboard.restock.length > 0 ? (
              <Badge tone="warn">
                {dashboard.restock.length} to restock
              </Badge>
            ) : null
          }
        />
        <div className="px-5 pb-5">
          {dashboard.restock.length > 0 ? (
            <Notice tone="warn" className="mb-4" title="On the restock list">
              <ul className="space-y-1">
                {dashboard.restock.map((s) => (
                  <li key={s.supplyId}>
                    <span className="font-medium">{s.name}</span> — {s.note}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : dashboard.supplies.length === 0 ? (
            <EmptyState
              icon={<PackageOpen className="h-5 w-5" aria-hidden="true" />}
              title="No supplies tracked"
              description="Add the things you run out of and GymOS will flag them before they do."
            />
          ) : null}
          <SupplyManager
            today={dashboard.today}
            supplies={dashboard.supplies.map((s) => ({
              supplyId: s.supplyId,
              name: s.name,
              category: s.category,
              basis: s.basis,
              restock: s.restock,
              note: s.note,
              runningLow: s.runningLow,
              lastReplacedAt: storedSupplies.get(s.supplyId)?.lastReplacedAt ?? null,
              replaceEveryDays: storedSupplies.get(s.supplyId)?.replaceEveryDays ?? null,
              notes: storedSupplies.get(s.supplyId)?.notes ?? '',
            }))}
          />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="New routine"
            subtitle="Daily, weekly on chosen days, or a custom interval in days."
          />
          <div className="px-5 pb-5">
            <RoutineComposer canCreate={entitlement.allowed} reason={entitlement.reason} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Your routines"
            subtitle="Edit changes a name or how often it comes round. Pause one and its history is kept. Delete one and its check-ins go with it."
            action={
              <Badge tone="neutral">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                {dashboard.routineCount}
              </Badge>
            }
          />
          <div className="px-5 pb-5">
            <RoutineManager
              routines={routines.map((r) => ({
                id: r.id,
                name: r.name,
                category: r.category,
                cadenceLabel: cadenceLabel(r),
                cadence: r.cadence,
                daysOfWeek: r.daysOfWeek,
                everyNDays: r.everyNDays,
                notes: r.notes,
                active: r.active,
                tasks: r.tasks.map((t) => ({ id: t.id, label: t.label })),
              }))}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
