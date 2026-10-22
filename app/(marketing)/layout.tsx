import Link from 'next/link';
import { ThemeToggle } from '@/components/theme';
import { LinkButton } from '@/components/ui';
import { getSessionUser } from '@/lib/auth/session';
import { MarketingNav } from '@/components/marketing-nav';

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/equipment-intelligence', label: 'Equipment' },
  { href: '/workout-planning', label: 'Workouts' },
  { href: '/nutrition-planning', label: 'Nutrition' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
];

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="min-h-dvh flex flex-col">
      <MarketingNav items={NAV} signedIn={Boolean(user)} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t border-[var(--border)] mt-20">
        <div className="mx-auto max-w-6xl px-4 py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-semibold tracking-tight">GymOS</p>
            <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
              Fitness that fits real life. One app for your equipment, your workouts, your meals
              and your progress.
            </p>
            <div className="mt-4">
              <ThemeToggle />
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold mb-3">Product</p>
            <ul className="space-y-2 text-sm text-[var(--text-muted)]">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link className="hover:text-[var(--text)]" href={item.href}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold mb-3">Legal & support</p>
            <ul className="space-y-2 text-sm text-[var(--text-muted)]">
              <li>
                <Link className="hover:text-[var(--text)]" href="/privacy">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link className="hover:text-[var(--text)]" href="/terms">
                  Terms of service
                </Link>
              </li>
              <li>
                <Link className="hover:text-[var(--text)]" href="/contact">
                  Contact
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold mb-3">Get started</p>
            <div className="flex flex-col gap-2">
              <LinkButton href="/signup" size="sm">
                Build my fitness plan
              </LinkButton>
              <LinkButton href="/login" variant="secondary" size="sm">
                Sign in
              </LinkButton>
            </div>
          </div>
        </div>
        <div className="border-t border-[var(--border)]">
          <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-[var(--text-muted)] space-y-2">
            <p>
              GymOS provides general fitness and food-planning information. It is not medical,
              physiotherapy or dietetic advice and cannot diagnose anything. Talk to a qualified
              professional before starting a new programme, and stop if something hurts.
            </p>
            <p>
              Exercise and recipe content in this build is an internal draft awaiting review by
              qualified professionals. Payments are not enabled. No wearable or health-platform
              integration is connected.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
