import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listWardrobeItems, wardrobeGaps, wardrobeStats } from '@/lib/services/wardrobe';
import { evaluate } from '@/lib/services/entitlements';
import { getConsent } from '@/lib/services/account';
import {
  Badge,
  BulletList,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Notice,
  PageHeader,
  Stat,
} from '@/components/ui';
import { WardrobeGrid, WardrobeItemForm } from '@/components/wardrobe-forms';

export const metadata: Metadata = { title: 'Wardrobe' };

export default async function WardrobePage() {
  const user = await requireUser();
  const items = listWardrobeItems(user.id, { includeArchived: true });
  const stats = wardrobeStats(user.id);
  const gaps = wardrobeGaps(user.id);
  const entitlement = evaluate(user.plan, user.id, 'wardrobe_items');

  // Photos are optional everywhere in Style OS. Decide honestly why they are off.
  const mediaEntitlement = evaluate(user.plan, user.id, 'media_assets');
  const adult = user.ageBand === 'adult_18_plus';
  const consented = getConsent(user.id, 'photo_journal');
  const photoUpload = {
    enabled: adult && consented && mediaEntitlement.allowed,
    reason: !adult
      ? 'Photo storage is only available on 18+ accounts, because GymOS has no verified parental-consent mechanism.'
      : !consented
        ? 'The private photo journal is switched off in Settings → Media privacy.'
        : (mediaEntitlement.reason ??
          'Your private media allowance is full, so no new photo can be stored.'),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Style OS"
        title="Wardrobe"
        description="A list of the clothes you own, in your own words. GymOS uses it to suggest combinations by colour, formality and weather."
        action={
          <LinkButton href="/wardrobe/outfits" variant="secondary">
            Outfit suggestions
          </LinkButton>
        }
      />

      <Notice tone="neutral" title="What this does and does not do">
        Every field here is something you typed, including colour, formality and warmth — GymOS
        measures nothing itself. It does not rate your appearance, grade a body shape, estimate body
        fat, or judge how anything looks on you: suggestions are about colour harmony, the formality
        level you set and the weather. Photographs are optional and only ever shown back to you.
      </Notice>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Items" value={stats.total} />
        <Stat label="Never worn yet" value={stats.neverWorn} />
        <Stat label="In the wash" value={stats.needingCare} />
        <Stat label="Stored away" value={stats.archived} />
      </div>

      {!entitlement.allowed ? (
        <Notice tone="warn" title="Your wardrobe allowance is full">
          {entitlement.reason ?? 'You have reached the number of items your plan allows.'} Existing
          items still work, including suggestions and planning.
        </Notice>
      ) : null}

      {gaps.length > 0 ? (
        <Card>
          <CardHeader
            title="What this list cannot cover yet"
            subtitle="Facts about the list of clothes, not about you. Nothing here is a recommendation to buy anything."
          />
          <div className="px-5 pb-5">
            <BulletList items={gaps.map((gap) => gap.message)} />
          </div>
        </Card>
      ) : null}

      {entitlement.allowed ? (
        <Card>
          <CardHeader
            title="Add an item"
            subtitle="Only the name and the kind of garment are required."
          />
          <div className="px-5 pb-5">
            <WardrobeItemForm photoUpload={photoUpload} />
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Your wardrobe"
          // The grid below is loaded with includeArchived, so the subtitle has to
          // account for the stored-away items it shows too.
          subtitle={
            stats.archived > 0
              ? `${stats.total} active ${stats.total === 1 ? 'item' : 'items'}, plus ${stats.archived} stored away and listed below.`
              : `${stats.total} active ${stats.total === 1 ? 'item' : 'items'}.`
          }
        />
        <div className="px-5 pb-5">
          {items.length === 0 ? (
            <EmptyState
              title="Nothing recorded yet"
              description="Add a few items — a couple of tops, bottoms and a pair of shoes is enough for GymOS to start suggesting combinations."
            />
          ) : (
            <WardrobeGrid
              items={items.map((item) => ({
                id: item.id,
                name: item.name,
                category: item.category,
                slot: item.slot,
                colors: item.colors,
                unrecognisedColors: item.unrecognisedColors,
                fabric: item.fabric,
                sizeLabel: item.sizeLabel,
                occasionTags: item.occasionTags,
                seasonTags: item.seasonTags,
                formality: item.formality,
                warmth: item.warmth,
                favourite: item.favourite,
                needsCare: item.needsCare,
                timesWorn: item.timesWorn,
                lastWornAt: item.lastWornAt,
                archived: item.archived,
                assetId: item.assetId,
                notes: item.notes,
              }))}
            />
          )}
        </div>
      </Card>

      <p className="text-sm text-[var(--text-muted)]">
        Next:{' '}
        <Link href="/wardrobe/outfits" className="underline">
          build outfits
        </Link>{' '}
        or{' '}
        <Link href="/wardrobe/planner" className="underline">
          plan your week
        </Link>
        . <Badge tone="neutral">Works with no photos at all</Badge>
      </p>
    </div>
  );
}
