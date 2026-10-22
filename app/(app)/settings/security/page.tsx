import type { Metadata } from 'next';
import { requireUser, listSessions } from '@/lib/auth/session';
import { Badge, Card, CardHeader, Notice, PageHeader } from '@/components/ui';
import { PasswordForm, RevokeSessionsButton } from '@/components/settings-forms';

export const metadata: Metadata = { title: 'Security' };

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  const sessions = listSessions(user.id);
  const now = new Date().toISOString();
  const active = sessions.filter((s) => !s.revokedAt && s.expiresAt > now);

  return (
    <div className="space-y-6">
      <PageHeader title="Security" description="Your password and where you are signed in." />

      <Card>
        <CardHeader
          title="Change password"
          subtitle="Changing it signs out every other device automatically."
        />
        <div className="px-5 pb-5">
          <PasswordForm />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Signed-in sessions"
          subtitle={`${active.length} active session(s).`}
        />
        <div className="px-5 pb-5 space-y-3">
          <ul className="space-y-1.5">
            {active.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate">{s.userAgent || 'Unknown device'}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Started {s.createdAt.slice(0, 16).replace('T', ' ')} · last seen{' '}
                    {s.lastSeenAt.slice(0, 16).replace('T', ' ')}
                  </p>
                </div>
                {s.id === user.sessionId ? <Badge tone="brand">This device</Badge> : null}
              </li>
            ))}
          </ul>
          <RevokeSessionsButton />
        </div>
      </Card>

      <Notice tone="neutral" title="How sessions work here">
        Session tokens are random and only a SHA-256 hash is stored, so the database never holds a
        usable token. Cookies are HTTP-only and SameSite=Lax, and are marked Secure in production.
        Sessions expire after 14 days and can be revoked at any time. Sign-in attempts are rate
        limited per account and per IP address.
      </Notice>
    </div>
  );
}
