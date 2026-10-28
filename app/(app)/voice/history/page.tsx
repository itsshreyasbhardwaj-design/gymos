import type { Metadata } from 'next';
import { requireUser } from '@/lib/auth/session';
import { getPracticeSession, listPracticeSessions, progressSeries } from '@/lib/services/voice';
import { ENGINE_FEEDBACK_METRICS, PACE_REFERENCE_NOTE } from '@/lib/engines/voice-metrics';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LinkButton,
  Notice,
  PageHeader,
  Section,
  Stat,
  Textarea,
} from '@/components/ui';
import {
  addNoteFormAction,
  deleteNoteFormAction,
  deleteSessionFormAction,
  deleteRecordingFormAction,
} from '../actions';

export const metadata: Metadata = { title: 'Voice practice history' };

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** A dash, not a zero: an unmeasured value is not a measurement of nothing. */
function orDash(value: number | null, render: (v: number) => string): string {
  return value === null ? '—' : render(value);
}

/**
 * Whether this row is one the user wrote, rather than one the metrics engine
 * generated. Only their own notes get a Remove button: the engine's rows are
 * rewritten from the measurements whenever a take is saved, so removing one would
 * be undone, and a measurement is not a note.
 *
 * An exact name comparison is sound here only because `addFeedback` refuses a note
 * whose name collides with an engine metric name. Without that, a note the user
 * called "duration" would land on the wrong side of this test and show no Remove
 * button — a row they own and cannot delete.
 */
function isOwnNote(metric: string): boolean {
  return !(ENGINE_FEEDBACK_METRICS as readonly string[]).includes(metric);
}

