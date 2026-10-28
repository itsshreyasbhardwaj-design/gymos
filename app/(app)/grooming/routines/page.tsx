import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listRoutines } from '@/lib/services/grooming';
import { listProducts } from '@/lib/services/skincare';
import { evaluate } from '@/lib/services/entitlements';
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader } from '@/components/ui';
import { RoutineCreateForm, RoutineEditor } from '@/components/grooming-forms';

export const metadata: Metadata = { title: 'Grooming routines' };

const SLOT_LABELS: Record<string, string> = {
  morning: 'Morning',
  evening: 'Evening',
  weekly: 'Weekly',
  custom: 'Chosen days',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function GroomingRoutinesPage() {
  const user = await requireUser();
  const routines = listRoutines(user.id, { includeInactive: true });
  const products = listProducts(user.id).map((p) => ({ id: p.id, name: p.name }));
  const entitlement = evaluate(user.plan, user.id, 'care_routines');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Personal care"
        title="Grooming routines"
        description="An ordered list of steps you wrote yourself. GymOS does not suggest what should be in it."
      />

      <Card>
        <CardHeader
          title="Your routines"
          subtitle={
            entitlement.limit == null
              ? 'Active routines on your plan: unlimited.'
              : `Active routines: ${entitlement.current ?? 0} of ${entitlement.limit} on your plan. Grooming and hygiene share one allowance.`
          }
        />
        <div className="px-5 pb-5 space-y-3">
          {routines.length === 0 ? (
            <EmptyState
              title="No routines yet"
              description="Create one below. A paused routine is never deleted and never shows as due."
            />
          ) : (
            routines.map((routine) => (
              <details
                key={routine.id}
                className="rounded-xl border border-[var(--border)] px-3.5 py-3"
              >
                <summary className="cursor-pointer text-sm font-medium flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    {routine.name}
                    <span className="block text-xs font-normal text-[var(--text-muted)] mt-0.5">
                      {SLOT_LABELS[routine.slot] ?? routine.slot}
                      {routine.daysOfWeek.length > 0
                        ? ` · ${routine.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')}`
                        : ''}
                      {` · ${routine.steps.length} step${routine.steps.length === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <Badge tone={routine.active ? 'ok' : 'neutral'}>
                    {routine.active ? 'On' : 'Paused'}
                  </Badge>
                </summary>
                <div className="pt-4">
                  <RoutineEditor
                    routine={{
                      id: routine.id,
                      name: routine.name,
                      slot: routine.slot,
                      daysOfWeek: routine.daysOfWeek,
                      active: routine.active,
                      notes: routine.notes,
                      steps: routine.steps.map((step) => ({
                        id: step.id,
                        label: step.label,
                        productName: step.productName,
                      })),
                    }}
                    products={products}
                  />
                </div>
              </details>
            ))
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="New routine"
          subtitle="Name it, say when it happens, then list the steps in the order you do them."
        />
        <div className="px-5 pb-5">
          {entitlement.allowed ? (
            <RoutineCreateForm products={products} />
          ) : (
            <Notice tone="warn" title="Routine limit reached">
              {entitlement.reason} Your existing routines keep working, and you can pause or delete
              one to make room.
            </Notice>
          )}
        </div>
      </Card>

      {products.length === 0 ? (
        <Notice tone="neutral">
          A step can name one of your products once you have added some on the{' '}
          <Link href="/skincare" className="underline">
            skincare page
          </Link>
          . Steps work perfectly well without one.
        </Notice>
      ) : null}
    </div>
  );
}
