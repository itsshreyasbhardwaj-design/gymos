import type { Metadata } from 'next';
import Link from 'next/link';
import { User, ShieldCheck, Lock, CreditCard, LogOut } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getProfile } from '@/lib/services/account';
import { Badge, Button, Card, PageHeader } from '@/components/ui';
import { logoutAction } from '@/app/(auth)/actions';

export const metadata: Metadata = { title: 'Settings' };

const SECTIONS = [
  { href: '/settings/profile', icon: User, title: 'Profile and training', body: 'Name, age band, experience, days, session length, limitations and accessibility.' },
  { href: '/settings/privacy', icon: ShieldCheck, title: 'Privacy and data', body: 'Consents, data export, biometric records and account deletion.' },
  { href: '/settings/security', icon: Lock, title: 'Security', body: 'Password and signed-in sessions.' },
  { href: '/settings/subscription', icon: CreditCard, title: 'Plan and billing', body: 'What your plan includes and what is enforced on the server.' },
];

export default async function SettingsPage() {
  const user = await requireUser();
  const profile = getProfile(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={`Signed in as ${user.email}`}
        action={<Badge tone={user.plan === 'pro' ? 'brand' : 'neutral'}>{user.plan === 'pro' ? 'Pro' : 'Free'}</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}>
              <Card className="p-5 h-full hover:border-[var(--border-strong)] transition-colors">
                <Icon className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
                <h2 className="font-semibold mt-3">{s.title}</h2>
                <p className="text-sm text-[var(--text-muted)] mt-1 leading-relaxed">{s.body}</p>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card className="p-5">
        <p className="text-sm font-medium">Account</p>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          {profile?.displayName} · {profile?.ageBand.replace(/_/g, ' ')} · {profile?.timezone}
        </p>
        <form action={logoutAction} className="mt-4">
          <Button type="submit" variant="secondary">
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </Card>
    </div>
  );
}
