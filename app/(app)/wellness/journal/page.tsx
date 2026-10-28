import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getConsent } from '@/lib/services/account';
import {
  listJournalEntries,
  listPhotoCheckins,
  JOURNAL_CATEGORIES,
  MAX_PHOTOS_PER_CHECKIN,
  todayIso,
} from '@/lib/services/journal';
import { Card, CardHeader, Notice, PageHeader } from '@/components/ui';
import {
  JournalEntryForm,
  JournalEntryList,
  PhotoComparison,
} from '@/components/photo-journal';

export const metadata: Metadata = { title: 'Personal journal' };

export default async function JournalPage() {
  const user = await requireUser();
  const isAdult = user.ageBand === 'adult_18_plus';
  const photoConsent = getConsent(user.id, 'photo_journal');
  const photosAllowed = isAdult && photoConsent;

  const photosBlockedReason = !isAdult
    ? 'GymOS does not store photographs for under-18 accounts — it has no verified parental-consent mechanism, so it refuses rather than collecting them under a consent that would not be meaningful. The written journal below is fully yours to use.'
    : 'Photo attachments need the private photo journal turned on in Settings → Media privacy. The written journal works without it.';

  const entries = listJournalEntries(user.id, { limit: 100 });
  const checkins = listPhotoCheckins(user.id, { limit: 60 });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Wellness"
        title="Personal journal"
        description="Your own words, kept for you. Attach your own photographs if you want to look back at them later."
      />

      <Notice tone="neutral" title="No photograph here is analysed">
        GymOS stores your photographs and shows them back to you with their dates. It does not score
        your appearance, rate attractiveness, grade your body shape, estimate body fat from a
        picture, compare you against anyone or any ideal, or diagnose a skin condition. There is no
        automated analysis of any photograph in this build. Every observation you see is one you
        typed yourself.
      </Notice>

      <Card>
        <CardHeader
          title="Write an entry"
          subtitle="One line is enough. Nothing is required and nothing is scored."
        />
        <div className="px-5 pb-5">
          <JournalEntryForm
            categories={[...JOURNAL_CATEGORIES]}
            today={todayIso()}
            photosAllowed={photosAllowed}
            photosBlockedReason={photosBlockedReason}
            maxPhotos={MAX_PHOTOS_PER_CHECKIN}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Compare your own photos over time"
          subtitle="Two of your check-ins, side by side, with their dates. Nothing is computed from the images."
          action={
            <Link href="/wellness/check-ins" className="text-sm underline">
              Check-ins
            </Link>
          }
        />
        <div className="px-5 pb-5">
          <PhotoComparison
            checkins={checkins.map((checkin) => ({
              id: checkin.id,
              date: checkin.date,
              note: checkin.note,
              photos: checkin.photos.map((photo) => ({
                assetId: photo.assetId,
                view: photo.view,
                caption: photo.caption,
              })),
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Your entries"
          subtitle={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, newest first. Each one shows only the photographs attached to it.`}
        />
        <div className="px-5 pb-5">
          <JournalEntryList
            entries={entries.map((entry) => ({
              id: entry.id,
              date: entry.date,
              category: entry.category,
              title: entry.title,
              body: entry.body,
              tags: entry.tags,
              photos: entry.photos.map((photo) => ({
                assetId: photo.assetId,
                date: photo.date,
                view: photo.view,
                caption: photo.caption,
              })),
            }))}
          />
        </div>
      </Card>

      <Notice tone="neutral" title="Who can see this">
        Journal entries are visible only to your own account. GymOS has no mechanism to share a
        journal entry with anyone — no link, no export to a third party, no trainer account. The
        only thing you can deliberately share is an individual photograph, through an explicit
        grant you create and can revoke in{' '}
        <Link href="/settings/media-privacy" className="underline">
          Settings → Media privacy
        </Link>
        .
      </Notice>
    </div>
  );
}
