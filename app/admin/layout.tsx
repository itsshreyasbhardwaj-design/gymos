import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { Badge } from '@/components/ui';

/**
 * Administrative content area. Access is checked here AND in every page, because a
 * layout is not an authorization boundary on its own.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/dashboard');

  return (
    <div className="min-h-dvh">
      <header className="h-14 border-b border-[var(--border)] flex items-center gap-3 px-4 sm:px-6">
        <Link href="/dashboard" className="font-semibold tracking-tight">
          GymOS
        </Link>
        <Badge tone="warn">Content admin</Badge>
        <nav className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/admin/content" className="hover:text-[var(--accent)]">
            Content
          </Link>
          <Link href="/dashboard" className="text-[var(--text-muted)] hover:text-[var(--text)]">
            Back to app
          </Link>
        </nav>
      </header>
      <main id="main" className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">{children}</main>
    </div>
  );
}
