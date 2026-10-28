'use client';

import { useState, useTransition } from 'react';
import { CalendarClock, Camera, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import {
  createCheckinAction,
  deleteCheckinAction,
  removeCheckinPhotoAction,
  saveCheckinScheduleAction,
  disableCheckinsAction,
  updateCheckinNoteAction,
  type ActionState,
} from '@/app/(app)/wellness/actions';
// The upload-then-save hazard is identical here and in the journal entry form, so the
// flow that handles it lives in one place and is shared rather than copied: a copy is
// a second place for the cleanup-on-throw to be forgotten again.
import { attemptMediaSave, discardUploads } from '@/components/photo-journal';

export interface ScheduleProp {
  cadence: string;
  customDays: number | null;
  reminderTime: string | null;
  intervalDays: number | null;
}

export interface OutlookProp {
  cadence: string;
  intervalDays: number | null;
  lastCheckinDate: string | null;
  nextSuggestedDate: string | null;
  dueToday: boolean;
}

export interface CheckinProp {
  id: string;
  date: string;
  note: string;
  photos: { assetId: string; view: string; caption: string }[];
}

const VIEWS = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
  { value: 'skin', label: 'Skin' },
  { value: 'other', label: 'Other' },
];

const CADENCES = [
  { value: 'off', label: 'Off — no check-in reminders (default)' },
  { value: 'weekly', label: 'Every week' },
  { value: 'fortnightly', label: 'Every two weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'custom', label: 'Every N days' },
];

/**
 * Uploads go through POST /api/media, which owns every media rule.
 *
 * Each stored photograph is reported through `stored` as it lands rather than
 * returned at the end: an id held only in this function's own array is lost the
 * moment the call stack unwinds, and a lost id is a file nobody can take back.
 */
export async function uploadPhotos(
  items: { file: File; view: string }[],
  stored: (photo: { id: string; view: string }) => void,
): Promise<{ error?: string }> {
  for (const item of items) {
    const body = new FormData();
    body.append('file', item.file);
    body.append('kind', 'photo');
    try {
      const response = await fetch('/api/media', { method: 'POST', body });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        return { error: payload.error ?? 'That photo could not be saved.' };
      }
      stored({ id: payload.id, view: item.view });
    } catch {
      // The reply never arrived. The file may have been stored anyway, in which case
      // this page will never learn its id and cannot delete it — so say where it is.
      return {
        error:
          'That upload did not finish — the connection dropped partway through. If a file was stored before it dropped, it is listed, and deletable, in Settings → Media privacy.',
      };
    }
  }
  return {};
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <Notice tone="bad" className="mt-3">
        {state.error}
      </Notice>
    );
  }
  if (state.success) {
    return (
      <Notice tone="ok" className="mt-3">
        {state.success}
      </Notice>
    );
  }
  return null;
}

