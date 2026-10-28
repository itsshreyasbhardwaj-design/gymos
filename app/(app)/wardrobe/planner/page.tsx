import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listOutfitPlans, listOutfits } from '@/lib/services/wardrobe';
import { addDays, mondayOf } from '@/lib/engines/nutrition';
import { Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';
import { WeekPlanner, type PlanDayView } from '@/components/outfit-builder';

export const metadata: Metadata = { title: 'Outfit planner' };

const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default async function OutfitPlannerPage() {
  const user = await requireUser();
  const weekStart = mondayOf(new Date().toISOString().slice(0, 10));
  const weekEnd = addDays(weekStart, 6);
  const plans = listOutfitPlans(user.id, weekStart, weekEnd);
  const outfits = listOutfits(user.id);

  const days: PlanDayView[] = DAY_LABELS.map((label, index) => {
    const date = addDays(weekStart, index);
    return {
      date,
      label,
      plans: plans
        .filter((plan) => plan.date === date)
        .map((plan) => ({
          id: plan.id,
          occasion: plan.occasion,
          status: plan.status,
          note: plan.note,
          outfitName: plan.outfitName,
          itemNames: plan.itemNames,
        })),
    };
  });

  const plannedCount = plans.length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Style OS"
        title="Outfit planner"
        description={`Week of ${weekStart}. ${plannedCount} ${plannedCount === 1 ? 'day is' : 'days are'} planned.`}
        action={
          <LinkButton href="/wardrobe/outfits" variant="secondary">
            Build an outfit
          </LinkButton>
        }
      />

      <Notice tone="neutral" title="A plan, not a rule">
        One outfit per occasion per day. Marking a day as worn increments the wear count for that
        outfit and for every item in it, which is the only place those numbers come from. Skipping a
        day records nothing except that you wore something else — there is no streak to break and
        nothing to catch up on.
      </Notice>

      {outfits.length === 0 ? (
        <Card>
          <CardHeader title="No saved outfits yet" />
          <div className="px-5 pb-5">
            <EmptyState
              title="Save a combination first"
              description="The planner assigns saved outfits to dates, so start on the outfits page."
              action={
                <LinkButton href="/wardrobe/outfits">Go to outfit suggestions</LinkButton>
              }
            />
          </div>
        </Card>
      ) : (
        <WeekPlanner
          days={days}
          outfits={outfits.map((outfit) => ({ id: outfit.id, name: outfit.name }))}
        />
      )}

      <p className="text-sm text-[var(--text-muted)]">
        Back to your{' '}
        <Link href="/wardrobe" className="underline">
          wardrobe
        </Link>
        .
      </p>
    </div>
  );
}
