'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import {
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  createPhotoCheckin,
  deletePhotoCheckin,
  removeCheckinPhoto,
  updateCheckinNote,
  setCheckinSchedule,
  disableCheckins,
  type JournalPhotoRef,
  type PhotoView,
} from '@/lib/services/journal';
import { PHOTO_VIEWS } from '@/lib/db/schema';

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

function revalidateWellness(): void {
  revalidatePath('/wellness');
  revalidatePath('/wellness/journal');
  revalidatePath('/wellness/check-ins');
}

function asView(value: string): PhotoView {
  return (PHOTO_VIEWS as readonly string[]).includes(value) ? (value as PhotoView) : 'other';
}

/**
 * Photographs are uploaded first through POST /api/media, which is the only writer
 * of private media. The form then submits the ids it was given back.
 */
function photosFromForm(formData: FormData): JournalPhotoRef[] {
  const ids = formData.getAll('assetId').map(String);
  const views = formData.getAll('view').map(String);
  const captions = formData.getAll('caption').map(String);
  return ids
    .filter((id) => id.trim().length > 0)
    .map((assetId, index) => ({
      assetId,
      view: asView(views[index] ?? 'other'),
      caption: captions[index] ?? '',
    }));
}

function tagsFromForm(formData: FormData): string[] {
  return String(formData.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------ journal entries */

export async function saveJournalEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const entryId = String(formData.get('entryId') ?? '').trim();
  const input = {
    date: String(formData.get('date') ?? '') || undefined,
    category: String(formData.get('category') ?? '') || undefined,
    title: String(formData.get('title') ?? ''),
    body: String(formData.get('body') ?? ''),
    tags: tagsFromForm(formData),
  };

  const result = await run(() => {
    if (entryId) {
      updateJournalEntry(user.id, entryId, input);
    } else {
      createJournalEntry(user.id, { ...input, photos: photosFromForm(formData) });
    }
  }, entryId ? 'Entry updated.' : 'Entry saved.');
  revalidateWellness();
  return result;
}

export async function deleteJournalEntryAction(entryId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => deleteJournalEntry(user.id, entryId),
    'Entry deleted. Any photos from that day are still in your check-ins.',
  );
  revalidateWellness();
  return result;
}

/* ----------------------------------------------------------------- check-ins */

export async function createCheckinAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      void createPhotoCheckin(user.id, {
        date: String(formData.get('date') ?? '') || undefined,
        note: String(formData.get('note') ?? ''),
        photos: photosFromForm(formData),
      }),
    'Check-in saved. Nothing was analysed — these are your photos and your note.',
  );
  revalidateWellness();
  return result;
}

export async function updateCheckinNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      updateCheckinNote(
        user.id,
        String(formData.get('checkinId') ?? ''),
        String(formData.get('note') ?? ''),
      ),
    'Note updated.',
  );
  revalidateWellness();
  return result;
}

export async function deleteCheckinAction(checkinId: string): Promise<ActionState> {
  const user = await requireUser();
  let removed = { assetsDeleted: 0, filesRemoved: 0 };
  const result = await run(() => {
    removed = deletePhotoCheckin(user.id, checkinId);
  }, 'Check-in deleted.');
  revalidateWellness();
  revalidatePath('/settings/media-privacy');
  if (result.success) {
    return {
      success: `Check-in deleted. ${removed.filesRemoved} of ${removed.assetsDeleted} encrypted file(s) were removed from disk and logged in your deletion history.`,
    };
  }
  return result;
}

export async function removeCheckinPhotoAction(
  checkinId: string,
  assetId: string,
): Promise<ActionState> {
  const user = await requireUser();
  let fileRemoved = false;
  const result = await run(() => {
    fileRemoved = removeCheckinPhoto(user.id, checkinId, assetId).fileRemoved;
  }, 'Photo deleted.');
  revalidateWellness();
  revalidatePath('/settings/media-privacy');
  if (result.success) {
    return {
      success: fileRemoved
        ? 'Photo deleted and its encrypted file removed from disk.'
        : 'Photo record deleted. Its file was already gone from disk; the deletion is logged either way.',
    };
  }
  return result;
}

/* ----------------------------------------------------------------- schedule */

export async function saveCheckinScheduleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const cadence = String(formData.get('cadence') ?? 'off');
  const result = await run(
    () =>
      setCheckinSchedule(user.id, {
        cadence,
        customDays: formData.get('customDays') ? Number(formData.get('customDays')) : null,
        reminderTime: String(formData.get('reminderTime') ?? '') || null,
      }),
    cadence === 'off' ? 'Check-in reminders are off.' : 'Check-in cadence saved.',
  );
  revalidateWellness();
  return result;
}

export async function disableCheckinsAction(): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => disableCheckins(user.id),
    'Check-ins are off. Your existing check-ins and photos are untouched.',
  );
  revalidateWellness();
  return result;
}
