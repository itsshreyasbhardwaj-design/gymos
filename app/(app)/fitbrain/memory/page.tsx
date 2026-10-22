import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/session';
import { listMemory } from '@/lib/services/fitbrain';
import { EXERCISE_BY_ID } from '@/lib/content/exercises';
import { Card, CardHeader, EmptyState, Notice, PageHeader } from '@/components/ui';
import { MemoryControls } from '@/components/memory-controls';

export const metadata: Metadata = { title: 'FitBrain memory' };

export default async function MemoryPage() {
  const user = await requireUser();
  const memory = listMemory(user.id).filter((m) => m.key !== 'fitbrain_usage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="What FitBrain remembers"
        description="Every preference GymOS has stored about you, and a way to delete any of it."
      />

      {memory.length === 0 ? (
        <EmptyState
          title="Nothing remembered yet"
          description="Mark an exercise as a favourite, or tell FitBrain you dislike something, and it will appear here."
        />
      ) : (
        memory.map((item) => {
          const values = Array.isArray(item.value) ? (item.value as string[]) : null;
          return (
            <Card key={item.key}>
              <CardHeader
                title={item.label}
                subtitle={`Source: ${item.source} · updated ${item.updatedAt.slice(0, 10)}`}
              />
              <div className="px-5 pb-5">
                <MemoryControls
                  memoryKey={item.key}
                  values={
                    values
                      ? values.map((v) => ({ id: v, label: EXERCISE_BY_ID.get(v)?.name ?? v }))
                      : null
                  }
                  rawValue={values ? null : JSON.stringify(item.value)}
                />
              </div>
            </Card>
          );
        })
      )}

      <Notice tone="neutral">
        These preferences feed the workout generator directly: favourites are preferred when it has
        a choice, and anything you avoid is excluded as a hard filter. Deleting an entry takes
        effect on the next plan you generate.
      </Notice>
    </div>
  );
}
