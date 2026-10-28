import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, ListChecks } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { routinesDue, upcomingAppointments } from '@/lib/services/grooming';
import { productsNeedingAttention, patchTestsAwaitingObservation } from '@/lib/services/skincare';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Notice,
  PageHeader,
  Stat,
} from '@/components/ui';
import { AppointmentForm, AppointmentRow, RoutineLogButton } from '@/components/grooming-forms';

export const metadata: Metadata = { title: 'Grooming' };

export default async function GroomingPage() {
  const user = await requireUser();
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const due = routinesDue(user.id, today);
  const dueNow = due.filter((row) => row.due.due);
  const doneToday = due.filter((row) => row.due.doneToday);
  const attention = productsNeedingAttention(user.id, today);
  const appointments = upcomingAppointments(user.id, today, 45);
  const awaitingPatchTests = patchTestsAwaitingObservation(user.id, nowIso);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Personal care"
        title="Grooming"
        description="Your own routines, your own products, your own notes. Nothing here is a photograph, a rating or an assessment of how you look."
        action={
          <LinkButton href="/grooming/routines" variant="secondary">
            Manage routines
          </LinkButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Due today" value={dueNow.length} hint={`${due.length} active routine(s)`} />
        <Stat label="Logged today" value={doneToday.length} hint="Counts only, never a grade" />
        <Stat
          label="Products to check"
          value={attention.length}
          hint="From dates you recorded"
          tone={attention.length > 0 ? 'warn' : 'neutral'}
        />
      </div>

      <Card>
        <CardHeader
          title="Due today"
          subtitle={`Worked out from each routine's slot and chosen days — ${today}.`}
        />
        <div className="px-5 pb-5 space-y-2">
          {due.length === 0 ? (
            <EmptyState
              icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
              title="No routines yet"
              description="A routine is a short ordered list of steps — cleanse, shave, moisturise. You decide what is in it."
              action={
                <LinkButton href="/grooming/routines">Create your first routine</LinkButton>
              }
            />
          ) : (
            due.map(({ routine, due: verdict, adherence, completedStepIds }) => (
              <div
                key={routine.id}
                className="rounded-xl border border-[var(--border)] px-3.5 py-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{routine.name}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{verdict.reason}</p>
                    {routine.steps.length > 0 ? (
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        {routine.steps.map((step) => step.label).join(' → ')}
                      </p>
                    ) : null}
                    <p className="text-xs text-[var(--text-muted)] mt-1">{adherence.description}</p>
                  </div>
                  <Badge tone={verdict.doneToday ? 'ok' : verdict.due ? 'brand' : 'neutral'}>
                    {verdict.doneToday ? 'Logged' : verdict.due ? 'Due' : 'Not today'}
                  </Badge>
                </div>
                {verdict.due || verdict.doneToday ? (
                  <RoutineLogButton
                    routineId={routine.id}
                    date={today}
                    doneToday={verdict.doneToday}
                    steps={routine.steps.map((step) => ({ id: step.id, label: step.label }))}
                    completedStepIds={completedStepIds}
                  />
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      {attention.length > 0 ? (
        <Card>
          <CardHeader
            title="Products worth a look"
            subtitle="Based only on the expiry dates and period-after-opening figures you typed in."
          />
          <div className="px-5 pb-5 space-y-2">
            <ul className="space-y-2">
              {attention.map(({ product, expiry }) => (
                <li
                  key={product.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] px-3.5 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{expiry.reason}</p>
                  </div>
                  <Badge
                    tone={
                      expiry.state === 'expired'
                        ? 'bad'
                        : expiry.state === 'use_soon'
                          ? 'warn'
                          : 'neutral'
                    }
                  >
                    {expiry.state === 'expired'
                      ? 'Past date'
                      : expiry.state === 'use_soon'
                        ? 'Use soon'
                        : 'Running low'}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--text-muted)]">
              GymOS cannot tell whether a product is still good — it only compares the dates you
              recorded. Trust your own judgement and the packaging.{' '}
              <Link href="/skincare" className="underline">
                Manage your products
              </Link>
              .
            </p>
          </div>
        </Card>
      ) : null}

      {awaitingPatchTests.length > 0 ? (
        <Notice tone="warn" title="Patch tests waiting on you">
          {awaitingPatchTests.length === 1
            ? '1 patch test has finished its observation window, and you have not recorded what you saw yet.'
            : `${awaitingPatchTests.length} patch tests have finished their observation windows, and you have not recorded what you saw yet.`}{' '}
          GymOS does not look at anything on your behalf.{' '}
          <Link href="/skincare" className="underline">
            Record what you saw
          </Link>
          .
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title="Upcoming appointments"
          subtitle="Haircuts, salon visits, a dermatologist appointment — whatever you want to remember."
        />
        <div className="px-5 pb-5 space-y-4">
          {appointments.length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
              title="Nothing booked in the next 45 days"
              description="Add one below and it will show up here."
            />
          ) : (
            <ul className="space-y-2">
              {appointments.map((appointment) => (
                <AppointmentRow key={appointment.id} appointment={appointment} />
              ))}
            </ul>
          )}
          <AppointmentForm />
        </div>
      </Card>

      <Notice tone="neutral" title="What this page does not do">
        It does not rate your appearance, grade your skin, score your grooming or compare you with
        anyone. There is no photograph anywhere in this feature, and every number above is a count
        of something you logged yourself. Anything that feels medical — a rash, a reaction, pain —
        belongs with a qualified professional, not with an app.
      </Notice>
    </div>
  );
}
