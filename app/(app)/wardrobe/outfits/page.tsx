import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listOutfits, suggestOutfitsFor, wardrobeGaps } from '@/lib/services/wardrobe';
import {
  BulletList,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Notice,
  PageHeader,
} from '@/components/ui';
import {
  GenerateHint,
  SavedOutfitList,
  SuggestionControls,
  SuggestionList,
} from '@/components/outfit-builder';

export const metadata: Metadata = { title: 'Outfits' };

export default async function OutfitsPage({
  searchParams,
}: {
  searchParams: Promise<{ occasion?: string; weather?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const { occasion, weather, suggestions } = suggestOutfitsFor(user.id, {
    occasion: params.occasion,
    weather: params.weather,
    limit: 4,
  });
  const saved = listOutfits(user.id);
  const gaps = wardrobeGaps(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Style OS"
        title="Outfit suggestions"
        description="Combinations built from the clothes you recorded, scored on colour harmony, the formality level you set and how warm each piece is."
        action={
          <LinkButton href="/wardrobe" variant="secondary">
            Back to wardrobe
          </LinkButton>
        }
      />

      <Notice tone="neutral" title="How these are chosen">
        Three inputs only: the colour names you typed, matched against a fixed colour table using
        standard colour-wheel relationships; the 1-5 formality level you set per item; and the
        warmth level you set per item against the weather band you pick. No photograph is read, no
        body shape is considered and nothing here judges how an outfit looks on you. Everything
        runs on your own machine with no internet connection and no shopping service.
      </Notice>

      <Card>
        <CardHeader title="Pick an occasion and the weather" />
        <div className="px-5 pb-5 space-y-3">
          <SuggestionControls occasion={occasion} weather={weather} />
          <GenerateHint />
        </div>
      </Card>

      {suggestions.length === 0 ? (
        <Card>
          <CardHeader
            title="Not enough recorded to build an outfit"
            subtitle="GymOS needs at least a top and a bottom, or a one-piece garment, within two steps of this occasion's formality level."
          />
          <div className="px-5 pb-5 space-y-3">
            {gaps.length > 0 ? <BulletList items={gaps.map((gap) => gap.message)} /> : null}
            <p className="text-sm text-[var(--text-muted)]">
              Add a few more items in your{' '}
              <Link href="/wardrobe" className="underline">
                wardrobe
              </Link>{' '}
              and come back.
            </p>
          </div>
        </Card>
      ) : (
        <SuggestionList suggestions={suggestions} occasion={occasion} />
      )}

      <Card>
        <CardHeader
          title="Saved combinations"
          subtitle="Yours to assign to a day in the planner."
          action={
            <LinkButton href="/wardrobe/planner" variant="secondary" size="sm">
              Planner
            </LinkButton>
          }
        />
        <div className="px-5 pb-5">
          {saved.length === 0 ? (
            <EmptyState
              title="Nothing saved yet"
              description="Save a suggestion above and it will appear here, together with the explanation it came with."
            />
          ) : (
            <SavedOutfitList
              outfits={saved.map((outfit) => ({
                id: outfit.id,
                name: outfit.name,
                occasion: outfit.occasion,
                source: outfit.source,
                rationale: outfit.rationale,
                favourite: outfit.favourite,
                timesWorn: outfit.timesWorn,
                lastWornAt: outfit.lastWornAt,
                items: outfit.items.map((item) => ({
                  id: item.id,
                  name: item.name,
                  category: item.category,
                })),
                missingItemIds: outfit.missingItemIds,
              }))}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
