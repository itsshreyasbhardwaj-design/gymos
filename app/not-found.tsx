import Link from 'next/link';
import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <div className="text-center max-w-md">
        <p className="text-sm font-semibold uppercase tracking-widest text-[var(--accent-2)]">
          404
        </p>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">Nothing here</h1>
        <p className="text-[var(--text-muted)] mt-2">
          That page does not exist. It may have been removed, or the link may be wrong.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <LinkButton href="/dashboard">Go to Today</LinkButton>
          <Link href="/">
            <span className="inline-flex h-11 items-center px-4 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
              Home
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
