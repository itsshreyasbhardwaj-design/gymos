import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getConsent } from '@/lib/services/account';
import {
  getCheckinSchedule,
  checkinOutlook,
  listPhotoCheckins,
  MAX_PHOTOS_PER_CHECKIN,
  todayIso,
} from '@/lib/services/journal';
import { Card, CardHeader, Notice, PageHeader } from '@/components/ui';
import {
  CheckinScheduleForm,
  NewCheckinForm,
  CheckinHistory,
} from '@/components/checkin-forms';

export const metadata: Metadata = { title: 'Photo check-ins' };

export default async function CheckinsPage() {
  const user = await requireUser();
  const isAdult = user.ageBand === 'adult_18_plus';
  const photoConsent = getConsent(user.id, 'photo_journal');
  const photosAllowed = isAdult && photoConsent;

  const photosBlockedReason = !isAdult
    ? 'GymOS does not store photographs for under-18 accounts, because it has no verified parental-consent mechanism. Nothing else on this page is withheld from you.'
    : 'Turn on the private photo journal in Settings → Media privacy to take a check-in. You can turn it back off at any time, which deletes the photographs it covered.';

  const schedule = getCheckinSchedule(user.id);
  const outlook = checkinOutlook(user.id);
  const checkins = listPhotoCheckins(user.id, { limit: 60 });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Wellness"
        title="Photo check-ins"
        description="Entirely optional, off by default, and disableable at any time. Your photographs, your note, nothing else."
      />

      <Notice tone="neutral" title="What a check-in is, and is not">
        A check-in is your own photographs plus your own note, stored for you to look back at. GymOS
        performs no analysis on them: no appearance or attractiveness score, no body-shape grade, no
        body-fat estimate, no measurement, no comparison against an ideal, no skin diagnosis.
        Skipping a check-in costs you nothing — nothing is counted, no streak is kept, and nothing
        else in GymOS depends on it.
      </Notice>

      <Card>
        <CardHeader
          title="Cadence"
          subtitle="Off is the default. You can change it or turn it off whenever you like."
        />
        <div className="px-5 pb-5">
          <CheckinScheduleForm
            schedule={{
              cadence: schedule.cadence,
              customDays: schedule.customDays,
              reminderTime: schedule.reminderTime,
              intervalDays: schedule.intervalDays,
            }}
            outlook={{
              cadence: outlook.cadence,
              intervalDays: outlook.intervalDays,
              lastCheckinDate: outlook.lastCheckinDate,
              nextSuggestedDate: outlook.nextSuggestedDate,
              dueToday: outlook.dueToday,
            }}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Do a check-in"
          subtitle={`One photo is enough. ${MAX_PHOTOS_PER_CHECKIN} is the maximum per check-in, checked before anything is uploaded.`}
        />
        <div className="px-5 pb-5">
          <NewCheckinForm
            today={todayIso()}
            photosAllowed={photosAllowed}
            photosBlockedReason={photosBlockedReason}
            maxPhotos={MAX_PHOTOS_PER_CHECKIN}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Past check-ins"
          subtitle="Deleting one removes its encrypted files from disk and records each removal in your deletion log."
          action={
            <Link href="/wellness/journal" className="text-sm underline">
              Compare over time
            </Link>
          }
        />
        <div className="px-5 pb-5">
          <CheckinHistory
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
    </div>
  );
}
