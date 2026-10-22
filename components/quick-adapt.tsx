'use client';

import { useState, useTransition } from 'react';
import { Clock, MapPin, CircleHelp, RotateCcw, Check, X } from 'lucide-react';
import { Badge, Button, Card, Notice, Select } from '@/components/ui';
import { proposeAdaptationAction, applyAdaptationAction } from '@/app/(app)/actions';
import { cn } from '@/lib/ui/cn';

interface ProposalChange {
  kind: string;
  exerciseName?: string;
  toExerciseName?: string;
  from?: string;
  to?: string;
  reason: string;
  equipmentSatisfied: boolean;
  equipmentUsed?: string;
  alternatives?: { id: string; name: string; reason: string }[];
}

interface Proposal {
  trigger: string;
  summary: string;
  changes: ProposalChange[];
  inputsConsidered: string[];
  explanation: string[];
  warnings: string[];
  estimatedMinutes: number;
  noChangeNeeded: boolean;
  moves?: { sessionId: string; from: string; to: string | null; label: string }[];
}

const CHANGE_TONE: Record<string, 'neutral' | 'brand' | 'warn' | 'bad' | 'ok'> = {
  keep: 'neutral',
  substitute: 'brand',
  remove: 'warn',
  reduce: 'warn',
  reschedule: 'brand',
  blocked: 'bad',
};

/**
 * RealitySync entry point. Nothing is applied until the user reads the proposal and
 * accepts it — that is the whole point of making adaptation explainable.
 */
export function QuickAdapt({
  sessionId,
  plan,
  gyms,
  missed = false,
}: {
  sessionId: string;
  plan: 'free' | 'pro';
  gyms: { id: string; name: string }[];
  missed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(20);
  const [gymProfileId, setGymProfileId] = useState(gyms[0]?.id ?? '');
  const [pending, startTransition] = useTransition();

  function request(input: Parameters<typeof proposeAdaptationAction>[0]) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await proposeAdaptationAction(input);
      if ('error' in result && result.error) {
        setError(result.error);
        setProposal(null);
        return;
      }
      setProposal(result.proposal as unknown as Proposal);
    });
  }

  function apply() {
    if (!proposal) return;
    startTransition(async () => {
      const result = await applyAdaptationAction({ proposal, sessionId });
      if (result.error) setError(result.error);
      else {
        setNotice(result.success ?? 'Applied.');
        setProposal(null);
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)} size={missed ? 'sm' : 'md'}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {missed ? 'Handle it' : "Today's different"}
        </Button>
        {notice ? (
          <span className="text-xs text-ok-500 ml-2" role="status">
            {notice}
          </span>
        ) : null}
      </>
    );
  }

  return (
    <Card className="w-full p-4 mt-2">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-semibold text-sm">RealitySync</p>
          <p className="text-xs text-[var(--text-muted)]">
            Nothing changes until you accept it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setProposal(null);
            setError(null);
          }}
          className="h-8 w-8 grid place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Close</span>
        </button>
      </div>

      {plan === 'free' ? (
        <Notice tone="warn" className="mb-3">
          RealitySync is part of GymOS Pro. You can still edit the session by hand from the plan or
          the workout screen.
        </Notice>
      ) : null}

      {error ? (
        <Notice tone="bad" className="mb-3">
          {error}
        </Notice>
      ) : null}

      {!proposal ? (
        <div className="space-y-3">
          {missed ? (
            <Button
              variant="secondary"
              className="w-full justify-start"
              disabled={pending}
              onClick={() => request({ kind: 'missed', sessionId })}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              I missed this one — what now?
            </Button>
          ) : (
            <>
              <div className="flex gap-2">
                <Select
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  aria-label="Minutes available"
                  className="w-32"
                >
                  {[15, 20, 25, 30, 40].map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  className="flex-1 justify-start"
                  disabled={pending}
                  onClick={() => request({ kind: 'time', sessionId, minutes })}
                >
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  I have less time today
                </Button>
              </div>

              {gyms.length > 0 ? (
                <div className="flex gap-2">
                  <Select
                    value={gymProfileId}
                    onChange={(e) => setGymProfileId(e.target.value)}
                    aria-label="Equipment profile"
                    className="w-40"
                  >
                    {gyms.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    className="flex-1 justify-start"
                    disabled={pending || !gymProfileId}
                    onClick={() => request({ kind: 'equipment', sessionId, gymProfileId })}
                  >
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    I&apos;m somewhere else
                  </Button>
                </div>
              ) : null}

              <Button
                variant="secondary"
                className="w-full justify-start"
                disabled={pending}
                onClick={() => request({ kind: 'difficulty', sessionId })}
              >
                <CircleHelp className="h-4 w-4" aria-hidden="true" />
                Last one was too hard
              </Button>
            </>
          )}
          {pending ? <p className="text-xs text-[var(--text-muted)]">Working it out…</p> : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="font-medium text-sm">{proposal.summary}</p>
            {proposal.estimatedMinutes > 0 ? (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                About {proposal.estimatedMinutes} minutes.
              </p>
            ) : null}
          </div>

          {proposal.changes.length > 0 ? (
            <ul className="space-y-1.5">
              {proposal.changes.map((change, i) => (
                <li key={i} className="rounded-lg border border-[var(--border)] p-2.5">
                  <div className="flex items-start gap-2">
                    <Badge tone={CHANGE_TONE[change.kind] ?? 'neutral'} className="shrink-0 mt-0.5">
                      {change.kind}
                    </Badge>
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">
                        {change.toExerciseName
                          ? `${change.exerciseName} → ${change.toExerciseName}`
                          : (change.exerciseName ??
                            (change.from && change.to
                              ? `${change.from} → ${change.to}`
                              : (change.from ?? '')))}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
                        {change.reason}
                      </p>
                      {change.equipmentUsed ? (
                        <p
                          className={cn(
                            'text-xs mt-1',
                            change.equipmentSatisfied ? 'text-ok-500' : 'text-bad-500',
                          )}
                        >
                          {change.equipmentSatisfied ? '✓ Equipment available' : '✗ Equipment missing'}
                          : {change.equipmentUsed}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {proposal.warnings.length > 0 ? (
            <Notice tone="warn">
              <ul className="space-y-1">
                {proposal.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <details>
            <summary className="text-xs cursor-pointer text-[var(--text-muted)]">
              What GymOS considered
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
              {proposal.inputsConsidered.map((line, i) => (
                <li key={i}>• {line}</li>
              ))}
              {proposal.explanation.map((line, i) => (
                <li key={`e${i}`}>• {line}</li>
              ))}
            </ul>
          </details>

          <div className="flex flex-wrap gap-2">
            <Button onClick={apply} disabled={pending || proposal.noChangeNeeded}>
              <Check className="h-4 w-4" aria-hidden="true" />
              {proposal.noChangeNeeded ? 'Nothing to apply' : 'Apply this change'}
            </Button>
            <Button variant="ghost" onClick={() => setProposal(null)} disabled={pending}>
              Try something else
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
