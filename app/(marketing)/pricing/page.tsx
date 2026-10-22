import type { Metadata } from 'next';
import { CircleCheck, Minus } from 'lucide-react';
import { Badge, Card, LinkButton, Notice, PageHeader, Section } from '@/components/ui';
import { PRICING, BILLING_STATUS, ENTITLEMENT_MATRIX, humanFeature } from '@/lib/engines/entitlements';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'GymOS Free and GymOS Pro, with the real entitlement limits.',
};

export default function PricingPage() {
  const features = [...new Set(ENTITLEMENT_MATRIX.map((e) => e.feature))];
  const row = (plan: 'free' | 'pro', feature: string) =>
    ENTITLEMENT_MATRIX.find((e) => e.plan === plan && e.feature === feature);

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 space-y-12">
      <PageHeader
        eyebrow="Pricing"
        title="Two plans, no surprises"
        description="The limits below are read straight from the entitlement matrix the server enforces. They are not marketing copy."
      />

      <Notice tone="warn" title="Payments are not enabled in this build">
        {BILLING_STATUS.message}
      </Notice>

      <div className="grid gap-4 sm:grid-cols-2">
        {([PRICING.free, PRICING.pro] as const).map((tier, idx) => (
          <Card key={tier.name} className={idx === 1 ? 'p-6 border-[var(--accent)]' : 'p-6'}>
            {idx === 1 ? <Badge tone="brand" className="mb-3">Proposed price</Badge> : null}
            <p className="font-semibold text-lg">{tier.name}</p>
            <p className="text-4xl font-semibold mt-2 tabular-nums">
              ₹{(tier.pricePaise / 100).toLocaleString('en-IN')}
              <span className="text-base font-normal text-[var(--text-muted)]">/month</span>
            </p>
            <p className="text-sm text-[var(--text-muted)] mt-2">{tier.blurb}</p>
            <ul className="mt-5 space-y-2 text-sm">
              {tier.includes.map((line) => (
                <li key={line} className="flex gap-2">
                  <CircleCheck className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent-2)]" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <LinkButton
                href="/signup"
                variant={idx === 1 ? 'primary' : 'secondary'}
                className="w-full"
              >
                {idx === 1 ? 'Start on Free, upgrade later' : 'Create a free account'}
              </LinkButton>
            </div>
          </Card>
        ))}
      </div>

      <Section title="Every limit, side by side">
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Feature limits by plan</caption>
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className="text-left font-medium p-4">
                  Feature
                </th>
                <th scope="col" className="text-left font-medium p-4 w-32">
                  Free
                </th>
                <th scope="col" className="text-left font-medium p-4 w-32">
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {features.map((feature) => {
                const free = row('free', feature);
                const pro = row('pro', feature);
                const cell = (r: typeof free) => {
                  if (!r || !r.enabled) {
                    return (
                      <span className="inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                        <Minus className="h-3.5 w-3.5" aria-hidden="true" /> Not included
                      </span>
                    );
                  }
                  if (r.limitValue == null) return <span>Unlimited</span>;
                  return <span className="tabular-nums">{r.limitValue}</span>;
                };
                return (
                  <tr key={feature} className="border-b border-[var(--border)] last:border-0">
                    <th scope="row" className="text-left font-normal p-4">
                      {humanFeature(feature as never)}
                    </th>
                    <td className="p-4">{cell(free)}</td>
                    <td className="p-4">{cell(pro)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <p className="text-xs text-[var(--text-muted)]">
          Data export and account deletion are available on both plans and always will be. Your
          records are not a retention lever.
        </p>
      </Section>

      <Section title="GymOS Coach+">
        <Notice tone="neutral">
          A future tier involving qualified human coaches is on the roadmap. It does not exist, no
          coaches are available, and GymOS will not pretend otherwise or sell access to something
          that is not there.
        </Notice>
      </Section>
    </div>
  );
}
