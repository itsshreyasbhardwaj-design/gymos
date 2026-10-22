import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, Plus } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { listGymProfiles, activeEquipmentSet } from '@/lib/services/equipment';
import { evaluate } from '@/lib/services/entitlements';
import { EXERCISE_CATALOG } from '@/lib/content/exercises';
import { checkEquipment, expandEquipment } from '@/lib/engines/equipment';
import { equipmentSetForProfile } from '@/lib/services/equipment';
import { EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import {
  Badge,
  Card,
  CardHeader,
  LinkButton,
  Notice,
  PageHeader,
  ProgressBar,
} from '@/components/ui';
import { NewProfileForm, ActivateProfileButton } from '@/components/equipment-forms';

export const metadata: Metadata = { title: 'Equipment' };

export default async function EquipmentPage() {
  const user = await requireUser();
  const profiles = listGymProfiles(user.id);
  const active = activeEquipmentSet(user.id);
  const entitlement = evaluate(user.plan, user.id, 'gym_profiles');

  const withCoverage = profiles.map((p) => {
    const set = equipmentSetForProfile(p.id);
    const usable = EXERCISE_CATALOG.filter((ex) => checkEquipment(ex, set).ok).length;
    return { ...p, usable, pct: Math.round((usable / EXERCISE_CATALOG.length) * 100) };
  });

  const bodyweightOnly = EXERCISE_CATALOG.filter(
    (ex) => checkEquipment(ex, expandEquipment([])).ok,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Equipment DNA"
        title="Your equipment"
        description="Every plan is filtered against the active profile. Nothing will be prescribed that you cannot actually do."
      />

      <Card>
        <CardHeader
          title="Active location"
          subtitle={
            active.profileName
              ? `${active.profileName} — ${active.set.size - 1} item(s) available`
              : 'No profile yet'
          }
          action={<MapPin className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />}
        />
        <div className="px-5 pb-5 space-y-3">
          {withCoverage.map((p) => (
            <div
              key={p.id}
              className={`rounded-xl border p-4 ${p.isActive ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)]'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/equipment/profiles/${p.id}`}
                      className="font-medium hover:text-[var(--accent)]"
                    >
                      {p.name}
                    </Link>
                    {p.isActive ? <Badge tone="brand">Active</Badge> : null}
                    <Badge tone="neutral">{p.environment.replace(/_/g, ' ')}</Badge>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {p.equipmentCount} item(s) · unlocks {p.usable} of {EXERCISE_CATALOG.length}{' '}
                    exercises
                  </p>
                  {p.notes ? (
                    <p className="text-xs text-[var(--text-muted)] mt-1">{p.notes}</p>
                  ) : null}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {!p.isActive ? <ActivateProfileButton profileId={p.id} /> : null}
                  <LinkButton href={`/equipment/profiles/${p.id}`} variant="ghost" size="sm">
                    Edit
                  </LinkButton>
                </div>
              </div>
              <div className="mt-3">
                <ProgressBar value={p.pct} label={`${p.name} exercise coverage`} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Add another location"
          subtitle={
            entitlement.allowed
              ? `${entitlement.current ?? 0} of ${entitlement.limit ?? '∞'} profiles used.`
              : (entitlement.reason ?? '')
          }
          action={<Plus className="h-5 w-5" aria-hidden="true" />}
        />
        <div className="px-5 pb-5">
          {entitlement.allowed ? (
            <NewProfileForm
              presets={Object.entries(EQUIPMENT_PRESETS).map(([key, p]) => ({
                key,
                label: p.label,
                items: p.ids.length,
              }))}
            />
          ) : (
            <Notice tone="warn">
              {entitlement.reason} <Link className="underline" href="/pricing">See plans</Link>
            </Notice>
          )}
        </div>
      </Card>

      <Notice tone="neutral" title="If you have nothing at all">
        Bodyweight-only still unlocks {bodyweightOnly} of {EXERCISE_CATALOG.length} exercises. GymOS
        will tell you plainly which movement patterns it cannot cover, and the cheapest way to
        unlock them, rather than pretending a substitute exists.
      </Notice>

      <Notice tone="warn" title="Photo recognition is not available">
        GymOS ships no image-recognition model, so there is no &ldquo;scan my gym&rdquo; feature.
        Use the presets, search or add a custom item.
      </Notice>
    </div>
  );
}
