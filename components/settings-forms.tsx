'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Input, Notice, Select } from '@/components/ui';
import {
  saveProfileAction,
  changePasswordAction,
  revokeOtherSessionsAction,
  setConsentAction,
  exportDataAction,
  deleteAccountAction,
  deleteBiometricsAction,
  devSetPlanAction,
  type ActionState,
} from '@/app/(app)/actions';
import { cn } from '@/lib/ui/cn';

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Notice tone="bad" className="mt-3">{state.error}</Notice>;
  if (state.success) return <Notice tone="ok" className="mt-3">{state.success}</Notice>;
  return null;
}

function Chip({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label
      className={cn(
        'cursor-pointer rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm transition-colors',
        'hover:border-[var(--border-strong)]',
        'has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)] has-[:checked]:text-[var(--accent)]',
      )}
    >
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="sr-only" />
      {label}
    </label>
  );
}

export function ProfileSettingsForm({
  profile,
  interestOptions,
  dayNames,
  limitationOptions,
}: {
  profile: {
    displayName: string;
    experience: string;
    interests: string[];
    trainingDays: number[];
    sessionMinutes: number;
    scheduleFlexibility: string;
    environment: string;
    limitations: string[];
    units: string;
    timezone: string;
    accessibility: { reduceMotion?: boolean; largeText?: boolean; highContrast?: boolean };
  };
  interestOptions: { id: string; label: string }[];
  dayNames: string[];
  limitationOptions: { id: string; label: string }[];
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await saveProfileAction({}, data));
        })
      }
      className="space-y-5"
    >
      <Field label="Display name" htmlFor="displayName" required>
        <Input id="displayName" name="displayName" defaultValue={profile.displayName} maxLength={60} required />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Experience" htmlFor="experience">
          <Select id="experience" name="experience" defaultValue={profile.experience}>
            <option value="new">New to exercise</option>
            <option value="some">Some experience</option>
            <option value="regular">Regularly active</option>
            <option value="experienced">Experienced</option>
          </Select>
        </Field>
        <Field label="Session length" htmlFor="sessionMinutes">
          <Select id="sessionMinutes" name="sessionMinutes" defaultValue={String(profile.sessionMinutes)}>
            {[20, 30, 40, 45, 60, 75, 90].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium mb-2">Training days</legend>
        <div className="flex flex-wrap gap-1.5">
          {dayNames.map((name, i) => (
            <Chip
              key={name}
              name="trainingDays"
              value={String(i)}
              label={name.slice(0, 3)}
              defaultChecked={profile.trainingDays.includes(i)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium mb-2">Training interests</legend>
        <div className="flex flex-wrap gap-1.5">
          {interestOptions.map((i) => (
            <Chip
              key={i.id}
              name="interests"
              value={i.id}
              label={i.label}
              defaultChecked={profile.interests.includes(i.id)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium mb-2">Anything feeling sensitive</legend>
        <p className="text-xs text-[var(--text-muted)] mb-2">
          GymOS stops suggesting movements that commonly load that area. It is not a diagnosis.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {limitationOptions.map((l) => (
            <Chip
              key={l.id}
              name="limitations"
              value={l.id}
              label={l.label}
              defaultChecked={profile.limitations.includes(l.id)}
            />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Schedule flexibility" htmlFor="scheduleFlexibility">
          <Select id="scheduleFlexibility" name="scheduleFlexibility" defaultValue={profile.scheduleFlexibility}>
            <option value="rigid">Fixed</option>
            <option value="some">Somewhat flexible</option>
            <option value="flexible">Very flexible</option>
          </Select>
        </Field>
        <Field label="Usual environment" htmlFor="environment">
          <Select id="environment" name="environment" defaultValue={profile.environment}>
            <option value="home">Home</option>
            <option value="commercial_gym">Commercial gym</option>
            <option value="apartment_gym">Apartment gym</option>
            <option value="outdoor">Outdoors</option>
            <option value="travel">Travel</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>
        <Field label="Units" htmlFor="units">
          <Select id="units" name="units" defaultValue={profile.units}>
            <option value="metric">Metric (kg)</option>
            <option value="imperial">Imperial (lb)</option>
          </Select>
        </Field>
      </div>

      <Field label="Time zone" htmlFor="timezone">
        <Select id="timezone" name="timezone" defaultValue={profile.timezone}>
          <option value="Asia/Kolkata">India (IST)</option>
          <option value="Asia/Dubai">Gulf (GST)</option>
          <option value="Europe/London">UK</option>
          <option value="America/New_York">US Eastern</option>
          <option value="UTC">UTC</option>
        </Select>
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium mb-1">Accessibility</legend>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="reduceMotion" defaultChecked={profile.accessibility?.reduceMotion} className="h-5 w-5 accent-[var(--accent)]" />
          Reduce motion and animation
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="largeText" defaultChecked={profile.accessibility?.largeText} className="h-5 w-5 accent-[var(--accent)]" />
          Slightly larger text
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="highContrast" defaultChecked={profile.accessibility?.highContrast} className="h-5 w-5 accent-[var(--accent)]" />
          Higher contrast
        </label>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save profile'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function PasswordForm() {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await changePasswordAction({}, data));
        })
      }
      className="space-y-4"
    >
      <Field label="Current password" htmlFor="currentPassword" required>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" htmlFor="newPassword" required hint="At least 10 characters.">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <Button type="submit" disabled={pending}>
        Change password
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RevokeSessionsButton() {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setState(await revokeOtherSessionsAction());
          })
        }
      >
        Sign out everywhere else
      </Button>
      <Feedback state={state} />
    </div>
  );
}

export function ConsentToggle({
  kind,
  title,
  body,
  granted,
  disabled,
  disabledReason,
}: {
  kind: string;
  title: string;
  body: string;
  granted: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [on, setOn] = useState(granted);
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-sm">{title}</p>
          <p className="text-sm text-[var(--text-muted)] mt-1 leading-relaxed">{body}</p>
          {disabled && disabledReason ? (
            <p className="text-xs text-warn-500 mt-1">{disabledReason}</p>
          ) : null}
        </div>
        <label className="shrink-0 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={on}
            disabled={disabled || pending}
            onChange={(e) => {
              const next = e.target.checked;
              setOn(next);
              startTransition(async () => {
                const result = await setConsentAction(kind as never, next);
                setState(result);
                if (result.error) setOn(!next);
              });
            }}
            className="h-5 w-5 accent-[var(--accent)]"
          />
          <span className="sr-only">Toggle {title}</span>
          {on ? 'On' : 'Off'}
        </label>
      </div>
      <Feedback state={state} />
    </div>
  );
}

export function ExportDataButton() {
  const [state, setState] = useState<{ error?: string; json?: string }>({});
  const [pending, startTransition] = useTransition();

  function download(json: string) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gymos-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await exportDataAction();
            setState(result);
            if (result.json) download(result.json);
          })
        }
      >
        {pending ? 'Preparing…' : 'Export everything as JSON'}
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.json ? (
        <Notice tone="ok">
          Export downloaded — {Math.round(state.json.length / 1024)} KB of JSON containing every
          record tied to your account.
        </Notice>
      ) : null}
    </div>
  );
}

export function DeleteBiometricsButton() {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setState(await deleteBiometricsAction());
          })
        }
      >
        Delete all biometric records
      </Button>
      <Feedback state={state} />
    </div>
  );
}

export function DeleteAccountForm() {
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Delete my account
      </Button>
    );
  }

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await deleteAccountAction({}, data));
        })
      }
      className="space-y-3"
    >
      <Notice tone="bad" title="This cannot be undone">
        Every record tied to your account is permanently removed: profile, equipment, plans,
        sessions, logged sets, meal plans, groceries and activity. Export your data first if you
        want to keep it.
      </Notice>
      <Field label="Type DELETE to confirm" htmlFor="confirm" required>
        <Input id="confirm" name="confirm" placeholder="DELETE" autoComplete="off" required />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? 'Deleting…' : 'Permanently delete my account'}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function DevPlanSwitcher({ current }: { current: 'free' | 'pro' }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await devSetPlanAction({}, data));
        })
      }
      className="flex flex-wrap items-end gap-3"
    >
      <Field label="Development plan" htmlFor="plan">
        <Select id="plan" name="plan" defaultValue={current}>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Switch
      </Button>
      <Feedback state={state} />
    </form>
  );
}
