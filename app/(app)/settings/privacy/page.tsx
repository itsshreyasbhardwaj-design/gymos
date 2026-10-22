import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listConsents, CONSENT_COPY, getProfile, type ConsentKind } from '@/lib/services/account';
import { Card, CardHeader, Notice, PageHeader } from '@/components/ui';
import {
  ConsentToggle,
  ExportDataButton,
  DeleteBiometricsButton,
  DeleteAccountForm,
} from '@/components/settings-forms';

export const metadata: Metadata = { title: 'Privacy and data' };

export default async function PrivacySettingsPage() {
  const user = await requireUser();
  const profile = getProfile(user.id);
  const consents = listConsents(user.id);
  const isMinor = profile?.ageBand !== 'adult_18_plus';
  const granted = (kind: string) => consents.find((c) => c.kind === kind)?.granted ?? false;

  const optional: ConsentKind[] = [
    'biometrics',
    'activity_import',
    'household_planning',
    'analytics',
    'coach_sharing',
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy and data"
        description="Everything GymOS holds about you, and the controls to take it back."
      />

      <Card>
        <CardHeader
          title="Optional permissions"
          subtitle="All off by default. Withdrawing one takes effect immediately."
        />
        <div className="px-5 pb-5 space-y-2">
          {optional.map((kind) => {
            const copy = CONSENT_COPY[kind];
            const blockedForMinor = kind === 'biometrics' && isMinor;
            return (
              <ConsentToggle
                key={kind}
                kind={kind}
                title={copy.title}
                body={copy.body}
                granted={granted(kind)}
                disabled={blockedForMinor}
                disabledReason={blockedForMinor ? copy.minorNote : undefined}
              />
            );
          })}
        </div>
      </Card>

      {granted('biometrics') ? (
        <Card>
          <CardHeader
            title="Biometric records"
            subtitle="Delete everything collected under this consent, without changing anything else."
          />
          <div className="px-5 pb-5">
            <DeleteBiometricsButton />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Export your data"
          subtitle="Available on every plan. Your records are not a retention lever."
        />
        <div className="px-5 pb-5">
          <ExportDataButton />
        </div>
      </Card>

      <Card>
        <CardHeader title="What GymOS stores" />
        <div className="px-5 pb-5 text-sm text-[var(--text-muted)] space-y-2 leading-relaxed">
          <p>
            Your account and profile, equipment profiles, generated plans, scheduled sessions,
            every set you log, session feedback, meal plans, pantry, grocery lists, recorded
            prices, activity records, and audit events for sensitive actions.
          </p>
          <p>
            Session records store a hash of the session token, not the token itself, plus a
            truncated user-agent and a salted hash of your IP address. Raw IP addresses are never
            stored.
          </p>
          <p>
            No third-party analytics or advertising scripts are loaded, and the application makes
            no external network calls at runtime. The{' '}
            <Link href="/privacy" className="underline">
              privacy policy
            </Link>{' '}
            describes all of it.
          </p>
        </div>
      </Card>

      <Card className="border-bad-500/40">
        <CardHeader title="Delete your account" subtitle="Permanent, immediate and irreversible." />
        <div className="px-5 pb-5">
          <DeleteAccountForm />
        </div>
      </Card>

      <Notice tone="warn" title="Not a compliance claim">
        This build has not been reviewed against GDPR, India&apos;s DPDP Act or any other regime,
        and GymOS does not claim certification under any of them. An independent review is required
        before handling other people&apos;s health data in public.
      </Notice>
    </div>
  );
}
