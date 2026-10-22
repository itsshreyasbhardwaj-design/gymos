import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSharedGroceryList } from '@/lib/services/nutrition';
import { Card, CardHeader } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Shared grocery list',
  robots: { index: false, follow: false },
};

/**
 * Read-only public view of a shared grocery list. It exposes only item names,
 * quantities and whether they are ticked — no account details, no meal plan.
 */
export default async function SharedListPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const list = getSharedGroceryList(token);
  if (!list) notFound();

  const grouped = new Map<string, typeof list.items>();
  for (const item of list.items) {
    const existing = grouped.get(item.categoryLabel) ?? [];
    existing.push(item);
    grouped.set(item.categoryLabel, existing);
  }

  return (
    <div className="min-h-dvh px-4 py-10">
      <main id="main" className="mx-auto max-w-xl space-y-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--accent-2)] font-semibold">
            Shared from GymOS
          </p>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">{list.name}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Read-only. {list.items.length} item(s).
          </p>
        </div>
        {[...grouped.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, items]) => (
            <Card key={category}>
              <CardHeader title={category} />
              <ul className="px-5 pb-5 space-y-1">
                {items.map((item, i) => (
                  <li
                    key={`${item.name}-${i}`}
                    className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-[var(--border)] last:border-0"
                  >
                    <span className={item.purchased ? 'line-through opacity-60' : ''}>
                      {item.name}
                    </span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {item.quantity ?? ''} {item.unit ?? ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
      </main>
    </div>
  );
}
