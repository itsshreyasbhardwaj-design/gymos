import type { Metadata } from 'next';
import { Card, Notice, PageHeader } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The terms that apply to using GymOS.',
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. What GymOS is',
    body: [
      'GymOS is a fitness and meal-planning application. It provides general fitness information and food-planning tools.',
      'GymOS is not a medical device, not a healthcare service, and not a substitute for advice from a doctor, physiotherapist, dietitian or other qualified professional.',
    ],
  },
  {
    title: '2. Health and safety',
    body: [
      'Talk to a qualified professional before starting a new exercise programme, particularly if you have a health condition, are pregnant or postpartum, are recovering from injury or surgery, or are returning after a long break.',
      'Stop any exercise that causes pain. GymOS cannot assess your symptoms and will never tell you to train through them.',
      'You are responsible for exercising within your own limits and for the safety of your training environment and equipment.',
      'Exercise and recipe content in this build is an internal draft awaiting review by qualified professionals, and is labelled as such.',
    ],
  },
  {
    title: '3. Your account',
    body: [
      'You are responsible for keeping your password secure and for activity under your account.',
      'Provide accurate information. Equipment, experience and age band directly determine what GymOS prescribes, so inaccurate answers produce unsuitable plans.',
      'Accounts for under-18 users receive an age-appropriate experience. Do not misrepresent your age band to bypass it.',
    ],
  },
  {
    title: '4. Acceptable use',
    body: [
      'Do not attempt to access another user’s records, bypass entitlement limits, or disrupt the service.',
      'Do not submit content you do not have the right to submit.',
    ],
  },
  {
    title: '5. Plans and payment',
    body: [
      'Payments are not enabled in this build. No subscription can be purchased and no card can be charged.',
      'If billing is enabled later, it will require clear pricing, a working cancellation path, verified payment webhooks and the consumer disclosures required in the relevant jurisdiction. Those are prerequisites, not aspirations.',
    ],
  },
  {
    title: '6. Your content and data',
    body: [
      'Your records remain yours. You can export them or delete your account at any time, on any plan.',
      'The exercise and recipe libraries are GymOS content and are provided for your personal use within the application.',
    ],
  },
  {
    title: '7. Availability and changes',
    body: [
      'This is a development build. It may change, break or be reset without notice.',
      'No uptime, data durability or backup guarantee is made for this build.',
    ],
  },
  {
    title: '8. Liability',
    body: [
      'GymOS is provided as-is, without warranties of any kind, to the extent permitted by law.',
      'You use the exercise and nutrition information at your own risk, having regard to the health and safety terms above.',
    ],
  },
];

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 space-y-8">
      <PageHeader eyebrow="Legal" title="Terms of service" />
      <Notice tone="warn" title="Not legal advice, and not lawyer-reviewed">
        These terms describe how this build behaves. They have not been drafted or reviewed by a
        qualified lawyer and would need to be before any public launch.
      </Notice>
      {SECTIONS.map((section) => (
        <Card key={section.title} className="p-5">
          <h2 className="font-semibold">{section.title}</h2>
          <ul className="mt-3 space-y-2 text-sm text-[var(--text-muted)] leading-relaxed">
            {section.body.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
