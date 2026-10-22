import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { activeEquipmentSet } from '@/lib/services/equipment';
import { getPreference, loadPlanningProfile } from '@/lib/services/plans';
import { loggedExerciseIds } from '@/lib/services/progress';
import { EXERCISE_CATALOG } from '@/lib/content/exercises';
import { MOVEMENT_PATTERN_LABELS, MUSCLE_LABELS } from '@/lib/content/exercise-types';
import { checkEquipment, equipmentRequirementSummary } from '@/lib/engines/equipment';
import { isAgeAppropriate, isLevelAppropriate } from '@/lib/engines/programming';
import { Badge, Card, Notice, PageHeader } from '@/components/ui';
import { ExerciseBrowser } from '@/components/exercise-browser';

export const metadata: Metadata = { title: 'Exercises' };

export default async function ExercisesPage() {
  const user = await requireUser();
  const equipment = activeEquipmentSet(user.id);
  const profile = loadPlanningProfile(user.id);
  const favourites = new Set(getPreference<string[]>(user.id, 'favourite_exercises', []));
  const disliked = new Set(getPreference<string[]>(user.id, 'disliked_exercises', []));
  const recentlyPerformed = new Set(loggedExerciseIds(user.id).slice(0, 20).map((r) => r.exerciseId));

  const items = EXERCISE_CATALOG.map((ex) => {
    const check = checkEquipment(ex, equipment.set);
    return {
      id: ex.id,
      name: ex.name,
      pattern: ex.pattern,
      patternLabel: MOVEMENT_PATTERN_LABELS[ex.pattern],
      category: ex.cat,
      level: ex.level,
      primary: ex.primary,
      primaryLabels: ex.primary.map((m) => MUSCLE_LABELS[m] ?? m),
      equipmentSummary: equipmentRequirementSummary(ex),
      available: check.ok,
      ageOk: isAgeAppropriate(ex, profile.ageBand),
      levelOk: isLevelAppropriate(ex, profile.experience, profile.ageBand),
      favourite: favourites.has(ex.id),
      disliked: disliked.has(ex.id),
      performed: recentlyPerformed.has(ex.id),
      aliases: ex.alias ?? [],
    };
  });

  const availableCount = items.filter((i) => i.available).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exercise library"
        description={`${EXERCISE_CATALOG.length} exercises. ${availableCount} work with your ${equipment.profileName ?? 'current'} equipment.`}
      />

      <Notice tone="neutral">
        Instructions in this library are an internal GymOS draft awaiting review by qualified
        professionals. They are general information, not coaching, and no demonstration media
        ships with this build.
      </Notice>

      <ExerciseBrowser
        items={items}
        patterns={Object.entries(MOVEMENT_PATTERN_LABELS).map(([id, label]) => ({ id, label }))}
        muscles={Object.entries(MUSCLE_LABELS).map(([id, label]) => ({ id, label }))}
        profileName={equipment.profileName}
      />
    </div>
  );
}
