import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleCheck, Minus } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { evaluate } from '@/lib/services/entitlements';
import {
  ENTITLEMENT_MATRIX,
  PRICING,
  BILLING_STATUS,
  humanFeature,
  type Feature,
} from '@/lib/engines/entitlements';
import { Badge, Card, CardHeader, Notice, PageHeader } from '@/components/ui';
import { DevPlanSwitcher } from '@/components/settings-forms';

export const metadata: Metadata = { title: 'Plan and billing' };

export default async function SubscriptionSettingsPage() {
  const user = await requireUser();
  const features = [...new Set(ENTITLEMENT_MATRIX.map((e) => e.feature))] as Feature[];
  const tier = user.plan === 'pro' ? PRICING.pro : PRICING.free;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan and billing"
        description="What your plan includes, and what the server actually enforces."
        action={<Badge tone={user.plan === 'pro' ? 'brand' : 'neutral'}>{tier.name}</Badge>}
      />

      <Notice tone="warn" title="Payments are not enabled">
        {BILLING_STATUS.message}
      </Notice>

      <Card>
        <CardHeader
          title="Your current limits"
          subtitle="Read live from the entitlement checks, including how much you have used."
        />
        <div className="px-5 pb-5 space-y-1.5">
          {features.map((feature) => {
            const check = evaluate(user.plan, user.id, feature);
            return (
              <div
                key={feature}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm"
              >
                <span>{humanFeature(feature)}</span>
                <span className="text-xs shrink-0">
                  {check.limit === 0 ? (
                    <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
                      <Minus className="h-3.5 w-3.5" aria-hidden="true" /> Not included
                    </span>
                  ) : check.limit == null ? (
                    <span className="inline-flex items-center gap-1 text-ok-500">
                      <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Unlimited
                    </span>
                  ) : (
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {check.current ?? 0} / {check.limit}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title={tier.name} subtitle={tier.blurb} />
        <div className="px-5 pb-5">
          <p className="text-3xl font-semibold tabular-nums">
            ₹{(tier.pricePaise / 100).toLocaleString('en-IN')}
            <span className="text-sm font-normal text-[var(--text-muted)]">/month</span>
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {tier.includes.map((line) => (
              <li key={line} className="flex gap-2">
                <CircleCheck className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent-2)]" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
          <p className="text-sm text-[var(--text-muted)] mt-4">
            <Link href="/pricing" className="underline">
              Compare both plans
            </Link>
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Development plan switch"
          subtitle="Because there is no payment path, this is how Pro is granted in this build. No card, no charge, no fake receipt."
        />
        <div className="px-5 pb-5">
          <DevPlanSwitcher current={user.plan} />
        </div>
      </Card>

      <Notice tone="neutral" title="What production billing would require">
        Razorpay credentials and a verified webhook endpoint, idempotent subscription updates, a
        working cancellation path that takes effect at the end of the paid period, invoice records,
        and the consumer disclosures required in the relevant jurisdiction. None of that exists
        here, which is why nothing can be purchased.
      </Notice>
    </div>
  );
}
