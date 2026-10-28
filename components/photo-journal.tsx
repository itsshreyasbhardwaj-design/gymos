'use client';

import { useMemo, useState, useTransition } from 'react';
import { Trash2, Save, ImagePlus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import {
  saveJournalEntryAction,
  deleteJournalEntryAction,
  type ActionState,
} from '@/app/(app)/wellness/actions';
import {
  setMediaConsentAction,
  deleteMediaAssetAction,
  revokeGrantAction,
  revokeAllGrantsAction,
  type ActionState as MediaActionState,
} from '@/app/(app)/settings/media-privacy/actions';

export interface JournalPhotoProp {
  assetId: string;
  date: string;
  view: string;
  caption: string;
}

export interface JournalEntryProp {
  id: string;
  date: string;
  category: string;
  title: string;
  body: string;
  tags: string[];
  photos: JournalPhotoProp[];
}

export interface CheckinOption {
  id: string;
  date: string;
  note: string;
  photos: { assetId: string; view: string; caption: string }[];
}

const DAY_MS = 86_400_000;

/**
 * Uploads go to POST /api/media, the only writer of private media. It enforces the
 * 18+ rule, the consent gate, the plan limit, metadata stripping and encryption, so
 * nothing here needs to — and nothing here can bypass it.
 *
 * Each id is handed to `stored` the moment it lands, before the next file is
 * attempted, rather than returned at the end. An id that only ever existed in this
 * function's own array is lost if the call stack unwinds — and a lost id is a
 * photograph on disk that nobody can take back.
 */
export async function uploadPhotos(
  files: File[],
  stored: (id: string) => void,
): Promise<{ error?: string }> {
  for (const file of files) {
    const body = new FormData();
    body.append('file', file);
    body.append('kind', 'photo');
    try {
      const response = await fetch('/api/media', { method: 'POST', body });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!response.ok || !payload.id) {
        return { error: payload.error ?? 'That photo could not be saved.' };
      }
      stored(payload.id);
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

/** What became of the photographs uploaded for a save that was then refused. */
export interface DiscardOutcome {
  /** The ids whose delete did NOT succeed: still stored, and attached to nothing. */
  kept: string[];
  /** A sentence for the user: what actually happened, and what to do about it. */
  message: string;
}

/**
 * Deletes photographs that were uploaded for a save the server then refused.
 *
 * An upload is permanent the moment it lands, so a rejected entry would otherwise
 * leave encrypted files stored and attached to nothing. DELETE /api/media/<id> is the
 * owner's own delete: it removes the bytes and writes the deletion to the log on
 * /settings/media-privacy.
 *
 * The ids that survived come back as well as the sentence, because the caller has to
 * act on them: a file that is still stored must not be uploaded a second time by the
 * next press of Save, so the form drops its file selection when `kept` is non-empty.
 */
export async function discardUploads(ids: string[], noun: string): Promise<DiscardOutcome> {
  if (ids.length === 0) return { kept: [], message: '' };
  const kept: string[] = [];
  for (const id of ids) {
    try {
      const response = await fetch(`/api/media/${id}`, { method: 'DELETE' });
      if (!response.ok) kept.push(id);
    } catch {
      // Counted as still stored; the sentence below says where to find it.
      kept.push(id);
    }
  }
  if (kept.length === 0) {
    return {
      kept,
      message: ` Nothing was kept: the ${ids.length} photo(s) uploaded for this ${noun} were deleted again.`,
    };
  }
  return {
    kept,
    message: ` ${kept.length} of ${ids.length} uploaded photo(s) could not be deleted automatically. They are stored, attached to nothing, and listed with a delete button in Settings → Media privacy — delete them there. Your file selection has been cleared so that pressing Save again cannot store a second copy of them; choose the files again only if you still want them attached.`,
  };
}

/**
 * One attempt at "upload the chosen photographs, then save the row they belong to".
 *
 * The journal entry form and the check-in form share this (the latter imports it)
 * because the hazard is identical in both and must not be fixed in only one: an
 * upload is permanent the moment it lands, so EVERY path out of here — including a
 * thrown one — has to take the uploads back and has to leave the user a sentence.
 */
export interface MediaSaveFlow {
  /** Uploads the chosen files, calling `stored` with each id as it lands. */
  upload: (stored: (id: string) => void) => Promise<{ error?: string }>;
  /** Saves the row that the ids now stored belong to. */
  save: (ids: string[]) => Promise<ActionState>;
  /** Takes the uploads back; says which survived and what to tell the user. */
  discard: (ids: string[]) => Promise<DiscardOutcome>;
  /** What to say when the save failed without saying why. */
  fallbackError: string;
}

export interface MediaSaveResult {
  /** Never empty: a save that failed silently is the bug this type exists to prevent. */
  state: ActionState;
  /**
   * True when the chosen files must be forgotten — either because they were saved, or
   * because they are still stored and re-uploading them would store a second copy.
   */
  clearSelection: boolean;
}

export async function attemptMediaSave(flow: MediaSaveFlow): Promise<MediaSaveResult> {
  // Owned here rather than inside `upload`, so that a throw anywhere below still
  // leaves the ids that already landed within reach of `discard`.
  const stored: string[] = [];

  const abandon = async (error: string): Promise<MediaSaveResult> => {
    let outcome: DiscardOutcome;
    try {
      outcome = await flow.discard(stored);
    } catch {
      // The cleanup itself could not run. Everything uploaded is still stored.
      outcome =
        stored.length === 0
          ? { kept: [], message: '' }
          : {
              kept: [...stored],
              message: ` The ${stored.length} photo(s) uploaded for this save could not be deleted automatically. They are listed, and deletable, in Settings → Media privacy. Your file selection has been cleared so that pressing Save again cannot store a second copy.`,
            };
    }
    return { state: { error: error + outcome.message }, clearSelection: outcome.kept.length > 0 };
  };

  try {
    const upload = await flow.upload((id) => stored.push(id));
    if (upload.error) return await abandon(upload.error);

    const result = await flow.save(stored);
    if (!result.success) return await abandon(result.error ?? flow.fallbackError);

    return { state: result, clearSelection: true };
  } catch (err) {
    // A session that expired mid-save, a dropped connection, a server action that
    // threw instead of returning. Without this branch the ids above would be
    // unreachable, the photographs would stay stored, and the form would say nothing
    // at all — the user would be looking at a page that had simply stopped.
    const detail = err instanceof Error && err.message.trim() ? ` (${err.message.trim()})` : '';
    return await abandon(
      `${flow.fallbackError} The request did not finish — your session may have expired, or the connection dropped${detail}.`,
    );
  }
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

/** A photograph is only ever shown through the authenticated media handler. */
function PrivatePhoto({
  assetId,
  label,
  className,
}: {
  assetId: string;
  label: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/media/${assetId}`}
      alt={label}
      loading="lazy"
      className={className ?? 'h-32 w-full rounded-lg object-cover bg-[var(--surface-sunken)]'}
    />
  );
}

export function JournalEntryForm({
  categories,
  today,
  photosAllowed,
  photosBlockedReason,
  maxPhotos,
}: {
  categories: string[];
  today: string;
  photosAllowed: boolean;
  photosBlockedReason?: string;
  /** The server's own limit, passed in so the two can never drift apart. */
  maxPhotos: number;
}) {
  const [state, setState] = useState<ActionState>({});
  const [files, setFiles] = useState<File[]>([]);
  const [view, setView] = useState('other');
  const [resetKey, setResetKey] = useState(0);
  const [pending, startTransition] = useTransition();

  const tooMany = photosAllowed && files.length > maxPhotos;

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          // Checked BEFORE anything is uploaded. Storing a photograph is permanent, so
          // a save the server was always going to refuse must not store one first.
          const hasText =
            String(data.get('title') ?? '').trim().length > 0 ||
            String(data.get('body') ?? '').trim().length > 0;
          if (!hasText) {
            setState({
              error: 'Write a title or a note before saving. Nothing was uploaded.',
            });
            return;
          }
          if (photosAllowed && files.length > maxPhotos) {
            setState({
              error: `An entry holds up to ${maxPhotos} photos, and you chose ${files.length}. Remove ${files.length - maxPhotos}, or keep the rest for a separate check-in. Nothing was uploaded.`,
            });
            return;
          }

          // Every exit from here — saved, refused, or thrown — comes back with a
          // sentence for the user and with the uploads already taken back.
          const outcome = await attemptMediaSave({
            upload: (stored) =>
              photosAllowed && files.length > 0
                ? uploadPhotos(files, stored)
                : Promise.resolve({}),
            save: (ids) => {
              for (const id of ids) {
                data.append('assetId', id);
                data.append('view', view);
                data.append('caption', '');
              }
              return saveJournalEntryAction({}, data);
            },
            discard: (ids) => discardUploads(ids, 'save'),
            fallbackError: 'That entry could not be saved.',
          });

          setState(outcome.state);
          if (outcome.clearSelection) {
            // Either the entry saved, or a photograph is still stored. In both cases
            // keeping the selection would let the next press store a second copy.
            setFiles([]);
            setResetKey((k) => k + 1);
          }
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="journal-date">
          <Input id="journal-date" name="date" type="date" defaultValue={today} max={today} />
        </Field>
        <Field label="Category" htmlFor="journal-category">
          <Select id="journal-category" name="category" defaultValue="general">
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags" htmlFor="journal-tags" hint="Comma separated. Optional.">
          <Input id="journal-tags" name="tags" placeholder="sleep, travel" />
        </Field>
      </div>

      <Field label="Title" htmlFor="journal-title">
        <Input id="journal-title" name="title" maxLength={120} placeholder="A line for your future self" />
      </Field>

      <Field
        label="Your note"
        htmlFor="journal-body"
        hint="This is your own writing. GymOS does not interpret, score or summarise it."
      >
        <Textarea id="journal-body" name="body" maxLength={5000} rows={5} />
      </Field>

      {photosAllowed ? (
        <Field
          key={resetKey}
          label="Attach photos (optional)"
          htmlFor="journal-photos"
          hint={`Up to ${maxPhotos} per entry. Stored encrypted, metadata stripped, visible only to you. They belong to this entry alone, and are saved as a check-in of their own so they also appear in the comparison view.`}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              id="journal-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="text-sm"
            />
            <Select
              aria-label="What the photos show"
              value={view}
              onChange={(event) => setView(event.target.value)}
            >
              <option value="front">Front</option>
              <option value="side">Side</option>
              <option value="back">Back</option>
              <option value="skin">Skin</option>
              <option value="other">Other</option>
            </Select>
          </div>
          {files.length > 0 ? (
            <p className="text-xs text-[var(--text-muted)] mt-2">
              {files.length} file(s) ready to upload. Nothing is stored until you save.
            </p>
          ) : null}
          {tooMany ? (
            <Notice tone="warn" className="mt-2">
              That is {files.length} photos and an entry holds {maxPhotos}. Choose fewer before
              saving — nothing has been uploaded.
            </Notice>
          ) : null}
        </Field>
      ) : (
        <Notice tone="neutral" title="Photos are off for this account">
          {photosBlockedReason ??
            'Writing and reading your journal works without photographs. Nothing on this page needs a camera.'}
        </Notice>
      )}

      <Button type="submit" disabled={pending || tooMany}>
        {files.length > 0 ? (
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Save className="h-4 w-4" aria-hidden="true" />
        )}
        {pending ? 'Saving…' : 'Save entry'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function JournalEntryList({ entries }: { entries: JournalEntryProp[] }) {
  const [state, setState] = useState<ActionState>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (entries.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Nothing written yet. Your first entry can be one line.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Feedback state={state} />
      {entries.map((entry) => (
        <Card key={entry.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-[var(--text-muted)] tabular-nums">{entry.date}</p>
              {entry.title ? <p className="font-medium mt-0.5">{entry.title}</p> : null}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge>{entry.category}</Badge>
              {confirming === entry.id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setState(await deleteJournalEntryAction(entry.id));
                      setConfirming(null);
                    })
                  }
                >
                  Confirm delete
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  onClick={() => setConfirming(entry.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Delete entry from {entry.date}</span>
                </Button>
              )}
            </div>
          </div>

          {entry.body ? (
            <p className="text-sm mt-2 whitespace-pre-wrap leading-relaxed">{entry.body}</p>
          ) : null}

          {entry.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {entry.tags.map((tag) => (
                <Badge key={tag} tone="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}

          {entry.photos.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-[var(--text-muted)] mb-2">
                The photos you attached to this entry. Nothing has been measured or scored from
                them.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {entry.photos.map((photo) => (
                  <figure key={photo.assetId}>
                    <PrivatePhoto
                      assetId={photo.assetId}
                      label={`Your photo from ${photo.date}${photo.view ? `, ${photo.view} view` : ''}`}
                    />
                    <figcaption className="text-[11px] text-[var(--text-muted)] mt-1">
                      {photo.date} · {photo.view}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

/**
 * Side-by-side view of two of the user's OWN check-ins.
 *
 * The only derived number is how many days apart the two dates are. There is no
 * automated comparison of the images: no scoring, no measurement, no verdict.
 */
export function PhotoComparison({ checkins }: { checkins: CheckinOption[] }) {
  const withPhotos = useMemo(() => checkins.filter((c) => c.photos.length > 0), [checkins]);
  const [leftId, setLeftId] = useState(withPhotos.at(-1)?.id ?? '');
  const [rightId, setRightId] = useState(withPhotos[0]?.id ?? '');

  if (withPhotos.length < 2) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Once you have two check-ins with photos, you can put them side by side here. GymOS will show
        them with their dates and nothing else — no score, no measurement, no verdict.
      </p>
    );
  }

  const left = withPhotos.find((c) => c.id === leftId) ?? withPhotos[0]!;
  const right = withPhotos.find((c) => c.id === rightId) ?? withPhotos[0]!;
  const daysApart = Math.round(
    Math.abs(Date.parse(`${right.date}T00:00:00.000Z`) - Date.parse(`${left.date}T00:00:00.000Z`)) /
      DAY_MS,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Earlier or later" htmlFor="compare-left">
          <Select id="compare-left" value={left.id} onChange={(e) => setLeftId(e.target.value)}>
            {withPhotos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.date} ({c.photos.length} photo{c.photos.length === 1 ? '' : 's'})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Compared with" htmlFor="compare-right">
          <Select id="compare-right" value={right.id} onChange={(e) => setRightId(e.target.value)}>
            {withPhotos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.date} ({c.photos.length} photo{c.photos.length === 1 ? '' : 's'})
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        {daysApart} day{daysApart === 1 ? '' : 's'} apart. That is calendar arithmetic on the dates
        you chose — the only number on this screen. Nothing in the photographs has been analysed.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {[left, right].map((side, index) => (
          <div key={`${side.id}-${index}`} className="space-y-2">
            <p className="text-sm font-medium tabular-nums">{side.date}</p>
            <div className="grid grid-cols-2 gap-2">
              {side.photos.map((photo) => (
                <figure key={photo.assetId}>
                  <PrivatePhoto
                    assetId={photo.assetId}
                    label={`Your photo from ${side.date}, ${photo.view} view`}
                    className="h-48 w-full rounded-lg object-cover bg-[var(--surface-sunken)]"
                  />
                  <figcaption className="text-[11px] text-[var(--text-muted)] mt-1">
                    {photo.view}
                    {photo.caption ? ` · ${photo.caption}` : ''}
                  </figcaption>
                </figure>
              ))}
            </div>
            {side.note ? (
              <p className="text-sm text-[var(--text-muted)] whitespace-pre-wrap">
                Your note: {side.note}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==========================================================================
 * Media-privacy controls.
 *
 * These live in this file rather than their own component module because this
 * module owns a fixed set of files; they are the interactive half of
 * /settings/media-privacy, whose read-only parts render on the server.
 * ========================================================================== */

export interface MediaFileProp {
  id: string;
  kind: string;
  mimeType: string;
  byteSize: number;
  metadataStripped: boolean;
  durationSeconds: number | null;
  createdAt: string;
}

export interface GrantProp {
  id: string;
  assetId: string;
  grantedToUserId: string | null;
  reason: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Revoking a media consent DELETES the media collected under it. That is stated
 * before the destructive click, not after, and the click itself is two-step.
 */
export function MediaConsentToggle({
  kind,
  title,
  body,
  granted,
  fileCount,
  disabled,
  disabledReason,
}: {
  kind: 'photo_journal' | 'voice_recording';
  title: string;
  body: string;
  granted: boolean;
  fileCount: number;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, setState] = useState<MediaActionState>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-sm">{title}</p>
          <p className="text-sm text-[var(--text-muted)] mt-1 leading-relaxed">{body}</p>
          {disabled && disabledReason ? (
            <p className="text-xs text-warn-500 mt-2">{disabledReason}</p>
          ) : null}
        </div>
        <Badge tone={granted ? 'ok' : 'neutral'}>{granted ? 'On' : 'Off'}</Badge>
      </div>

      {granted && confirming ? (
        <Notice tone="warn" className="mt-3" title="This deletes your files">
          Turning this off immediately and permanently deletes the {fileCount} file(s) stored under
          it. The encrypted bytes are removed from disk and each removal is written to the deletion
          log below. There is no undo and no copy kept.
        </Notice>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {granted ? (
          confirming ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={pending || disabled}
                onClick={() =>
                  startTransition(async () => {
                    setState(await setMediaConsentAction(kind, false));
                    setConfirming(false);
                  })
                }
              >
                Yes, turn off and delete {fileCount} file(s)
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                Keep it on
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || disabled}
              onClick={() => setConfirming(true)}
            >
              Turn off
            </Button>
          )
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pending || disabled}
            onClick={() =>
              startTransition(async () => {
                setState(await setMediaConsentAction(kind, true));
              })
            }
          >
            Turn on
          </Button>
        )}
      </div>
      <Feedback state={state} />
    </div>
  );
}

export function MediaFileList({ files }: { files: MediaFileProp[] }) {
  const [state, setState] = useState<MediaActionState>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (files.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">You have no files stored.</p>;
  }

  return (
    <div className="space-y-2">
      <Feedback state={state} />
      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5"
        >
          {file.kind === 'photo' ? (
            <PrivatePhoto
              assetId={file.id}
              label="One of your stored photos"
              className="h-12 w-12 rounded-md object-cover bg-[var(--surface-sunken)]"
            />
          ) : (
            <audio controls preload="none" src={`/api/media/${file.id}`} className="h-10 w-48">
              <track kind="captions" />
            </audio>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {file.kind} · {file.mimeType}
            </p>
            <p className="text-xs text-[var(--text-muted)] tabular-nums">
              {(file.byteSize / 1024).toFixed(0)} KB · added {file.createdAt.slice(0, 10)}
              {file.metadataStripped ? ' · metadata stripped on upload' : ' · metadata not stripped'}
              {file.durationSeconds ? ` · ${file.durationSeconds}s` : ''}
            </p>
          </div>
          {confirming === file.id ? (
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setState(await deleteMediaAssetAction(file.id));
                  setConfirming(null);
                })
              }
            >
              Confirm delete
            </Button>
          ) : (
            <Button type="button" size="sm" variant="quiet" onClick={() => setConfirming(file.id)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Delete this file permanently</span>
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export function GrantList({ grants }: { grants: GrantProp[] }) {
  const [state, setState] = useState<MediaActionState>({});
  const [pending, startTransition] = useTransition();
  const active = grants.filter((grant) => !grant.revokedAt);

  return (
    <div className="space-y-3">
      <Feedback state={state} />
      {active.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          Nothing of yours is shared with anyone, and in this build nothing can be: there is
          no control anywhere in GymOS that creates a share. Finding another account to share
          with would mean looking it up by email, which would leak whether an account exists,
          so that is deferred rather than guessed at. This list and its revoke buttons are the
          other half, built and tested, ready for when there is something to revoke.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {active.map((grant) => (
              <li
                key={grant.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm">File {grant.assetId.slice(0, 8)}…</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    shared {grant.createdAt.slice(0, 10)}
                    {grant.expiresAt ? ` · expires ${grant.expiresAt.slice(0, 10)}` : ' · no expiry'}
                    {grant.reason ? ` · ${grant.reason}` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setState(await revokeGrantAction(grant.id));
                    })
                  }
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setState(await revokeAllGrantsAction());
              })
            }
          >
            Revoke every share
          </Button>
        </>
      )}

      {grants.length > active.length ? (
        <p className="text-xs text-[var(--text-muted)]">
          {grants.length - active.length} previously revoked share(s) are kept in the record so the
          history stays verifiable.
        </p>
      ) : null}
    </div>
  );
}