export default async function VoiceHistoryPage({
  searchParams,
}: {
  /** `note` is the outcome of the add/remove-note forms. See ../actions.ts. */
  searchParams: Promise<{ note?: string }>;
}) {
  const { note } = await searchParams;
  const user = await requireUser();
  const sessions = listPracticeSessions(user.id, { limit: 100 });
  const progress = progressSeries(user.id, { limit: 200 });
  const detailed = sessions.slice(0, 20).map((row) => getPracticeSession(user.id, row.id));

  if (sessions.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Voice & communication" title="Practice history" />
        <EmptyState
          title="Nothing logged yet"
          description="Once you save a practice take it appears here, with every number labelled as measured or self-reported."
          action={<LinkButton href="/voice/practice">Start practising</LinkButton>}
        />
      </div>
    );
  }

  const paced = progress.points.filter((p) => p.wordsPerMinute !== null);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Voice & communication"
        title="Practice history"
        description="Your own record of what was measured. Nothing on this page was transcribed, inferred or estimated."
        action={<LinkButton href="/voice/practice">New take</LinkButton>}
      />

      {note === 'added' ? (
        <Notice tone="ok">Note added to that take, and recorded as self-reported.</Notice>
      ) : null}
      {note === 'removed' ? <Notice tone="ok">Note removed from that take.</Notice> : null}
      {note === 'refused' ? (
        <Notice tone="warn" title="That note was not saved">
          Three things will stop a note being saved. A name shorter than two characters. A name that
          rates appearance, physique or voice quality — GymOS keeps no such measurement, so it will
          not keep one under that name either. And a name already used by the measurements above (
          {ENGINE_FEEDBACK_METRICS.join(', ').replace(/_/g, ' ')}): those rows are rewritten every
          time the take is saved, so a note sharing one of their names would be wiped and, until it
          was, could not be removed. Your own wording is always fine.
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Takes" value={progress.totals.sessions} />
        <Stat
          label="Time practised"
          value={formatDuration(progress.totals.totalDurationSeconds)}
          hint="Measured"
        />
        <Stat
          label="With a recording"
          value={progress.totals.sessionsWithRecording}
          hint="Audio metrics available"
        />
        <Stat
          label="With measured pace"
          value={progress.totals.sessionsWithMeasuredPace}
          hint="Read a known script in full"
        />
      </div>

      <Notice tone="neutral" title="How to read this page">
        <p>{progress.note}</p>
        <p className="mt-2">
          <strong>Measured:</strong> {progress.measuredMetrics.join(', ')}.{' '}
          <strong>Self-reported:</strong> {progress.selfReportedMetrics.join(', ')}.
        </p>
      </Notice>

      <Section
        title="Measured pace over time"
        description="Only the takes where a known script was read in full, oldest first. The others are not plotted, because there is no honest number to plot."
      >
        {paced.length === 0 ? (
          <Card className="p-5 text-sm text-[var(--text-muted)]">
            No take yet has a measured words-per-minute. It needs a read-aloud script and your
            confirmation that you read all of it.
          </Card>
        ) : (
          <Card className="p-5">
            <ol className="space-y-2 text-sm">
              {paced.map((point) => (
                <li key={point.sessionId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    {point.date} · {point.scriptTitle ?? 'Own words'}
                  </span>
                  <span className="shrink-0 tabular-nums">{point.wordsPerMinute} wpm</span>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </Section>

      <Section title="Every take" description="Most recent first.">
        <div className="space-y-4">
          {detailed.map(({ session, script, recordings, feedback }) => (
            <Card key={session.id}>
              <CardHeader
                title={script?.title ?? 'Speaking in my own words'}
                subtitle={`${session.date} · ${formatDuration(session.durationSeconds)}${
                  recordings.length > 0 ? ' · recording attached' : ' · timed practice, no audio'
                }`}
                action={
                  <form action={deleteSessionFormAction}>
                    <input type="hidden" name="sessionId" value={session.id} />
                    <Button type="submit" variant="quiet" size="sm">
                      Delete
                    </Button>
                  </form>
                }
              />
              <div className="px-5 pb-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat
                    label="Duration"
                    value={formatDuration(session.durationSeconds)}
                    hint="Measured"
                  />
                  <Stat
                    label="Words per minute"
                    value={orDash(session.wordsPerMinute, (v) => String(v))}
                    hint={session.wordsPerMinute === null ? 'Not measured' : 'Measured from script'}
                  />
                  <Stat
                    label="Pauses"
                    value={orDash(session.pauseCount, (v) => String(v))}
                    hint={
                      session.pauseCount !== null
                        ? 'Measured in your browser'
                        : recordings.length > 0
                          ? 'Not measured for this take'
                          : 'No audio to measure'
                    }
                  />
                  <Stat
                    label="Speaking ratio"
                    value={orDash(session.speakingRatio, (v) => `${Math.round(v * 100)}%`)}
                    hint={
                      session.speakingRatio !== null
                        ? 'Measured in your browser'
                        : recordings.length > 0
                          ? 'Not measured for this take'
                          : 'No audio to measure'
                    }
                  />
                </div>

                {recordings.length > 0 ? (
                  <div className="space-y-2">
                    {recordings.map((recording) => (
                      <div key={recording.id} className="space-y-1.5">
                        {/* The only route to stored media: the authenticated handler. */}
                        <audio src={`/api/media/${recording.assetId}`} controls className="w-full">
                          <track kind="captions" label="No captions: nothing is transcribed" />
                        </audio>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-[var(--text-muted)]">
                            Encrypted on disk, served only to you. Nothing was transcribed. Deleting
                            it also clears the pauses and speaking ratio measured from it, because
                            they describe this audio.
                          </p>
                          <form action={deleteRecordingFormAction}>
                            <input type="hidden" name="recordingId" value={recording.id} />
                            <Button type="submit" variant="quiet" size="sm">
                              Delete recording
                            </Button>
                          </form>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {session.reflection ? (
                  <p className="text-sm leading-relaxed rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3.5">
                    <span className="font-medium">Your note: </span>
                    {session.reflection}
                  </p>
                ) : null}

                {feedback.length > 0 ? (
                  <ul className="divide-y divide-[var(--border)] text-sm">
                    {feedback.map((entry) => (
                      <li key={entry.id} className="py-2.5 flex items-start justify-between gap-4">
                        <span className="min-w-0">
                          <span className="font-medium">{entry.metric.replace(/_/g, ' ')}</span>
                          {entry.observation ? (
                            <span className="block text-xs text-[var(--text-muted)] mt-0.5">
                              {entry.observation}
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 flex items-start gap-2 text-right">
                          <span>
                            <span className="tabular-nums">
                              {entry.value === null ? '—' : entry.value}
                              {entry.unit ? ` ${entry.unit}` : ''}
                            </span>
                            <Badge
                              tone={entry.source === 'measured' ? 'teal' : 'neutral'}
                              className="ml-2"
                            >
                              {entry.source === 'measured' ? 'measured' : 'self-reported'}
                            </Badge>
                          </span>
                          {isOwnNote(entry.metric) ? (
                            <form action={deleteNoteFormAction}>
                              <input type="hidden" name="feedbackId" value={entry.id} />
                              <Button type="submit" variant="quiet" size="sm">
                                Remove
                              </Button>
                            </form>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* The user's own observations about this take. Stored as
                    self-reported, and the service refuses a metric name that
                    would make it an appearance or voice-quality rating. */}
                <form
                  action={addNoteFormAction}
                  className="rounded-xl border border-[var(--border)] p-4 space-y-3"
                >
                  <input type="hidden" name="sessionId" value={session.id} />
                  <p className="text-sm font-medium">Add your own observation</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label="What you are noting"
                      htmlFor={`note-metric-${session.id}`}
                      required
                    >
                      <Input
                        id={`note-metric-${session.id}`}
                        name="metric"
                        required
                        minLength={2}
                        maxLength={80}
                        placeholder="e.g. rushed the last line"
                      />
                    </Field>
                    <Field
                      label="Number (optional)"
                      htmlFor={`note-value-${session.id}`}
                      hint="Only if it is countable."
                    >
                      <Input
                        id={`note-value-${session.id}`}
                        name="value"
                        type="number"
                        step="any"
                        inputMode="decimal"
                      />
                    </Field>
                    <Field label="Unit (optional)" htmlFor={`note-unit-${session.id}`}>
                      <Input
                        id={`note-unit-${session.id}`}
                        name="unit"
                        maxLength={24}
                        placeholder="e.g. times"
                      />
                    </Field>
                  </div>
                  <Field label="Your note (optional)" htmlFor={`note-observation-${session.id}`}>
                    <Textarea
                      id={`note-observation-${session.id}`}
                      name="observation"
                      maxLength={1000}
                      placeholder="In your own words. Nothing here is analysed or scored."
                    />
                  </Field>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" variant="secondary" size="sm">
                      Add note
                    </Button>
                    <span className="text-xs text-[var(--text-muted)]">
                      Saved as self-reported, because it is yours. GymOS will refuse a name that
                      rates appearance, physique or voice quality — it does not keep those — and a
                      name already used by the measurements above, which get rewritten on every
                      save.
                    </span>
                  </div>
                </form>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Notice tone="neutral" title="About the pace reference">
        {PACE_REFERENCE_NOTE}
      </Notice>
    </div>
  );
}
