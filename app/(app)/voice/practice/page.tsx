import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { listCommunicationGoals, voiceCapability } from '@/lib/services/voice';
import { VOICE_PRACTICE_KINDS } from '@/lib/db/schema';
import { VOICE_SCRIPTS, VOICE_SCRIPT_KIND_LABELS } from '@/lib/content/voice-scripts';
import { Notice, PageHeader } from '@/components/ui';
import { VoiceRecorder } from '@/components/voice-recorder';

export const metadata: Metadata = { title: 'Voice practice' };

const KIND_FALLBACK_LABELS: Record<string, string> = {
  free_speaking: 'Free speaking',
  script_reading: 'Reading for pace',
  presentation: 'Presenting',
  interview: 'Interview answer',
  pronunciation: 'Articulation drill',
  conversation: 'Conversation',
};

export default async function VoicePracticePage() {
  const user = await requireUser();
  const capability = voiceCapability(user.id);
  const goals = listCommunicationGoals(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voice & communication"
        title="Practise"
        description="Pick something to say, say it, then listen back. Everything saved here is labelled with where it came from."
      />

      {!capability.canRecord ? (
        <Notice tone="warn" title="This account cannot save audio">
          <p>{capability.reason}</p>
          {capability.ageEligible ? (
            <p className="mt-2">
              {/* The voice_recording toggle lives on the media-privacy page. */}
              <Link href="/settings/media-privacy" className="underline">
                Open Settings → Media privacy
              </Link>
            </p>
          ) : null}
          <p className="mt-2">
            The practice below still runs: the timer, every script, the filler counter and your own
            notes all work. Only the numbers that can only come from audio — pauses and speaking
            ratio — will be left unmeasured, and the page will say so rather than filling them in.
          </p>
        </Notice>
      ) : null}

      <VoiceRecorder
        canRecord={capability.canRecord}
        recordingUnavailableReason={capability.reason}
        goals={goals.map((goal) => ({ id: goal.id, label: goal.label }))}
        kinds={VOICE_PRACTICE_KINDS.map((kind) => ({
          value: kind,
          label: KIND_FALLBACK_LABELS[kind] ?? kind,
        }))}
        scripts={VOICE_SCRIPTS.map((script) => ({
          id: script.id,
          title: script.title,
          kind: script.kind,
          kindLabel: VOICE_SCRIPT_KIND_LABELS[script.kind],
          mode: script.mode,
          text: script.text,
          focus: script.focus,
          wordCount: script.wordCount,
          spokenWordCount: script.spokenWordCount,
          estimatedSeconds: script.estimatedSeconds,
        }))}
      />
    </div>
  );
}
