import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BookOpen,
  Camera,
  Scissors,
  Sparkles,
  Shirt,
  Mic,
  Droplets,
  ClipboardCheck,
  ShieldCheck,
} from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getConsent } from '@/lib/services/account';
import { journalSummary, checkinOutlook } from '@/lib/services/journal';
import { mediaUsage } from '@/lib/services/media';
import { Badge, BulletList, Card, CardHeader, Notice, PageHeader, Stat } from '@/components/ui';

export const metadata: Metadata = { title: 'Wellness' };

const MODULES = [
  {
    href: '/wellness/journal',
    icon: BookOpen,
    title: 'Personal journal',
    body: 'Your own writing, with your own photographs attached if you want them. Works fully without photos.',
  },
  {
    href: '/wellness/check-ins',
    icon: Camera,
    title: 'Photo check-ins',
    body: 'Opt-in, off by default. Your photographs with your own note, side by side over time.',
  },
  {
    href: '/grooming',
    icon: Scissors,
    title: 'Grooming routines',
    body: 'Routines and reminders you define yourself.',
  },
  {
    href: '/skincare',
    icon: Sparkles,
    title: 'Skincare',
    body: 'Products you use and how your skin felt, in your words.',
  },
  {
    href: '/wardrobe',
    icon: Shirt,
    title: 'Wardrobe',
    body: 'What you own and what you actually wear. No style verdicts.',
  },
  {
    href: '/voice',
    icon: Mic,
    title: 'Voice practice',
    body: 'Practice prompts, and optional recordings only you can play back.',
  },
  {
    href: '/hygiene',
    icon: Droplets,
    title: 'Hygiene routines',
    body: 'Simple routines. No cleanliness score, ever.',
  },
  {
    href: '/reviews',
    icon: ClipboardCheck,
    title: 'Your own reviews',
    body: 'Write down what worked for you and what did not.',
  },
  {
    href: '/settings/media-privacy',
    icon: ShieldCheck,
    title: 'Media privacy',
    body: 'Consents, storage used, every file, every share, and the deletion log.',
  },
];

export default async function WellnessPage() {
  const user = await requireUser();
  const summary = journalSummary(user.id);
  const outlook = checkinOutlook(user.id);
  const usage = mediaUsage(user.id);
  const photoConsent = getConsent(user.id, 'photo_journal');
  const voiceConsent = getConsent(user.id, 'voice_recording');
  const isAdult = user.ageBand === 'adult_18_plus';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Wellness"
        title="Personal care, on your terms"
        description="A place to keep your own notes, routines and photographs. GymOS stores them for you to look back at — it does not judge them."
      />

      <Notice tone="brand" title="What is and is not analysed here">
        <BulletList
          items={[
            'No photograph in GymOS is analysed. There is no appearance score, no attractiveness or beauty rating, no body-shape grade, no body-fat estimate from a picture, no facial-feature scoring and no comparison against anyone else or any ideal.',
            'There is no face or identity recognition, and no automatic transcription of recordings — this build contains no model that reads your photos or listens to your audio.',
            'Any observation attached to a check-in, a routine or a review is something you typed yourself. GymOS never adds an assessment of its own.',
            'GymOS cannot diagnose a skin or health condition and does not try. If something on your skin or body concerns you, see a qualified professional.',
            'Every workout, nutrition and routine feature works without ever uploading a photograph or making a recording.',
          ]}
        />
      </Notice>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Journal entries" value={summary.entryCount} hint={summary.lastEntryDate ? `last on ${summary.lastEntryDate}` : 'nothing written yet'} />
        <Stat
          label="Check-ins"
          value={summary.checkinCount}
          hint={outlook.cadence === 'off' ? 'reminders off (default)' : `cadence: ${outlook.cadence}`}
        />
        <Stat
          label="Private files"
          value={usage.count}
          hint={`${(usage.bytes / 1024 / 1024).toFixed(1)} MB stored encrypted`}
        />
      </div>

      <Card>
        <CardHeader
          title="Your media permissions"
          subtitle="Both are off until you turn them on, and turning one off deletes the files it covered."
          action={
            <Link href="/settings/media-privacy" className="text-sm underline">
              Manage
            </Link>
          }
        />
        <div className="px-5 pb-5 flex flex-wrap gap-2">
          <Badge tone={photoConsent ? 'ok' : 'neutral'}>
            Photo journal: {photoConsent ? 'on' : 'off'}
          </Badge>
          <Badge tone={voiceConsent ? 'ok' : 'neutral'}>
            Voice recording: {voiceConsent ? 'on' : 'off'}
          </Badge>
          {!isAdult ? (
            <Badge tone="warn">18+ only — photos and recordings are not offered on this account</Badge>
          ) : null}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <Link key={module.href} href={module.href}>
              <Card className="p-5 h-full hover:border-[var(--border-strong)] transition-colors">
                <Icon className="h-5 w-5 text-[var(--accent)]" aria-hidden="true" />
                <h2 className="font-semibold mt-3">{module.title}</h2>
                <p className="text-sm text-[var(--text-muted)] mt-1 leading-relaxed">
                  {module.body}
                </p>
              </Card>
            </Link>
          );
        })}
      </div>

      {!isAdult ? (
        <Notice tone="neutral" title="About photographs and recordings on this account">
          GymOS has no verified parental-consent mechanism, so it does not store photographs or
          voice recordings for under-18 accounts. Every other feature on this page is fully
          available to you, and nothing here is reduced or locked because of it.
        </Notice>
      ) : null}
    </div>
  );
}
