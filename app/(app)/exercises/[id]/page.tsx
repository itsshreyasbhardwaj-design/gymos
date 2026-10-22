import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ImageOff, TriangleAlert } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { activeEquipmentSet } from '@/lib/services/equipment';
import { getPreference, loadPlanningProfile } from '@/lib/services/plans';
import { exerciseHistory } from '@/lib/services/progress';
import { EXERCISE_BY_ID, EXERCISE_SOURCES } from '@/lib/content/exercises';
import { MOVEMENT_PATTERN_LABELS, MUSCLE_LABELS } from '@/lib/content/exercise-types';
import {
  checkEquipment,
  describeMissing,
  equipmentRequirementSummary,
} from '@/lib/engines/equipment';
import { findSubstitutes } from '@/lib/engines/substitution';
import { buildLimitationFilter, isAgeAppropriate, isLevelAppropriate } from '@/lib/engines/programming';
import {
  Badge,
  BulletList,
  Card,
  CardHeader,
  KeyValue,
  Notice,
  PageHeader,
  ReviewStatusBadge,
} from '@/components/ui';
import { ExercisePreferenceButtons } from '@/components/exercise-preference-buttons';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const ex = EXERCISE_BY_ID.get(id);
  return { title: ex?.name ?? 'Exercise' };
}

