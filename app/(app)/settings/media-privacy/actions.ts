'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, audit } from '@/lib/auth/session';
import { setConsent } from '@/lib/services/account';
import {
  deleteMedia,
  listMedia,
  revokeMediaAccess,
  revokeAllGrants,
} from '@/lib/services/media';

export interface ActionState {
  error?: string;
  success?: string;
}

/** Wraps an action so a thrown service error becomes a readable message. */
async function run(fn: () => void | Promise<void>, success: string): Promise<ActionState> {
  try {
    await fn();
    return { success };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

function revalidateAll(): void {
  revalidatePath('/settings/media-privacy');
  revalidatePath('/settings/privacy');
  revalidatePath('/wellness');
  revalidatePath('/wellness/journal');
  revalidatePath('/wellness/check-ins');
}

export type MediaConsentKind = 'photo_journal' | 'voice_recording';

/**
 * Turning a media consent off DESTROYS the media collected under it — the account
 * service deletes it as part of the same call. The count is read first so the
 * message can tell the user exactly how many files went, rather than claiming a
 * deletion we did not verify.
 */
export async function setMediaConsentAction(
  kind: MediaConsentKind,
  granted: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const affectedKind = kind === 'photo_journal' ? 'photo' : 'audio';
  const before = granted ? 0 : listMedia(user.id, affectedKind).length;

  const result = await run(
    () => setConsent(user.id, kind, granted),
    granted ? 'Consent recorded.' : 'Consent withdrawn.',
  );

  if (result.success) {
    await audit(granted ? 'consent.granted' : 'consent.withdrawn', {
      userId: user.id,
      target: kind,
    });
  }
  revalidateAll();

  if (result.success && !granted) {
    const after = listMedia(user.id, affectedKind).length;
    return {
      success:
        before === 0
          ? 'Consent withdrawn. You had no files of that kind stored.'
          : `Consent withdrawn and ${before - after} file(s) deleted. Check the deletion log below to confirm the files were removed from disk.`,
    };
  }
  return result;
}

export async function deleteMediaAssetAction(assetId: string): Promise<ActionState> {
  const user = await requireUser();
  let fileRemoved = false;
  const result = await run(() => {
    fileRemoved = deleteMedia(user.id, assetId, 'user_request');
  }, 'File deleted.');
  revalidateAll();
  if (result.success) {
    return {
      success: fileRemoved
        ? 'File deleted. The encrypted bytes were removed from disk and the deletion was logged.'
        : 'Record deleted and logged. The file was already missing from disk, so nothing was there to remove.',
    };
  }
  return result;
}

export async function revokeGrantAction(grantId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => revokeMediaAccess(user.id, grantId),
    'Share revoked. That person can no longer open the file.',
  );
  revalidateAll();
  return result;
}

export async function revokeAllGrantsAction(): Promise<ActionState> {
  const user = await requireUser();
  let revoked = 0;
  const result = await run(() => {
    revoked = revokeAllGrants(user.id);
  }, 'Shares revoked.');
  revalidateAll();
  if (result.success) {
    return {
      success:
        revoked === 0
          ? 'You had no active shares.'
          : `${revoked} share(s) revoked. Nothing of yours is shared now.`,
    };
  }
  return result;
}
