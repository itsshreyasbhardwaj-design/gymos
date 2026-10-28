'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Mic, Square, Timer, Plus, RotateCcw, Save } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
  Stat,
  Textarea,
} from '@/components/ui';
import { analyseAudioEnergy, computeVoiceMetrics } from '@/lib/engines/voice-metrics';
import type { Pause, VoiceMetricsResult } from '@/lib/engines/voice-metrics';
import { savePracticeAction, type ActionState } from '@/app/(app)/voice/actions';

export interface RecorderScript {
  id: string;
  title: string;
  kind: string;
  kindLabel: string;
  mode: 'read_aloud' | 'prompt';
  text: string;
  focus: string;
  wordCount: number;
  spokenWordCount: number | null;
  estimatedSeconds: number;
}

export interface RecorderGoal {
  id: string;
  label: string;
}

/**
 * Container formats worth asking for, best first. Whatever the browser gives back,
 * the base type (before the codec parameter) is what the media service validates
 * against its own allowlist, so an unexpected container is refused there rather
 * than quietly stored.
 */
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // isTypeSupported can throw on some older engines; try the next candidate.
    }
  }
  return null;
}

function baseMimeType(mime: string): string {
  return (mime.split(';')[0] ?? mime).trim();
}

function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/** Mixes every channel down to one, which is what the energy analysis expects. */
function monoSamples(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const first = buffer.getChannelData(0);
  if (channels === 1) return first;
  const out = new Float32Array(first.length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) + (data[i] ?? 0) / channels;
  }
  return out;
}

type Status = 'idle' | 'running' | 'processing' | 'review';
type Mode = 'audio' | 'timer';

interface Measured {
  pauses: Pause[];
  speakingRatio: number;
  durationSeconds: number;
}

/**
 * The practice recorder.
 *
 * Two paths, and both are real practice:
 *
 *  - TIMER ONLY — always available, including for under-18 accounts and anyone with
 *    voice recording switched off. The stopwatch measurement is genuine; the
 *    audio-derived numbers are simply absent, and the page says so.
 *  - WITH A RECORDING — needs MediaRecorder, a microphone the user grants, and the
 *    18+ voice consent. The recorded buffer is decoded and analysed here in the
 *    browser with the Web Audio API, so duration, speaking ratio and pauses are
 *    measured from the actual samples.
 *
 * Nothing is transcribed. There is no speech-recognition model in this build, so
 * filler words are counted by the user tapping during playback, and that is stored
 * as self-reported. The blob URL below is playback of bytes that have not left the
 * browser yet; saved recordings are only ever served from /api/media/<id>.
 */
