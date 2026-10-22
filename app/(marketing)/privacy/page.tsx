import type { Metadata } from 'next';
import { Card, Notice, PageHeader } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What GymOS stores, why, and how to get it back or delete it.',
};

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'What this document is',
    body: [
      'This describes how the GymOS application in this build actually handles data. It is written to match the implementation, not a template. It has not been reviewed by a lawyer, and it is not a claim of compliance with any particular regime.',
    ],
  },
  {
    title: 'What GymOS stores',
    body: [
      'Account: your email address and a scrypt hash of your password. The password itself is never stored or logged.',
      'Profile: display name, age band, language, timezone, units, experience, training interests, available days and session length, training environment, accessibility preferences, and any movement sensitivities you choose to record.',
      'Equipment: your equipment profiles and their inventories.',
      'Training: generated plans, scheduled sessions, every set you log, session feedback, substitutions and plan revisions.',
      'Nutrition: dietary preferences, declared allergens, disliked ingredients, meal plans, pantry contents, grocery lists and any ingredient prices you record.',
      'Progress: activity records you enter, personal milestones derived from your own logged sets, and — only if you switch it on — optional biometric records.',
      'Operational: sessions (a hash of the session token, expiry, a truncated user-agent string and a salted hash of your IP address), authentication attempt counts for rate limiting, and audit events for sensitive actions.',
    ],
  },
  {
    title: 'What GymOS does not store or do',
    body: [
      'No third-party analytics, advertising or tracking scripts are loaded. There are no external network calls from the application at runtime.',
      'No raw IP addresses are stored. They are hashed with a deployment salt and truncated.',
      'No biometric or health data is collected unless you explicitly consent, and that consent can be withdrawn at any time with one action that also deletes the records.',
      'No data is shared with trainers, gyms or any third party, because no such integration exists in this build.',
      'No payment data is handled at all — payments are not enabled.',
    ],
  },
  {
    title: 'Age-appropriate handling',
    body: [
      'Accounts in the under-13 and 13-17 age bands receive a different experience: conservative programming, no restrictive nutrition settings, no calorie or weight targets, and no appearance-based assessment of any kind.',
      'Optional biometric collection is refused for under-18 accounts at the server, not merely hidden.',
      'Legal requirements for children’s data vary by jurisdiction and have not been reviewed for this build. That review is a prerequisite before any public launch, and is listed as such in the roadmap.',
    ],
  },
  {
    title: 'Your controls',
    body: [
      'View and edit everything in your profile from Settings.',
      'Export every record tied to your account as JSON from Settings → Privacy. This is available on the free plan.',
      'Delete your account permanently from Settings → Privacy. Deletion removes your rows from every table and cannot be undone.',
      'Withdraw any optional consent at any time. Withdrawing biometric consent also deletes the records collected under it.',
      'Revoke other signed-in sessions from Settings → Security.',
    ],
  },
  {
    title: 'Security',
    body: [
      'Passwords are hashed with scrypt using per-password salts and stored parameters, so the cost can be raised later without invalidating existing passwords.',
      'Sessions are server-managed. Only a hash of the session token is stored, and tokens expire and can be revoked.',
      'Session cookies are HTTP-only and SameSite=Lax, and are marked Secure in production.',
      'Every data access is scoped to your user id in the database query itself, not filtered afterwards in application code.',
      'Mutating API routes verify the request origin, and Server Actions carry the framework’s own origin checks.',
      'Authentication endpoints are rate limited per account and per IP.',
    ],
  },
  {
    title: 'Retention',
    body: [
      'Records are kept until you delete them or delete your account.',
      'Expired sessions and old authentication attempt rows are pruned.',
      'There is no backup system in this local build. A production deployment would need one, and its retention terms would need to be described here.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 space-y-8">
      <PageHeader
        eyebrow="Privacy"
        title="Privacy policy"
        description="Written against the implementation, so it can be checked."
      />
      <Notice tone="warn" title="Not a compliance claim">
        This build has not been reviewed against GDPR, India&apos;s DPDP Act, HIPAA or any other
        regime, and GymOS does not claim certification under any of them. An independent review is
        required before handling other people&apos;s health data in public.
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
      <p className="text-xs text-[var(--text-muted)]">
        Last updated alongside the code in this build.
      </p>
    </div>
  );
}
