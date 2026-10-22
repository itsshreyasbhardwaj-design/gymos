import { Skeleton, SkeletonCard } from '@/components/ui';

export default function ProgressLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}
