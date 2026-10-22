import type { Metadata } from 'next';
import { Card, Notice, PageHeader } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach GymOS.',
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 space-y-6">
      <PageHeader
        eyebrow="Contact"
        title="Getting in touch"
        description="GymOS is running locally in development. There is no mail service connected, so a contact form here would collect messages nobody receives."
      />
      <Notice tone="warn" title="No contact form is provided">
        Email delivery requires an external provider, which this build deliberately does not
        configure. Rather than show a form that silently discards what you write, GymOS says so.
      </Notice>
      <Card className="p-5 space-y-3 text-sm leading-relaxed">
        <p className="font-medium">If you are running this build yourself</p>
        <p className="text-[var(--text-muted)]">
          Support routes, an email provider and a stored contact inbox are listed in{' '}
          <code className="font-mono text-xs">ROADMAP.md</code> as pre-launch requirements. The
          integration boundary for an email provider is described in{' '}
          <code className="font-mono text-xs">ENVIRONMENT.md</code>.
        </p>
        <p className="font-medium pt-2">Safety and medical questions</p>
        <p className="text-[var(--text-muted)]">
          GymOS cannot answer them, and neither can a support inbox. Please speak to a doctor,
          physiotherapist or dietitian. If you are in immediate danger, contact your local emergency
          services.
        </p>
      </Card>
    </div>
  );
}
