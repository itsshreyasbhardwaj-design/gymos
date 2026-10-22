'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button, Card, Notice } from '@/components/ui';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side detail is deliberately not surfaced to the browser.
    console.error('GymOS error boundary:', error.message);
  }, [error]);

  const isEntitlement = error.message.toLowerCase().includes('pro');

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <Notice tone={isEntitlement ? 'warn' : 'bad'} className="mt-4">
        {error.message || 'An unexpected error occurred.'}
      </Notice>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dashboard">
          <Button variant="secondary">Back to Today</Button>
        </Link>
        {isEntitlement ? (
          <Link href="/pricing">
            <Button variant="ghost">See plans</Button>
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
