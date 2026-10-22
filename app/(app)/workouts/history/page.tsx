import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listSessions } from '@/lib/services/sessions';
import { listRevisions } from '@/lib/services/plans';
import { historyWindowStart } from '@/lib/services/progress';
import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Training history' };

export default async function HistoryPage() {
  const user = await requireUser();
  const windowStart = historyWindowStart(user.plan);
  const sessions = listSessions(user.id, { from: windowStart ?? undefined, limit: 200 });
  const revisions = listRevisions(user.id);

  const byMonth = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = s.scheduledDate.slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(s);
    byMonth.set(key, list);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Training history"
        description={
          windowStart
            ? `Your free plan shows the last 30 days (from ${windowStart}). GymOS Pro keeps the full record — nothing is deleted either way.`
            : 'Your complete record.'
        }
        action={
          <LinkButton href="/progress" variant="secondary" size="sm">
            Progress charts
          </LinkButton>
        }
      />

      {sessions.length === 0 ? (
        <EmptyState
          title="No sessions yet"
          description="Your history fills in as you log workouts."
          action={
            <LinkButton href="/workouts">Go to workouts</LinkButton>
          }
        />
      ) : (
        [...byMonth.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([month, list]) => (
            <Card key={month}>
              <CardHeader
                title={new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
                subtitle={`${list.filter((s) => s.status === 'completed').length} completed of ${list.length} scheduled`}
              />
              <div className="px-5 pb-5 space-y-1.5">
                {list.map((s) => (
                  <Link
                    key={s.id}
                    href={`/workouts/session/${s.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 hover:border-[var(--border-strong)]"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.label}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {s.scheduledDate}
                        {s.setCount > 0 ? ` · ${s.setCount} sets` : ''}
                        {s.durationSeconds ? ` · ${Math.round(s.durationSeconds / 60)} min` : ''}
                      </p>
                    </div>
                    <Badge
                      tone={
                        s.status === 'completed' ? 'ok' : s.status === 'skipped' ? 'neutral' : 'brand'
                      }
                    >
                      {s.status.replace('_', ' ')}
                    </Badge>
                  </Link>
                ))}
              </div>
            </Card>
          ))
      )}

      {revisions.length > 0 ? (
        <Card>
          <CardHeader
            title="Plan revisions"
            subtitle="Every RealitySync change is recorded with its reasoning."
          />
          <div className="px-5 pb-5 space-y-2">
            {revisions.slice(0, 15).map((rev) => (
              <details key={rev.id} className="rounded-xl border border-[var(--border)] p-3.5">
                <summary className="cursor-pointer">
                  <span className="text-sm font-medium">{rev.reason}</span>
                  <span className="block text-xs text-[var(--text-muted)] mt-0.5">
                    {rev.trigger.replace(/_/g, ' ')} · {rev.createdAt.slice(0, 10)} ·{' '}
                    <Badge tone={rev.status === 'accepted' ? 'ok' : 'neutral'}>{rev.status}</Badge>
                  </span>
                </summary>
                <ul className="mt-3 space-y-1 text-xs text-[var(--text-muted)]">
                  {rev.explanation.map((line, i) => (
                    <li key={i}>• {line}</li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </Card>
      ) : null}

      <Notice tone="neutral">
        Completed workouts are immutable. Regenerating a plan or accepting an adaptation only ever
        affects sessions you have not done yet.
      </Notice>
    </div>
  );
}
