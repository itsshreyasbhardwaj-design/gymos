'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Home,
  Dumbbell,
  Boxes,
  BookOpen,
  UtensilsCrossed,
  LineChart,
  CalendarDays,
  Brain,
  Settings,
  Menu,
  X,
  ShieldCheck,
  Sparkles,
  Shirt,
  Mic,
  Droplets,
  ClipboardCheck,
  NotebookPen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/ui/cn';
import { Badge } from '@/components/ui';
import { ThemeToggle } from '@/components/theme';

/**
 * Navigation is grouped rather than flat because the personal-care modules would
 * otherwise bury training behind a fourteen-item list. `primary` still drives the
 * four-slot mobile bottom bar, which stays on training — the thing people open the
 * app to do.
 */
interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  primary: boolean;
}

const NAV_GROUPS: { section: string | null; items: NavItem[] }[] = [
  {
    section: null,
    items: [
      { href: '/dashboard', label: 'Today', icon: Home, primary: true },
      { href: '/workouts', label: 'Workouts', icon: Dumbbell, primary: true },
      { href: '/equipment', label: 'Equipment', icon: Boxes, primary: false },
      { href: '/exercises', label: 'Exercises', icon: BookOpen, primary: false },
      { href: '/nutrition', label: 'Nutrition', icon: UtensilsCrossed, primary: true },
      { href: '/progress', label: 'Progress', icon: LineChart, primary: true },
      { href: '/calendar', label: 'Calendar', icon: CalendarDays, primary: false },
    ],
  },
  {
    section: 'Personal care',
    items: [
      { href: '/wellness', label: 'Wellness', icon: Sparkles, primary: false },
      { href: '/grooming', label: 'Grooming', icon: NotebookPen, primary: false },
      { href: '/skincare', label: 'Skincare', icon: Droplets, primary: false },
      { href: '/wardrobe', label: 'Wardrobe', icon: Shirt, primary: false },
      { href: '/voice', label: 'Voice', icon: Mic, primary: false },
      { href: '/hygiene', label: 'Hygiene', icon: ClipboardCheck, primary: false },
      { href: '/reviews', label: 'Reviews', icon: ClipboardCheck, primary: false },
    ],
  },
  {
    section: null,
    items: [
      { href: '/fitbrain', label: 'FitBrain', icon: Brain, primary: false },
      { href: '/settings', label: 'Settings', icon: Settings, primary: false },
    ],
  },
];

const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function AppShell({
  user,
  accessibility,
  unreadCount,
  children,
}: {
  user: {
    displayName: string;
    email: string;
    plan: 'free' | 'pro';
    role: 'user' | 'admin';
    ageBand: string;
  };
  accessibility: { reduceMotion?: boolean; largeText?: boolean; highContrast?: boolean };
  unreadCount: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // The stored accessibility preferences are applied to the document, so they affect
  // everything including portals and third-party chart SVGs.
  useEffect(() => {
    const root = document.documentElement;
    if (accessibility.reduceMotion) root.setAttribute('data-motion', 'reduced');
    else root.removeAttribute('data-motion');
    if (accessibility.largeText) root.setAttribute('data-text', 'large');
    else root.removeAttribute('data-text');
    if (accessibility.highContrast) root.setAttribute('data-contrast', 'high');
    else root.removeAttribute('data-contrast');
  }, [accessibility]);

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      {/* ------------------------------------------------------------ sidebar */}
      <aside className="hidden lg:flex flex-col border-r border-[var(--border)] bg-[var(--surface-sunken)] sticky top-0 h-dvh">
        <div className="h-16 flex items-center px-5 border-b border-[var(--border)]">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden="true"
              className="h-7 w-7 rounded-lg bg-ink-900 dark:bg-ink-100 grid place-items-center"
            >
              <span className="h-1.5 w-4 rounded-full bg-[var(--accent)]" />
            </span>
            GymOS
          </Link>
          {user.plan === 'pro' ? (
            <Badge tone="brand" className="ml-auto">
              Pro
            </Badge>
          ) : null}
        </div>
        <nav className="flex-1 overflow-y-auto p-3" aria-label="Main">
          <ul className="space-y-0.5">
            {NAV_GROUPS.map((group, groupIndex) => (
              <li key={group.section ?? `group-${groupIndex}`}>
                {group.section ? (
                  <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {group.section}
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={isActive(item.href) ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                            isActive(item.href)
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
                              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]',
                          )}
                        >
                          <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {user.role === 'admin' ? (
              <li>
                <Link
                  href="/admin/content"
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    pathname.startsWith('/admin')
                      ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]',
                  )}
                >
                  <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
                  Content admin
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
        <div className="p-3 border-t border-[var(--border)] space-y-3">
          <ThemeToggle className="w-full justify-center" />
          <div className="px-2">
            <p className="text-sm font-medium truncate">{user.displayName}</p>
            <p className="text-xs text-[var(--text-muted)] truncate">{user.email}</p>
          </div>
        </div>
      </aside>

      {/* --------------------------------------------------------------- main */}
      <div className="flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-4 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            GymOS
          </Link>
          {user.plan === 'pro' ? <Badge tone="brand">Pro</Badge> : null}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="ml-auto h-10 w-10 grid place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
            aria-expanded={menuOpen}
            aria-controls="app-menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
          </button>
        </header>

        {menuOpen ? (
          <nav
            id="app-menu"
            className="lg:hidden border-b border-[var(--border)] bg-[var(--surface)] p-3 grid gap-0.5"
            aria-label="All sections"
          >
            {NAV_GROUPS.map((group, groupIndex) => (
              <div key={group.section ?? `group-${groupIndex}`} className="grid gap-0.5">
                {group.section ? (
                  <p className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {group.section}
                  </p>
                ) : null}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm',
                        isActive(item.href)
                          ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
                          : 'hover:bg-[var(--surface-sunken)]',
                      )}
                    >
                      <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
            {user.role === 'admin' ? (
              <Link
                href="/admin/content"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-[var(--surface-sunken)]"
              >
                <ShieldCheck className="h-4.5 w-4.5" aria-hidden="true" />
                Content admin
              </Link>
            ) : null}
            <div className="pt-2">
              <ThemeToggle />
            </div>
          </nav>
        ) : null}

        <main id="main" className="flex-1 px-4 sm:px-6 py-6 pb-24 lg:pb-10 max-w-5xl w-full">
          {children}
        </main>

        {/* ------------------------------------------------- mobile bottom nav */}
        <nav
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
          aria-label="Primary"
        >
          <ul className="grid grid-cols-4">
            {NAV.filter((n) => n.primary).map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors',
                      active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    {item.label}
                    {item.href === '/dashboard' && unreadCount > 0 ? (
                      <span className="sr-only">{unreadCount} unread notifications</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
