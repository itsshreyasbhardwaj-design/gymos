import type { Metadata } from 'next';
import { Brain, ShieldCheck } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { FITBRAIN_CAPABILITIES, FITBRAIN_VERSION, activeProvider } from '@/lib/services/fitbrain';
import { evaluate } from '@/lib/services/entitlements';
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader } from '@/components/ui';
import { FitBrainChat } from '@/components/fitbrain-chat';

export const metadata: Metadata = { title: 'FitBrain' };

export default async function FitBrainPage() {
  const user = await requireUser();
  const provider = activeProvider();
  const entitlement = evaluate(user.plan, user.id, 'fitbrain_actions');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Guided assistant"
        title="FitBrain"
        description="Ask about your plan, your equipment, your history or your meals. Every answer is computed from your own records."
        action={
          <LinkButton href="/fitbrain/memory" variant="secondary" size="sm">
            What it remembers
          </LinkButton>
        }
      />

      <Notice tone="neutral" title="This is not a chatbot">
        <p>
          There is no language model in this build and no API key is required. FitBrain maps your
          question onto one of a fixed set of capabilities and answers by querying your data and the
          reviewed content libraries. If it cannot match your question, it says so rather than
          making something up.
        </p>
        <p className="mt-2 text-xs">
          Engine <code className="font-mono">{FITBRAIN_VERSION}</code> · language model provider:{' '}
          <code className="font-mono">{provider.id}</code> (
          {provider.configured ? 'configured' : 'not configured'}). Even when one is connected it
          could only rephrase an answer the rules already produced — it can never bypass the
          planning engines or the safety rules.
        </p>
      </Notice>

      <FitBrainChat
        suggestions={FITBRAIN_CAPABILITIES.map((c) => c.example)}
        limit={entitlement.limit}
        used={entitlement.current ?? 0}
      />

      <Card>
        <CardHeader
          title="What FitBrain can do"
          action={<Brain className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />}
        />
        <div className="px-5 pb-5 grid gap-2 sm:grid-cols-2">
          {FITBRAIN_CAPABILITIES.map((c) => (
            <div key={c.id} className="rounded-lg border border-[var(--border)] p-3">
              <p className="text-sm font-medium">{c.label}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">&ldquo;{c.example}&rdquo;</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="What FitBrain will not do"
          action={<ShieldCheck className="h-5 w-5 text-warn-500" aria-hidden="true" />}
        />
        <div className="px-5 pb-5">
          <ul className="space-y-2 text-sm leading-relaxed text-[var(--text-muted)]">
            <li>Diagnose an injury, symptom or condition, or tell you whether it is safe to train.</li>
            <li>Recommend medication, treatment or a rehabilitation plan.</li>
            <li>Set a calorie target, a weight goal or a restrictive diet — for anyone, at any age.</li>
            <li>Rate how you look, or compare your body with anyone else&apos;s.</li>
            <li>Prescribe an exercise your equipment, age band, experience or limitations rule out.</li>
            <li>Answer from anything other than your own records and the content libraries.</li>
          </ul>
        </div>
      </Card>

      {entitlement.limit != null ? (
        <Badge tone="neutral">
          Free plan: {entitlement.current ?? 0} of {entitlement.limit} assistant actions used today.
        </Badge>
      ) : null}
    </div>
  );
}
