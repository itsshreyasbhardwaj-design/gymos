import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { getGymProfile, NotFoundError, equipmentSetForProfile } from '@/lib/services/equipment';
import { EQUIPMENT_CATALOG, EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import { EXERCISE_CATALOG } from '@/lib/content/exercises';
import { MOVEMENT_PATTERN_LABELS } from '@/lib/content/exercise-types';
import { checkEquipment } from '@/lib/engines/equipment';
import { Badge, Card, CardHeader, Notice, PageHeader, Stat } from '@/components/ui';
import {
  ProfileEquipmentForm,
  RenameProfileForm,
  DeleteProfileForm,
  CustomEquipmentForm,
} from '@/components/equipment-forms';

export const metadata: Metadata = { title: 'Equipment profile' };

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let data;
  try {
    data = getGymProfile(user.id, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const set = equipmentSetForProfile(id);
  const usable = EXERCISE_CATALOG.filter((ex) => checkEquipment(ex, set).ok);
  const blocked = EXERCISE_CATALOG.length - usable.length;

  // Which movement patterns this setup genuinely cannot train.
  const patternCoverage = Object.entries(MOVEMENT_PATTERN_LABELS).map(([pattern, label]) => {
    const total = EXERCISE_CATALOG.filter((e) => e.pattern === pattern).length;
    const available = usable.filter((e) => e.pattern === pattern).length;
    return { pattern, label, total, available };
  });
  const gaps = patternCoverage.filter((p) => p.total > 0 && p.available === 0);

  const options = EQUIPMENT_CATALOG.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    categoryLabel: EQUIPMENT_CATEGORY_LABELS[e.category],
    aliases: e.aliases ?? [],
    description: e.description ?? '',
  }));
  const presets = Object.entries(EQUIPMENT_PRESETS).map(([key, p]) => ({
    key,
    label: p.label,
    description: p.description,
    ids: p.ids,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={data.profile.environment.replace(/_/g, ' ')}
        title={data.profile.name}
        description={`${data.items.filter((i) => i.available).length} item(s) available at this location.`}
      />

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Stat label="Items" value={data.items.filter((i) => i.available).length} />
        <Stat label="Exercises unlocked" value={usable.length} tone="brand" />
        <Stat label="Exercises blocked" value={blocked} />
        <Stat label="Patterns with no option" value={gaps.length} tone={gaps.length > 0 ? 'warn' : 'ok'} />
      </div>

      {gaps.length > 0 ? (
        <Notice tone="warn" title="Movement patterns this setup cannot train">
          <p className="mb-2">
            {gaps.map((g) => g.label).join(', ')}. GymOS will leave these slots out of your plan
            rather than substituting something that trains a different thing.
          </p>
        </Notice>
      ) : (
        <Notice tone="ok" title="Every movement pattern has at least one option here">
          Your plans can cover the full range of patterns with this equipment.
        </Notice>
      )}

      <Card>
        <CardHeader
          title="What is here"
          subtitle="Tick everything available at this location. Uncheck anything that is broken or occupied."
        />
        <div className="px-5 pb-5">
          <ProfileEquipmentForm
            profileId={id}
            options={options}
            presets={presets}
            initialSelected={data.items.filter((i) => i.available).map((i) => i.equipmentTypeId)}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Pattern coverage" subtitle="How many exercises this setup unlocks per pattern." />
        <div className="px-5 pb-5 grid gap-2 sm:grid-cols-2">
          {patternCoverage
            .filter((p) => p.total > 0)
            .map((p) => (
              <div
                key={p.pattern}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span className="truncate">{p.label}</span>
                <Badge tone={p.available === 0 ? 'bad' : p.available < 3 ? 'warn' : 'ok'}>
                  {p.available}/{p.total}
                </Badge>
              </div>
            ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Custom equipment" subtitle="For anything the catalog does not cover." />
        <div className="px-5 pb-5">
          <CustomEquipmentForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="Profile details" />
        <div className="px-5 pb-5 space-y-5">
          <RenameProfileForm
            profileId={id}
            name={data.profile.name}
            notes={data.profile.notes}
          />
          <div className="pt-4 border-t border-[var(--border)]">
            <DeleteProfileForm profileId={id} />
          </div>
        </div>
      </Card>
    </div>
  );
}
