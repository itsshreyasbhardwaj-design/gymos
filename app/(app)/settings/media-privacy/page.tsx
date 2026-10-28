import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { CONSENT_COPY, getConsent } from '@/lib/services/account';
import {
  listMedia,
  mediaUsage,
  listGrants,
  listDeletionEvents,
  isDevelopmentKey,
} from '@/lib/services/media';
import { Badge, BulletList, Card, CardHeader, Notice, PageHeader, Stat } from '@/components/ui';
import { MediaConsentToggle, MediaFileList, GrantList } from '@/components/photo-journal';

/**
 * Rounding a small file to "0 KB freed" reads as nothing having happened, which is the
 * opposite of what this log is for. Below a kilobyte, say bytes.
 */
function formatFreed(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export const metadata: Metadata = { title: 'Media privacy' };

export default async function MediaPrivacyPage() {
  const user = await requireUser();
  const isAdult = user.ageBand === 'adult_18_plus';

  const photoGranted = getConsent(user.id, 'photo_journal');
  const voiceGranted = getConsent(user.id, 'voice_recording');
  const usage = mediaUsage(user.id);
  const files = listMedia(user.id);
  const photoCount = files.filter((file) => file.kind === 'photo').length;
  const audioCount = files.filter((file) => file.kind === 'audio').length;
  const grants = listGrants(user.id);
  const deletions = listDeletionEvents(user.id, 50);
  const developmentKey = isDevelopmentKey();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Media privacy"
        description="Your photographs and recordings: what is stored, who can open it, and proof that deleting it worked."
      />

      {developmentKey ? (
        <Notice tone="warn" title="This install is using a development encryption key">
          No <code>GYMOS_MEDIA_KEY</code> is configured, so GymOS generated a random key and saved
          it in a file next to your media (<code>data/media/.media-key</code>). Your files are still
          encrypted with AES-256-GCM, but the key sits beside them — anyone who can read that
          directory can decrypt them, and losing the file makes every stored photo and recording
          permanently unreadable. Set <code>GYMOS_MEDIA_KEY</code> to a long secret before treating
          this install as anything other than local and personal. This warning is shown because it
          is true, not hidden behind a flag.
        </Notice>
      ) : (
        <Notice tone="ok" title="A configured encryption key is in use">
          Media is sealed with AES-256-GCM using the key from <code>GYMOS_MEDIA_KEY</code>. The key
          is never written to the database — only the IV and authentication tag are, so a copy of
          the database alone yields nothing readable.
        </Notice>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Files stored" value={usage.count} hint={`${photoCount} photo · ${audioCount} audio`} />
        <Stat
          label="Storage used"
          value={`${(usage.bytes / 1024 / 1024).toFixed(2)} MB`}
          hint="measured from the stored byte sizes"
        />
        <Stat
          label="Active shares"
          value={grants.filter((grant) => !grant.revokedAt).length}
          hint={grants.length === 0 ? 'nothing ever shared' : `${grants.length} total, including revoked`}
        />
      </div>

      <Card>
        <CardHeader
          title="Permissions"
          subtitle="Both are off until you turn them on. Turning one off deletes the files it covered — immediately and permanently."
        />
        <div className="px-5 pb-5 space-y-3">
          <MediaConsentToggle
            kind="photo_journal"
            title={CONSENT_COPY.photo_journal.title}
            body={CONSENT_COPY.photo_journal.body}
            granted={photoGranted}
            fileCount={photoCount}
            disabled={!isAdult}
            disabledReason={!isAdult ? CONSENT_COPY.photo_journal.minorNote : undefined}
          />
          <MediaConsentToggle
            kind="voice_recording"
            title={CONSENT_COPY.voice_recording.title}
            body={CONSENT_COPY.voice_recording.body}
            granted={voiceGranted}
            fileCount={audioCount}
            disabled={!isAdult}
            disabledReason={!isAdult ? CONSENT_COPY.voice_recording.minorNote : undefined}
          />
          {!isAdult ? (
            <Notice tone="neutral">
              These two permissions are not offered on under-18 accounts. GymOS has no verified
              parental-consent mechanism, so it refuses to store a minor&apos;s photographs or voice
              rather than collecting them under a consent that would not be meaningful. Everything
              else in GymOS remains fully available.
            </Notice>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Your files"
          subtitle="Every photograph and recording GymOS holds for you. Delete any of them here, one at a time."
        />
        <div className="px-5 pb-5">
          <MediaFileList
            files={files.map((file) => ({
              id: file.id,
              kind: file.kind,
              mimeType: file.mimeType,
              byteSize: file.byteSize,
              metadataStripped: file.metadataStripped,
              durationSeconds: file.durationSeconds,
              createdAt: file.createdAt,
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Shares"
          subtitle="An explicit, revocable grant on a single file would be the only way anything of yours reached another account. No control in this build creates one."
        />
        <div className="px-5 pb-5">
          <GrantList
            grants={grants.map((grant) => ({
              id: grant.id,
              assetId: grant.assetId,
              grantedToUserId: grant.grantedToUserId,
              reason: grant.reason,
              expiresAt: grant.expiresAt,
              revokedAt: grant.revokedAt,
              createdAt: grant.createdAt,
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Deletion log"
          subtitle="So that “deleted” is something you can check rather than something we assert."
        />
        <div className="px-5 pb-5">
          {deletions.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Nothing has been deleted yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {deletions.map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm">
                      File {event.assetId.slice(0, 8)}… · {event.reason.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] tabular-nums">
                      {event.createdAt.replace('T', ' ').slice(0, 19)} UTC ·{' '}
                      {formatFreed(event.bytesFreed)} freed
                    </p>
                  </div>
                  <Badge tone={event.fileRemoved ? 'ok' : 'warn'}>
                    {event.fileRemoved ? 'file removed from disk' : 'file was already missing'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Retention, in plain language" />
        <div className="px-5 pb-5">
          <BulletList
            items={[
              'Your photographs and recordings are kept until you delete them. There is no automatic expiry, and nothing is kept “for a while” after you remove it.',
              'Deleting a file removes the encrypted bytes from disk and writes a row in the log above. The database row is removed too — the only thing left is the audit entry proving the deletion happened.',
              'Turning off a media permission deletes every file collected under it in the same action. The permission and the data cannot drift apart.',
              'Deleting a check-in deletes its photographs with it. Deleting a journal entry deletes only the text, so a photo is never destroyed as a side effect of tidying up notes.',
              'Deleting your account deletes all of it, including the media directory.',
              'Media is never given a public address. It is served only by an authenticated handler that re-checks ownership on every request, with no-store caching and a sandboxed content-security policy.',
              'Metadata such as EXIF location is stripped before the bytes are encrypted, so the plaintext written to disk never contained it either.',
              'GymOS makes no external network calls at runtime: nothing you store here is sent anywhere.',
            ]}
          />
        </div>
      </Card>

      <Notice tone="neutral" title="What GymOS does not do with any of this">
        No photograph or recording is analysed. There is no appearance score, attractiveness or
        beauty rating, body-shape grade, body-fat estimate from a picture, facial-feature scoring,
        face or identity recognition, voice judgement, or automatic transcription anywhere in this
        build. Nothing is compared against another person or an ideal. If a number appears beside
        your own media anywhere in GymOS, it is a file size, a date, or something you typed.
      </Notice>

      <Notice tone="neutral">
        Looking for consents, export and account deletion?{' '}
        <Link href="/settings/privacy" className="underline">
          Privacy and data
        </Link>{' '}
        covers the rest of your account.
      </Notice>
    </div>
  );
}
