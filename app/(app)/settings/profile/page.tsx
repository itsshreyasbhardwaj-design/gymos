import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/session';
import { getProfile } from '@/lib/services/account';
import { TRAINING_INTERESTS, DAY_NAMES } from '@/lib/engines/workout-templates';
import { LIMITATION_OPTIONS, MEDICAL_DISCLAIMER } from '@/lib/engines/programming';
import { Card, CardHeader, Notice, PageHeader } from '@/components/ui';
import { ProfileSettingsForm } from '@/components/settings-forms';

export const metadata: Metadata = { title: 'Profile settings' };

export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const profile = getProfile(user.id);
  if (!profile) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile and training"
        description="Changing these affects the next plan you generate. Existing logged workouts are untouched."
      />

      <Card>
        <CardHeader title="Your details" />
        <div className="px-5 pb-5">
          <ProfileSettingsForm
            profile={{
              displayName: profile.displayName,
              experience: profile.experience,
              interests: profile.interests,
              trainingDays: profile.trainingDays,
              sessionMinutes: profile.sessionMinutes,
              scheduleFlexibility: profile.scheduleFlexibility,
              environment: profile.environment,
              limitations: profile.limitations,
              units: profile.units,
              timezone: profile.timezone,
              accessibility: profile.accessibility,
            }}
            interestOptions={TRAINING_INTERESTS.map((i) => ({ id: i.id, label: i.label }))}
            dayNames={DAY_NAMES}
            limitationOptions={LIMITATION_OPTIONS.map((l) => ({ id: l.id, label: l.label }))}
          />
        </div>
      </Card>

      <Notice tone="neutral" title="Age band">
        Your account is set to <strong>{profile.ageBand.replace(/_/g, ' ')}</strong>. The age band
        changes programming rules, exercise eligibility and nutrition behaviour, so it cannot be
        edited here. Contact support if it is wrong — in this build, that means editing the
        database directly.
      </Notice>

      <Notice tone="warn">{MEDICAL_DISCLAIMER}</Notice>
    </div>
  );
}