export function VoiceRecorder({
  scripts,
  goals,
  kinds,
  canRecord,
  recordingUnavailableReason,
}: {
  scripts: RecorderScript[];
  goals: RecorderGoal[];
  kinds: { value: string; label: string }[];
  canRecord: boolean;
  recordingUnavailableReason: string | null;
}) {
  const [scriptId, setScriptId] = useState<string>(scripts[0]?.id ?? '');
  const [fallbackKind, setFallbackKind] = useState<string>('free_speaking');
  const [goalId, setGoalId] = useState<string>('');
  const [status, setStatus] = useState<Status>('idle');
  const [mode, setMode] = useState<Mode>('timer');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [preview, setPreview] = useState<VoiceMetricsResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string>('');
  // Null means "not counted", which is not the same as counted zero. It stays null
  // until the user taps, so a take where nobody touched the counter saves without a
  // filler observation rather than with a self-reported 0 nobody reported.
  const [fillerTaps, setFillerTaps] = useState<number | null>(null);
  const [clarity, setClarity] = useState<string>('');
  const [readWholeScript, setReadWholeScript] = useState(false);
  const [reflection, setReflection] = useState('');
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  const startedAtRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const urlRef = useRef<string | null>(null);

  const script = scripts.find((s) => s.id === scriptId) ?? null;
  const kind = script ? script.kind : fallbackKind;
  const canMeasurePace = script !== null && script.spokenWordCount !== null;

  // The stopwatch lives here rather than in the handlers: reading the clock is an
  // impure call, which belongs in an effect. elapsedMs is genuinely external state
  // (wall-clock time), not state derived from props.
  useEffect(() => {
    if (status !== 'running') return;
    startedAtRef.current = Date.now();
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 100);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  function resetTake(): void {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setAudioUrl(null);
    setAudioBlob(null);
    setAudioMimeType('');
    setMeasured(null);
    setPreview(null);
    setElapsedMs(0);
    setFillerTaps(null);
    setStatus('idle');
    setState({});
  }

  function startTimerOnly(): void {
    resetTake();
    setDeviceError(null);
    setMode('timer');
    setStatus('running');
  }

  async function startRecording(): Promise<void> {
    resetTake();
    setDeviceError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setDeviceError(
        'This browser does not expose a microphone to web pages, so GymOS cannot record here. The timed practice below works without one.',
      );
      return;
    }
    const mimeType = pickMimeType();
    if (!mimeType) {
      setDeviceError(
        'This browser has no MediaRecorder audio format GymOS can store, so it cannot record here. The timed practice below works without one.',
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setDeviceError(
        `The microphone was not available: ${err instanceof Error ? err.message : 'permission denied'}. Nothing was recorded. The timed practice below works without a microphone.`,
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const blob = new Blob(chunksRef.current, { type: baseMimeType(mimeType) });
      void finishAudioTake(blob, baseMimeType(mimeType));
    };

    setMode('audio');
    setAudioMimeType(baseMimeType(mimeType));
    recorder.start();
    setStatus('running');
  }

  /** Decodes the real recorded bytes and measures them. No estimate, no fallback. */
  async function finishAudioTake(blob: Blob, mimeType: string): Promise<void> {
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setAudioUrl(url);
    setAudioBlob(blob);
    setAudioMimeType(mimeType);

    try {
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(await blob.arrayBuffer());
      const analysis = analyseAudioEnergy(monoSamples(buffer), buffer.sampleRate);
      void context.close();
      const next: Measured = {
        pauses: analysis.pauses,
        speakingRatio: analysis.speakingRatio,
        durationSeconds: analysis.durationSeconds,
      };
      setMeasured(next);
      setPreview(
        computeVoiceMetrics({
          durationSeconds: next.durationSeconds,
          scriptWordCount: null,
          pauses: next.pauses,
          speakingRatio: next.speakingRatio,
        }),
      );
    } catch (err) {
      setMeasured(null);
      setPreview(null);
      setDeviceError(
        `The recording was captured but this browser could not decode it for analysis (${err instanceof Error ? err.message : 'decode failed'}). You can still play it back and save it; pauses and speaking ratio will be left unmeasured rather than guessed.`,
      );
    }
    setStatus('review');
  }

  function stop(): void {
    if (mode === 'audio' && recorderRef.current && recorderRef.current.state !== 'inactive') {
      // Stops the stopwatch straight away; the measured duration will come from the
      // decoded audio rather than from the timer.
      setStatus('processing');
      recorderRef.current.stop();
      return;
    }
    setStatus('review');
  }

  function save(): void {
    const data = new FormData();
    data.set('kind', kind);
    if (script) data.set('scriptId', script.id);
    if (goalId) data.set('goalId', goalId);
    // Always the stopwatch, which is measured on both paths. The audio duration
    // travels inside `measurements` and the server prefers it when it accepts the
    // analysis, so a rejected analysis costs the take its pauses, not its duration.
    data.set('durationSeconds', String(Math.max(0, Math.round(elapsedMs / 1000))));
    if (measured) data.set('measurements', JSON.stringify(measured));
    if (canMeasurePace && readWholeScript) data.set('readWholeScript', 'on');
    // Only when the user actually counted. See the fillerTaps declaration.
    if (fillerTaps !== null) data.set('fillerTally', String(fillerTaps));
    if (clarity) data.set('selfRatedClarity', clarity);
    data.set('reflection', reflection);
    if (audioBlob && canRecord) {
      data.set(
        'audio',
        audioBlob,
        `practice-take.${audioMimeType.includes('mp4') ? 'm4a' : 'webm'}`,
      );
      data.set('audioMimeType', audioMimeType);
    }
    startTransition(async () => {
      const result = await savePracticeAction({}, data);
      setState(result);
      if (!result.error) {
        setStatus('idle');
        setReflection('');
        setClarity('');
        setReadWholeScript(false);
      }
    });
  }

  const liveSeconds = Math.round(elapsedMs / 1000);
  const takeSeconds = measured ? Math.round(measured.durationSeconds) : liveSeconds;

  return (
    <div className="space-y-6">
      <Notice tone="brand" title="What GymOS measures, and what it does not">
        <p>
          There is no speech recognition in this build, so{' '}
          <strong>nothing you say is transcribed</strong> and no transcript is stored anywhere. What
          is genuinely measured from a recording is its duration, how much of it was speech rather
          than silence, and where the pauses fell. Those four are worked out{' '}
          <strong>here in your browser</strong>, from the decoded audio; the server has no audio
          decoder, so it cannot re-derive them and will refuse any result that could not have come
          from that analysis rather than store a plausible-looking number. Words per minute is only
          available when you read a script whose length GymOS already knows. Filler words are
          counted by you tapping the button during playback, and are saved as self-reported.
        </p>
      </Notice>

      {!canRecord && recordingUnavailableReason ? (
        <Notice tone="warn" title="Recording is off for this account">
          {recordingUnavailableReason}
        </Notice>
      ) : null}

      <Card>
        <CardHeader
          title="1. Choose what to practise"
          subtitle="Every script below was written for GymOS, so you can read it aloud freely."
        />
        <div className="px-5 pb-5 grid gap-3 sm:grid-cols-2">
          <Field label="Script" htmlFor="voice-script">
            <Select
              id="voice-script"
              value={scriptId}
              onChange={(e) => setScriptId(e.target.value)}
              disabled={status === 'running'}
            >
              <option value="">No script — speaking in my own words</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.kindLabel}: {s.title}
                </option>
              ))}
            </Select>
          </Field>
          {script ? (
            <Field label="Practice kind" hint="Taken from the script you picked.">
              <Input value={script.kindLabel} readOnly disabled />
            </Field>
          ) : (
            <Field label="Practice kind" htmlFor="voice-kind">
              <Select
                id="voice-kind"
                value={fallbackKind}
                onChange={(e) => setFallbackKind(e.target.value)}
                disabled={status === 'running'}
              >
                {kinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {goals.length > 0 ? (
            <Field label="Link to a goal" htmlFor="voice-goal" hint="Optional.">
              <Select id="voice-goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">No goal</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        {script ? (
          <div className="px-5 pb-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="teal">{script.kindLabel}</Badge>
              {script.mode === 'read_aloud' ? (
                <Badge tone="ok">{script.wordCount} words to read aloud</Badge>
              ) : (
                <Badge tone="neutral">Your own words — word count unknown</Badge>
              )}
              <Badge tone="neutral">about {formatSeconds(script.estimatedSeconds)}</Badge>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">Focus: </span>
              {script.focus}
            </p>
            <p className="whitespace-pre-wrap text-base leading-relaxed rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-4">
              {script.text}
            </p>
            {script.mode === 'prompt' ? (
              <p className="text-xs text-[var(--text-muted)]">
                This is a brief, not a script. Because the words will be your own, GymOS cannot know
                how many you said, so words per minute stays unmeasured for this take.
              </p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="2. Practise"
          subtitle="Record it, or run the timer on its own. Both are real practice; they differ only in what can be measured."
        />
        <div className="px-5 pb-5 space-y-4">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-semibold tabular-nums">
              {formatSeconds(status === 'running' ? liveSeconds : takeSeconds)}
            </span>
            {status === 'running' ? (
              <span className="text-sm text-[var(--text-muted)]">
                {mode === 'audio' ? 'recording' : 'timing, no audio'}
              </span>
            ) : null}
          </div>

          {status === 'processing' ? (
            <p className="text-sm text-[var(--text-muted)]">
              Measuring the recording in your browser…
            </p>
          ) : status !== 'running' ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={startTimerOnly} variant="secondary" size="lg">
                <Timer className="h-4 w-4" aria-hidden="true" />
                Practise with the timer only
              </Button>
              {canRecord ? (
                <Button type="button" onClick={() => void startRecording()} size="lg">
                  <Mic className="h-4 w-4" aria-hidden="true" />
                  Record this take
                </Button>
              ) : null}
            </div>
          ) : (
            <Button type="button" onClick={stop} size="xl" variant="danger">
              <Square className="h-5 w-5" aria-hidden="true" />
              Stop
            </Button>
          )}

          {deviceError ? <Notice tone="warn">{deviceError}</Notice> : null}
        </div>
      </Card>

      {status === 'review' ? (
        <Card>
          <CardHeader
            title="3. Listen back and save"
            subtitle="Tap the filler counter while you listen. GymOS cannot hear fillers, so that number is yours."
          />
          <div className="px-5 pb-5 space-y-5">
            {audioUrl ? (
              <div className="space-y-2">
                {/* Playback of bytes that have not left this browser yet. Once saved,
                    a recording is only ever served from the authenticated handler. */}
                <audio src={audioUrl} controls className="w-full">
                  <track kind="captions" label="No captions: nothing is transcribed" />
                </audio>
                <p className="text-xs text-[var(--text-muted)]">
                  This is playing from your browser&rsquo;s memory. Nothing has been uploaded yet.
                </p>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No audio for this take, so there is nothing to play back. The duration above was
                measured by the timer.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Duration" value={formatSeconds(takeSeconds)} hint="Measured" />
              {/* The unmeasured hint says which of the two reasons applies. A take
                  whose audio failed to decode HAS a recording and no analysis, so
                  "no recording" would be false for it. */}
              <Stat
                label="Speaking ratio"
                value={measured ? `${Math.round(measured.speakingRatio * 100)}%` : '—'}
                hint={
                  measured
                    ? 'Measured here in your browser'
                    : audioBlob
                      ? 'Not measured: this recording could not be analysed'
                      : 'Not measured: no recording'
                }
              />
              <Stat
                label="Pauses"
                value={measured ? measured.pauses.length : '—'}
                hint={
                  measured
                    ? 'Silences of 0.4s or longer, found in your browser'
                    : audioBlob
                      ? 'Not measured: this recording could not be analysed'
                      : 'Not measured: no recording'
                }
              />
            </div>

            <div className="rounded-xl border border-[var(--border)] p-4 space-y-3">
              <p className="text-sm font-medium">Filler words you heard (self-reported)</p>
              <div className="flex items-center gap-3">
                <Button type="button" onClick={() => setFillerTaps((n) => (n ?? 0) + 1)} size="lg">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Tap for each filler
                </Button>
                <span className="text-2xl font-semibold tabular-nums">{fillerTaps ?? '—'}</span>
                {fillerTaps !== null ? (
                  <Button type="button" variant="quiet" onClick={() => setFillerTaps(null)}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Clear
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                GymOS has no speech recognition, so this count is whatever you tap and is stored as
                self-reported.{' '}
                {fillerTaps === null
                  ? 'You have not counted on this take, so nothing will be saved for it — a dash, not a zero.'
                  : 'Clear it to go back to not having counted.'}
              </p>
            </div>

            {canMeasurePace ? (
              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={readWholeScript}
                  onChange={(e) => setReadWholeScript(e.target.checked)}
                />
                <span>
                  I read the whole script ({script?.spokenWordCount} words). GymOS will divide that
                  known word count by the measured duration to get words per minute. It cannot check
                  this for you, so leave it unticked if you stopped early and the rate will be left
                  unmeasured.
                </span>
              </label>
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                Words per minute will be left unmeasured for this take: it needs a script of known
                length, and nothing is transcribed.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="How clear did it feel to you? (optional)"
                htmlFor="voice-clarity"
                hint="Your own rating, stored as self-reported."
              >
                <Select
                  id="voice-clarity"
                  value={clarity}
                  onChange={(e) => setClarity(e.target.value)}
                >
                  <option value="">No rating</option>
                  <option value="1">1 — hard to follow, to me</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="5">5 — felt clear to me</option>
                </Select>
              </Field>
              <Field label="Notes for next time (optional)" htmlFor="voice-reflection">
                <Textarea
                  id="voice-reflection"
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                  placeholder="What you want to do differently in the next take."
                />
              </Field>
            </div>

            {preview ? (
              <div className="rounded-xl border border-[var(--border)] p-4 space-y-2">
                <p className="text-sm font-medium">What the measurements suggest trying</p>
                <ul className="space-y-2 text-sm leading-relaxed text-[var(--text-muted)]">
                  {preview.suggestions.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={save} disabled={pending} size="lg">
                <Save className="h-4 w-4" aria-hidden="true" />
                {pending ? 'Saving…' : 'Save this take'}
              </Button>
              <Button type="button" variant="secondary" onClick={resetTake} disabled={pending}>
                Discard
              </Button>
            </div>

            {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
            {state.warning ? <Notice tone="warn">{state.warning}</Notice> : null}
            {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
          </div>
        </Card>
      ) : null}

      {status === 'idle' && (state.success || state.error) ? (
        <>
          {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
          {state.warning ? <Notice tone="warn">{state.warning}</Notice> : null}
          {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
        </>
      ) : null}
    </div>
  );
}