export default async function ExerciseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const exercise = EXERCISE_BY_ID.get(id);
  if (!exercise) notFound();

  const equipment = activeEquipmentSet(user.id);
  const profile = loadPlanningProfile(user.id);
  const check = checkEquipment(exercise, equipment.set);
  const lim = buildLimitationFilter(profile.limitations);
  const favourites = getPreference<string[]>(user.id, 'favourite_exercises', []);
  const disliked = getPreference<string[]>(user.id, 'disliked_exercises', []);
  const history = exerciseHistory(user.id, id, user.plan);

  const subs = findSubstitutes(exercise, {
    availableEquipment: equipment.set,
    ageBand: profile.ageBand,
    level: profile.experience,
    excludedExerciseIds: new Set([...lim.excludedExerciseIds, ...disliked]),
    excludedPatterns: lim.excludedPatterns,
  });

  const source = EXERCISE_SOURCES.find((s) => s.id === 'internal-draft-2026');
  const ageOk = isAgeAppropriate(exercise, profile.ageBand);
  const levelOk = isLevelAppropriate(exercise, profile.experience, profile.ageBand);
  const excludedByLimitation =
    lim.excludedExerciseIds.has(exercise.id) || lim.excludedPatterns.has(exercise.pattern);

  const related = [
    ...(exercise.prog ?? []).map((rid) => ({ id: rid, kind: 'Progression' })),
    ...(exercise.regr ?? []).map((rid) => ({ id: rid, kind: 'Regression' })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={MOVEMENT_PATTERN_LABELS[exercise.pattern]}
        title={exercise.name}
        description={
          exercise.alias?.length ? `Also known as: ${exercise.alias.join(', ')}` : undefined
        }
        action={
          <ExercisePreferenceButtons
            exerciseId={exercise.id}
            isFavourite={favourites.includes(exercise.id)}
            isDisliked={disliked.includes(exercise.id)}
          />
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone={check.ok ? 'ok' : 'warn'}>
          {check.ok ? 'Works with your equipment' : 'Equipment missing'}
        </Badge>
        <Badge tone="neutral">{exercise.cat}</Badge>
        <Badge tone="neutral">{exercise.level.replace('_', ' ')}</Badge>
        <ReviewStatusBadge status="draft" />
        {!ageOk ? <Badge tone="warn">Not used for your age band</Badge> : null}
        {!levelOk ? <Badge tone="warn">Above your experience level</Badge> : null}
        {excludedByLimitation ? <Badge tone="warn">Excluded by your limitations</Badge> : null}
      </div>

      {!check.ok ? (
        <Notice tone="warn" title="You cannot do this one right now">
          It needs {describeMissing(check)}, which is not in your {equipment.profileName ?? 'active'}{' '}
          profile. GymOS will not put it in your plan.{' '}
          <Link className="underline" href="/equipment">
            Update your equipment
          </Link>
        </Notice>
      ) : null}

      {excludedByLimitation ? (
        <Notice tone="warn" title="Left out because of a limitation you recorded">
          {lim.notes.join(' ')} You can still perform it yourself if you choose — GymOS simply will
          not prescribe it.
        </Notice>
      ) : null}

      <Card>
        <CardHeader title="How to do it" subtitle="Internal draft — awaiting professional review." />
        <div className="px-5 pb-5 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
              Set-up
            </p>
            <BulletList items={exercise.setup} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
              Movement
            </p>
            <ol className="space-y-2 text-sm leading-relaxed list-decimal pl-5">
              {exercise.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
          {exercise.cues?.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
                Technique cues
              </p>
              <BulletList items={exercise.cues} />
            </div>
          ) : null}
          {exercise.safety?.length ? (
            <Notice tone="warn" title="Safety">
              <ul className="space-y-1">
                {exercise.safety.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Demonstration" />
        <div className="px-5 pb-5">
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] p-8 text-center">
            <ImageOff className="h-8 w-8 mx-auto text-[var(--text-muted)]" aria-hidden="true" />
            <p className="text-sm font-medium mt-3">No demonstration media</p>
            <p className="text-sm text-[var(--text-muted)] mt-1 max-w-md mx-auto leading-relaxed">
              GymOS ships no licensed images or video. Rather than show a placeholder that implies
              one exists, this slot stays empty until properly licensed media is added.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Details" />
        <div className="px-5 pb-5">
          <KeyValue
            items={[
              { label: 'Movement pattern', value: MOVEMENT_PATTERN_LABELS[exercise.pattern] },
              {
                label: 'Primary muscles',
                value: exercise.primary.map((m) => MUSCLE_LABELS[m] ?? m).join(', '),
              },
              {
                label: 'Secondary muscles',
                value:
                  (exercise.secondary ?? []).map((m) => MUSCLE_LABELS[m] ?? m).join(', ') || '—',
              },
              { label: 'Equipment', value: equipmentRequirementSummary(exercise).join(', ') },
              { label: 'Experience level', value: exercise.level.replace('_', ' ') },
              { label: 'Logged as', value: exercise.timed ? 'Time' : 'Reps' },
              { label: 'Unilateral', value: exercise.unilateral ? 'Yes — each side' : 'No' },
              { label: 'Can be loaded', value: exercise.loadable === false ? 'No' : 'Yes' },
              { label: 'Suitable for 13-17', value: exercise.teenOk === false ? 'No' : 'Yes' },
              { label: 'Suitable for under 13', value: exercise.childOk ? 'Yes' : 'No' },
            ]}
          />
        </div>
      </Card>

      {history.setCount > 0 ? (
        <Card>
          <CardHeader
            title="Your history"
            subtitle={`${history.setCount} sets logged${user.plan === 'free' ? ' in the last 30 days' : ''}.`}
          />
          <div className="px-5 pb-5 space-y-1.5">
            {history.points.slice(-10).reverse().map((point) => (
              <div
                key={point.date}
                className="flex items-center justify-between gap-3 text-sm py-1.5 border-b border-[var(--border)] last:border-0"
              >
                <span className="text-[var(--text-muted)]">{point.date}</span>
                <span className="tabular-nums">
                  {point.bestWeightKg ? `${point.bestWeightKg} kg · ` : ''}
                  {point.bestReps ? `${point.bestReps} reps` : ''}
                  {point.bestHoldSeconds ? `${point.bestHoldSeconds}s` : ''}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Substitutes you can actually do"
          subtitle="Checked against your equipment, age band, experience and limitations."
        />
        <div className="px-5 pb-5 space-y-2">
          {subs.options.length === 0 ? (
            <Notice tone="warn">
              <span className="inline-flex items-start gap-2">
                <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                {subs.noMatchReason}
              </span>
            </Notice>
          ) : (
            subs.options.map((o) => (
              <Link
                key={o.exercise.id}
                href={`/exercises/${o.exercise.id}`}
                className="block rounded-xl border border-[var(--border)] p-3.5 hover:border-[var(--border-strong)]"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{o.exercise.name}</span>
                  {!o.samePattern ? <Badge tone="warn">partial match</Badge> : null}
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1">{o.reason}</p>
              </Link>
            ))
          )}
        </div>
      </Card>

      {related.length > 0 ? (
        <Card>
          <CardHeader title="Progressions and regressions" />
          <div className="px-5 pb-5 space-y-1.5">
            {related.map((rel) => {
              const target = EXERCISE_BY_ID.get(rel.id);
              if (!target) return null;
              return (
                <Link
                  key={`${rel.kind}-${rel.id}`}
                  href={`/exercises/${rel.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5 text-sm hover:border-[var(--border-strong)]"
                >
                  <span>{target.name}</span>
                  <Badge tone="neutral">{rel.kind}</Badge>
                </Link>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Source and review status
        </p>
        <p className="text-sm text-[var(--text-muted)] leading-relaxed">{source?.citation}</p>
        <p className="text-sm text-[var(--text-muted)] mt-2 leading-relaxed">
          This content has review status <strong>draft</strong>. It is general fitness information,
          not coaching or medical advice, and it has not been reviewed by a qualified professional.
        </p>
      </Card>
    </div>
  );
}