function PrivatePhoto({ assetId, label }: { assetId: string; label: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/media/${assetId}`}
      alt={label}
      loading="lazy"
      className="h-32 w-full rounded-lg object-cover bg-[var(--surface-sunken)]"
    />
  );
}

/* ------------------------------------------------------------------ schedule */

export function CheckinScheduleForm({
  schedule,
  outlook,
}: {
  schedule: ScheduleProp;
  outlook: OutlookProp;
}) {
  const [state, setState] = useState<ActionState>({});
  const [cadence, setCadence] = useState(schedule.cadence);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <form
        action={(data) =>
          startTransition(async () => {
            setState(await saveCheckinScheduleAction({}, data));
          })
        }
        className="space-y-3"
      >
        <Field
          label="How often would you like a check-in suggested?"
          htmlFor="cadence"
          hint="Off is the default. Changing this never deletes anything, and skipping a suggested date has no consequence."
        >
          <Select
            id="cadence"
            name="cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value)}
          >
            {CADENCES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {cadence === 'custom' ? (
          <Field label="Days between check-ins" htmlFor="customDays">
            <Input
              id="customDays"
              name="customDays"
              type="number"
              min={1}
              max={365}
              defaultValue={schedule.customDays ?? 21}
              required
            />
          </Field>
        ) : null}

        {cadence !== 'off' ? (
          <Field
            label="Preferred time of day"
            htmlFor="reminderTime"
            hint="Optional, and stored only as your preference. This build sends no push notifications and no email."
          >
            <Input
              id="reminderTime"
              name="reminderTime"
              type="time"
              defaultValue={schedule.reminderTime ?? ''}
            />
          </Field>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            Save cadence
          </Button>
          {schedule.cadence !== 'off' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setState(await disableCheckinsAction());
                  setCadence('off');
                })
              }
            >
              Turn check-ins off
            </Button>
          ) : null}
        </div>
        <Feedback state={state} />
      </form>

      <Card className="p-4">
        <p className="text-sm font-medium">Where this stands</p>
        <ul className="text-sm text-[var(--text-muted)] mt-2 space-y-1">
          <li>
            Cadence: <span className="text-[var(--text)]">{outlook.cadence}</span>
            {outlook.intervalDays ? ` (every ${outlook.intervalDays} days)` : ''}
          </li>
          <li>
            Last check-in:{' '}
            <span className="text-[var(--text)] tabular-nums">
              {outlook.lastCheckinDate ?? 'none yet'}
            </span>
          </li>
          <li>
            Next suggested:{' '}
            <span className="text-[var(--text)] tabular-nums">
              {outlook.nextSuggestedDate ?? 'not scheduled'}
            </span>
          </li>
        </ul>
        {outlook.cadence === 'off' ? (
          <p className="text-xs text-[var(--text-muted)] mt-3">
            Check-ins are off, so nothing is suggested and nothing is counted.
          </p>
        ) : (
          <p className="text-xs text-[var(--text-muted)] mt-3">
            {outlook.dueToday
              ? 'A check-in is due by your own cadence. Doing it later, or not at all, costs you nothing — nothing is counted and no streak is kept.'
              : 'Nothing is due. You can still check in whenever you want to.'}
          </p>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------- new check-in */

export function NewCheckinForm({
  today,
  photosAllowed,
  photosBlockedReason,
  maxPhotos,
}: {
  today: string;
  photosAllowed: boolean;
  photosBlockedReason?: string;
  /** The server's own limit, passed in so the two can never drift apart. */
  maxPhotos: number;
}) {
  const [state, setState] = useState<ActionState>({});
  const [items, setItems] = useState<{ file: File; view: string }[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [pending, startTransition] = useTransition();

  const tooMany = items.length > maxPhotos;

  if (!photosAllowed) {
    return (
      <Notice tone="neutral" title="Photo check-ins are not available on this account">
        {photosBlockedReason ??
          'Photo check-ins need the photo journal consent turned on in Settings → Media privacy.'}{' '}
        Every other part of GymOS — workouts, nutrition, routines, the written journal — works
        without ever uploading a photograph.
      </Notice>
    );
  }

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          // Both checks happen BEFORE a single byte is uploaded. Refusing an
          // over-sized check-in only after storing all of its photographs would be
          // the same silent keeping that refusing was supposed to avoid.
          if (items.length === 0) {
            setState({ error: 'Choose at least one photo for this check-in.' });
            return;
          }
          if (items.length > maxPhotos) {
            setState({
              error: `A check-in holds up to ${maxPhotos} photos, and you chose ${items.length}. Remove ${items.length - maxPhotos}, or save the rest as a second check-in. Nothing was uploaded.`,
            });
            return;
          }

          // Which view each stored photograph shows, kept alongside the ids the flow
          // itself collects. Every exit from the flow — saved, refused, or thrown —
          // comes back with a sentence and with the uploads already taken back.
          const uploaded: { id: string; view: string }[] = [];
          const outcome = await attemptMediaSave({
            upload: (stored) =>
              uploadPhotos(items, (photo) => {
                uploaded.push(photo);
                stored(photo.id);
              }),
            save: () => {
              for (const photo of uploaded) {
                data.append('assetId', photo.id);
                data.append('view', photo.view);
                data.append('caption', '');
              }
              return createCheckinAction({}, data);
            },
            discard: (ids) => discardUploads(ids, 'check-in'),
            fallbackError: 'That check-in could not be saved.',
          });

          setState(outcome.state);
          if (outcome.clearSelection) {
            // Either the check-in saved, or a photograph is still stored. In both
            // cases keeping the selection would let the next press store a second copy.
            setItems([]);
            setResetKey((key) => key + 1);
          }
        })
      }
      className="space-y-3"
    >
      <Field label="Date" htmlFor="checkin-date">
        <Input id="checkin-date" name="date" type="date" defaultValue={today} max={today} />
      </Field>

      <Field
        key={resetKey}
        label="Photos"
        htmlFor="checkin-photos"
        hint={`One is enough, ${maxPhotos} is the maximum. Encrypted on disk, metadata stripped, served only to you through an authenticated handler. No automated analysis is performed on them.`}
      >
        <input
          id="checkin-photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) =>
            setItems(Array.from(event.target.files ?? []).map((file) => ({ file, view: 'other' })))
          }
          className="text-sm"
        />
      </Field>

      {tooMany ? (
        <Notice tone="warn">
          That is {items.length} photos and a check-in holds {maxPhotos}. Remove{' '}
          {items.length - maxPhotos}, or save the rest as a second check-in. Nothing has been
          uploaded.
        </Notice>
      ) : null}

      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <li
              key={`${item.file.name}-${index}`}
              className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2"
            >
              <span className="text-sm min-w-0 truncate flex-1">{item.file.name}</span>
              <Select
                aria-label={`What ${item.file.name} shows`}
                value={item.view}
                onChange={(event) =>
                  setItems((prev) =>
                    prev.map((entry, i) =>
                      i === index ? { file: entry.file, view: event.target.value } : entry,
                    ),
                  )
                }
                className="w-32 h-9"
              >
                {VIEWS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                className="h-8 w-8 grid place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Remove {item.file.name} from this check-in</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Field
        label="Your note (optional)"
        htmlFor="checkin-note"
        hint="Whatever you want to remember about today. This is your own observation — GymOS adds nothing of its own and does not interpret it."
      >
        <Textarea id="checkin-note" name="note" rows={3} maxLength={2000} />
      </Field>

      <Button type="submit" disabled={pending || tooMany}>
        <Camera className="h-4 w-4" aria-hidden="true" />
        {pending ? 'Saving…' : 'Save check-in'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

/* ---------------------------------------------------------------- history */

export function CheckinHistory({ checkins }: { checkins: CheckinProp[] }) {
  const [state, setState] = useState<ActionState>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (checkins.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No check-ins yet. They are entirely optional — nothing else in GymOS depends on them.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Feedback state={state} />
      {checkins.map((checkin) => (
        <Card key={checkin.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium tabular-nums">{checkin.date}</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {checkin.photos.length} photo{checkin.photos.length === 1 ? '' : 's'} · nothing
                analysed
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="quiet"
                onClick={() => setEditing(editing === checkin.id ? null : checkin.id)}
              >
                {editing === checkin.id ? 'Cancel' : 'Edit note'}
              </Button>
              {confirming === checkin.id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setState(await deleteCheckinAction(checkin.id));
                      setConfirming(null);
                    })
                  }
                >
                  Delete check-in and {checkin.photos.length} file(s)
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  onClick={() => setConfirming(checkin.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Delete check-in from {checkin.date}</span>
                </Button>
              )}
            </div>
          </div>

          {confirming === checkin.id ? (
            <Notice tone="warn" className="mt-3">
              This deletes the check-in and permanently removes {checkin.photos.length} encrypted
              file(s) from disk. Each deletion is written to your deletion log so you can verify it.
            </Notice>
          ) : null}

          {checkin.photos.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
              {checkin.photos.map((photo) => (
                <figure key={photo.assetId}>
                  <PrivatePhoto
                    assetId={photo.assetId}
                    label={`Your photo from ${checkin.date}, ${photo.view} view`}
                  />
                  <figcaption className="flex items-center justify-between gap-1 mt-1">
                    <span className="text-[11px] text-[var(--text-muted)]">{photo.view}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          setState(await removeCheckinPhotoAction(checkin.id, photo.assetId));
                        })
                      }
                      className="text-[11px] text-bad-500 hover:underline"
                    >
                      Delete
                      <span className="sr-only"> this photo and its file</span>
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}

          {editing === checkin.id ? (
            <form
              action={(data) =>
                startTransition(async () => {
                  setState(await updateCheckinNoteAction({}, data));
                  setEditing(null);
                })
              }
              className="mt-3 space-y-2"
            >
              <input type="hidden" name="checkinId" value={checkin.id} />
              <Textarea name="note" rows={3} maxLength={2000} defaultValue={checkin.note} />
              <Button type="submit" size="sm" disabled={pending}>
                Save note
              </Button>
            </form>
          ) : checkin.note ? (
            <p className="text-sm mt-3 whitespace-pre-wrap">
              <Badge tone="neutral" className="mr-2">
                your note
              </Badge>
              {checkin.note}
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
