import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getProfile, listNotifications } from '@/lib/services/account';
import { AppShell } from '@/components/app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const profile = getProfile(user.id);
  if (!profile?.onboardingCompletedAt) redirect('/onboarding');
  const notifications = listNotifications(user.id, 10);

  return (
    <AppShell
      user={{
        displayName: profile.displayName,
        email: user.email,
        plan: user.plan,
        role: user.role,
        ageBand: profile.ageBand,
      }}
      accessibility={profile.accessibility}
      unreadCount={notifications.filter((n) => !n.readAt).length}
    >
      {children}
    </AppShell>
  );
}
