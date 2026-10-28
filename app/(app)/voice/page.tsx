import type { Metadata } from 'next';
import Link from 'next/link';
import { Mic, Target } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import {
  listCommunicationGoals,
  listPracticeSessions,
  progressSeries,
  voiceCapability,
} from '@/lib/services/voice';
import { VOICE_SCRIPTS, VOICE_SCRIPT_KIND_LABELS } from '@/lib/content/voice-scripts';
import { PACE_REFERENCE_NOTE } from '@/lib/engines/voice-metrics';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  KeyValue,
  LinkButton,
  Notice,
  PageHeader,
  Section,
  Stat,
} from '@/components/ui';
import { createGoalFormAction, archiveGoalFormAction, deleteGoalFormAction } from './actions';

export const metadata: Metadata = { title: 'Voice & communication' };

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export default async function VoicePage() {
  const user = await requireUser();
  const goals = listCommunicationGoals(user.id, { includeInactive: true });
  const recent = listPracticeSessions(user.id, { limit: 5 });
  const progress = progressSeries(user.id, { limit: 200 });
  const capability = voiceCapability(user.id);

  const kinds = [...new Set(VOICE_SCRIPTS.map((s) => s.kind))];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Voice & communication"
        title="Speaking practice"
        description="Practise out loud against a script or a brief, and keep a record of what was actually measured."
        action={
          <LinkButton href="/voice/practice" size="lg">
            <Mic className="h-4 w-4" aria-hidden="true" />
            Start practising
          </LinkButton>
        }
      />

      <Notice tone="brand" title="Nothing you say is transcribed">
        <p className="mb-2">
          GymOS has no speech-recognition model in this build, and it does not call one over the
          network. That is a real limitation, not a privacy flourish, and it decides what this
          feature can honestly tell you:
        </p>
        <ul className="space-y-1.5 list-disc pl-5">
          <li>
            <strong>Measured from your recording:</strong> how long the take was, how much of it was
            speech rather than silence, how many times you paused and how long the longest pause
            was. All of it computed in your browser from the actual audio.
          </li>
          <li>
            <strong>Measured only with a script:</strong> words per minute. It needs a word count,
            and the only word count GymOS can have is one from a script you read in full.
          </li>
          <li>
            <strong>Self-reported by you:</strong> filler words, which you tap during playback, and
            your own sense of how clear the take felt.
          </li>
          <li>
            <strong>Never:</strong> a transcript, a score for your voice, a judgement of your accent
            or tone, or a comparison with anyone else. There is no column for any of that and no
            code that produces it.
          </li>
        </ul>
      </Notice>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Sessions logged" value={progress.totals.sessions} />
        <Stat
          label="Time practised"
          value={formatDuration(progress.totals.totalDurationSeconds)}
          hint="Measured"
        />
        <Stat
          label="With a recording"
          value={progress.totals.sessionsWithRecording}
          hint="The rest were timed practice"
        />
        <Stat
          label="With measured pace"
          value={progress.totals.sessionsWithMeasuredPace}
          hint="Needed a known script"
        />
      </div>

      {capability.reason ? (
        <Notice tone="warn" title="Recording is off for this account">
          <p>{capability.reason}</p>
          {!capability.ageEligible ? null : (
            <p className="mt-2">
              {/* The voice_recording toggle lives on the media-privacy page. */}
              <Link href="/settings/media-privacy" className="underline">
                Settings → Media privacy
              </Link>
            </p>
          )}
        </Notice>
      ) : null}

      <Section
        title="What you are working on"
        description="Your own goals, in your own words. GymOS does not grade them or score your progress against them — it just keeps them next to the practice."
      >
        <Card className="p-5 space-y-5">
          <form action={createGoalFormAction} className="flex flex-wrap gap-2">
            <label htmlFor="voice-goal-label" className="sr-only">
              New communication goal
            </label>
            <Input
              id="voice-goal-label"
              name="label"
              required
              minLength={3}
              maxLength={160}
              placeholder="e.g. stop rushing the last line of an update"
              className="flex-1 min-w-56"
            />
            <Button type="submit">Add goal</Button>
          </form>

          {goals.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No goals yet. They are only for your own reference; nothing here scores you against
              them.
            </p>
          ) : (
            <ul className="space-y-2">
              {goals.map((goal) => (
                <li
                  key={goal.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3.5 py-2.5 text-sm"
                >
                  <span className="min-w-0">
                    {goal.label}
                    {goal.active ? null : (
                      <Badge tone="neutral" className="ml-2">
                        Archived
                      </Badge>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-1.5">
                    <form action={archiveGoalFormAction}>
                      <input type="hidden" name="goalId" value={goal.id} />
                      {goal.active ? null : <input type="hidden" name="active" value="on" />}
                      <Button type="submit" variant="quiet" size="sm">
                        {goal.active ? 'Archive' : 'Reopen'}
                      </Button>
                    </form>
                    <form action={deleteGoalFormAction}>
                      <input type="hidden" name="goalId" value={goal.id} />
                      <Button type="submit" variant="quiet" size="sm">
                        Delete
                      </Button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section
        title="What to practise"
        description={`${VOICE_SCRIPTS.length} scripts and briefs, all written for GymOS so you can read them aloud freely.`}
        action={
          <LinkButton href="/voice/practice" variant="secondary">
            Open the recorder
          </LinkButton>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {kinds.map((kind) => {
            const forKind = VOICE_SCRIPTS.filter((s) => s.kind === kind);
            return (
              <Card key={kind} className="p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">{VOICE_SCRIPT_KIND_LABELS[kind]}</h3>
                  <Badge tone="neutral">{forKind.length}</Badge>
                </div>
                <ul className="space-y-2 text-sm">
                  {forKind.map((script) => (
                    <li key={script.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">{script.title}</span>
                      <span className="shrink-0 text-xs text-[var(--text-muted)] tabular-nums">
                        {script.mode === 'read_aloud'
                          ? `${script.wordCount} words`
                          : `~${Math.round(script.estimatedSeconds / 15) * 15}s brief`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      </Section>

      <Section
        title="Recent takes"
        description="Measured values only. A dash means GymOS did not measure it, not that it was zero."
        action={
          recent.length > 0 ? (
            <LinkButton href="/voice/history" variant="secondary">
              Full history
            </LinkButton>
          ) : undefined
        }
      >
        {recent.length === 0 ? (
          <EmptyState
            icon={<Target className="h-5 w-5" aria-hidden="true" />}
            title="No practice logged yet"
            description="Pick a script, run the timer, and the take will show up here with whatever was genuinely measured."
            action={<LinkButton href="/voice/practice">Start practising</LinkButton>}
          />
        ) : (
          <Card className="p-5">
            <KeyValue
              items={recent.map((session) => ({
                label: `${session.date} · ${session.scriptTitle ?? 'Own words'}`,
                value: (
                  <span className="tabular-nums">
                    {formatDuration(session.durationSeconds)}
                    {' · '}
                    {session.wordsPerMinute === null ? '— wpm' : `${session.wordsPerMinute} wpm`}
                    {' · '}
                    {session.pauseCount === null ? '— pauses' : `${session.pauseCount} pauses`}
                  </span>
                ),
              }))}
            />
          </Card>
        )}
      </Section>

      <Notice tone="neutral" title="About the pace reference">
        {PACE_REFERENCE_NOTE}
      </Notice>
    </div>
  );
}
