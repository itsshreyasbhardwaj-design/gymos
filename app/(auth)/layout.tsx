import Link from 'next/link';
import { ThemeToggle } from '@/components/theme';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="h-16 flex items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="h-7 w-7 rounded-lg bg-ink-900 dark:bg-ink-100 grid place-items-center"
          >
            <span className="h-1.5 w-4 rounded-full bg-[var(--accent)]" />
          </span>
          GymOS
        </Link>
        <ThemeToggle />
      </header>
      <main id="main" className="flex-1 grid place-items-center px-4 py-10">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
        <Link href="/privacy" className="hover:text-[var(--text)]">
          Privacy
        </Link>
        <span className="mx-2">·</span>
        <Link href="/terms" className="hover:text-[var(--text)]">
          Terms
        </Link>
      </footer>
    </div>
  );
}
