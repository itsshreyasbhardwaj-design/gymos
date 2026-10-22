import type { Metadata } from 'next';
import { Card, Notice } from '@/components/ui';

export const metadata: Metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <main id="main" className="max-w-md w-full">
        <Card className="p-6 text-center">
          <h1 className="text-xl font-semibold">You are offline</h1>
          <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
            GymOS caches exercise and recipe pages you have already visited, so you can still read
            them here.
          </p>
          <Notice tone="warn" className="mt-4 text-left">
            Logging a workout, saving a plan or changing anything needs a connection. GymOS does
            not claim offline sync it does not have — your logged sets are safe on the server, and
            nothing is lost.
          </Notice>
        </Card>
      </main>
    </div>
  );
}
