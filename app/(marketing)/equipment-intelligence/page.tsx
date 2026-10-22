import type { Metadata } from 'next';
import { Badge, Card, LinkButton, Notice, PageHeader, Section } from '@/components/ui';
import { EQUIPMENT_CATALOG, EQUIPMENT_CATEGORY_LABELS, EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import { EXERCISE_CATALOG } from '@/lib/content/exercises';
import { expandEquipment, checkEquipment } from '@/lib/engines/equipment';

export const metadata: Metadata = {
  title: 'Equipment Intelligence',
  description: 'How GymOS models equipment and why it never prescribes something you cannot do.',
};

export default function EquipmentIntelligencePage() {
  const coverage = Object.entries(EQUIPMENT_PRESETS).map(([key, preset]) => {
    const set = expandEquipment(preset.ids);
    const usable = EXERCISE_CATALOG.filter((ex) => checkEquipment(ex, set).ok).length;
    return {
      key,
      label: preset.label,
      description: preset.description,
      items: preset.ids.length,
      usable,
      pct: Math.round((usable / EXERCISE_CATALOG.length) * 100),
    };
  });

  const byCategory = Object.entries(EQUIPMENT_CATEGORY_LABELS).map(([id, label]) => ({
    id,
    label,
    items: EQUIPMENT_CATALOG.filter((e) => e.category === id),
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 space-y-14">
      <PageHeader
        eyebrow="Equipment DNA"
        title="Your equipment decides which exercises exist"
        description="Most apps treat equipment as a tag. GymOS treats it as a constraint that the planner must satisfy before anything else."
      />

      <Section
        title="How a requirement is modelled"
        description="Each exercise carries requirement groups. Within a group any one item will do; every group must be satisfied."
      >
        <Card className="p-5 space-y-4 text-sm leading-relaxed">
          <div>
            <p className="font-medium">Barbell bench press</p>
            <p className="text-[var(--text-muted)] mt-1">
              Needs <strong>barbell</strong>, and <strong>weight plates</strong>, and{' '}
              <strong>a flat or adjustable bench</strong>, and <strong>a rack</strong>. Four groups,
              all required.
            </p>
          </div>
          <div>
            <p className="font-medium">Single-arm dumbbell row</p>
            <p className="text-[var(--text-muted)] mt-1">
              Needs one group: <strong>dumbbells or adjustable dumbbells or a kettlebell</strong>. A
              bench is listed as optional — nice to have, never a blocker.
            </p>
          </div>
          <div>
            <p className="font-medium">Push-up</p>
            <p className="text-[var(--text-muted)] mt-1">
              Zero groups. Always available, and the mat is optional.
            </p>
          </div>
          <div>
            <p className="font-medium">Power rack implies a squat rack and a pull-up bar</p>
            <p className="text-[var(--text-muted)] mt-1">
              Equipment can provide other equipment, so you do not have to tick every box by hand.
            </p>
          </div>
        </Card>
      </Section>

      <Section
        title="What each setup actually unlocks"
        description={`Measured against the ${EXERCISE_CATALOG.length}-exercise library, right now, by running the real compatibility engine.`}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {coverage.map((c) => (
            <Card key={c.key} className="p-5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold">{c.label}</p>
                <span className="text-sm tabular-nums text-[var(--accent)]">{c.pct}%</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">{c.description}</p>
              <div className="mt-3 h-2 rounded-full bg-[var(--surface-sunken)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${c.pct}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2 tabular-nums">
                {c.items} items · {c.usable} of {EXERCISE_CATALOG.length} exercises
              </p>
            </Card>
          ))}
        </div>
        <Notice tone="neutral">
          Bodyweight training covers far less of the library than a commercial gym, and GymOS says
          so. That is the point: knowing a gap exists is more useful than being told everything has
          an equal substitute.
        </Notice>
      </Section>

      <Section title="The catalog" description={`${EQUIPMENT_CATALOG.length} items, grouped the way a gym floor is.`}>
        <div className="space-y-4">
          {byCategory.map((cat) => (
            <Card key={cat.id} className="p-5">
              <p className="font-semibold text-sm mb-3">{cat.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {cat.items.map((item) => (
                  <Badge key={item.id} tone="neutral">
                    {item.name}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="GymScan">
        <Notice tone="warn" title="Photo recognition is not implemented">
          GymOS ships no image-recognition model, so it does not offer to analyse a photo of your
          gym. Setting up a profile is search, browse by category, pick a preset, or add a custom
          item. The data model and the review flow a recognition feature would need are in place;
          the recognition itself is not, and nothing in the interface suggests otherwise.
        </Notice>
      </Section>

      <div className="flex flex-wrap gap-3">
        <LinkButton href="/signup" size="lg">
          Set up my equipment
        </LinkButton>
        <LinkButton href="/workout-planning" variant="secondary" size="lg">
          How plans are built
        </LinkButton>
      </div>
    </div>
  );
}
