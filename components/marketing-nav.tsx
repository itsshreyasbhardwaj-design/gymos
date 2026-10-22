'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/ui/cn';
import { LinkButton } from '@/components/ui';
import { ThemeToggle } from '@/components/theme';

export function MarketingNav({
  items,
  signedIn,
}: {
  items: { href: string; label: string }[];
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/85 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight shrink-0">
          <span
            aria-hidden="true"
            className="h-7 w-7 rounded-lg bg-ink-900 dark:bg-ink-100 grid place-items-center"
          >
            <span className="h-1.5 w-4 rounded-full bg-[var(--accent)]" />
          </span>
          GymOS
        </Link>

        <nav className="hidden lg:flex items-center gap-1 ml-4" aria-label="Main">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'px-3 py-2 rounded-lg text-sm transition-colors',
                pathname === item.href
                  ? 'text-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          {signedIn ? (
            <LinkButton href="/dashboard" size="sm">
              Open GymOS
            </LinkButton>
          ) : (
            <>
              <LinkButton href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                Sign in
              </LinkButton>
              <LinkButton href="/signup" size="sm">
                Get started
              </LinkButton>
            </>
          )}
          <button
            type="button"
            className="lg:hidden h-10 w-10 grid place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="marketing-menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="marketing-menu"
          className="lg:hidden border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 grid gap-1"
          aria-label="Mobile"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 rounded-lg text-sm hover:bg-[var(--surface-sunken)]"
            >
              {item.label}
            </Link>
          ))}
          <div className="pt-2">
            <ThemeToggle />
          </div>
        </nav>
      ) : null}
    </header>
  );
}
