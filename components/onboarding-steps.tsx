'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Card, Checkbox, Field, Input, Notice, Select, Textarea, Badge } from '@/components/ui';
import { EquipmentPicker, type EquipmentOption, type PresetOption } from '@/components/equipment-picker';
import type { StepState } from '@/app/onboarding/actions';
import { cn } from '@/lib/ui/cn';

function Submit({ label = 'Continue' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Saving…' : label}
    </Button>
  );
}

export function StepForm({
  step,
  action,
  children,
  submitLabel,
}: {
  step: number;
  action: (prev: StepState, formData: FormData) => Promise<StepState>;
  children: React.ReactNode;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState<StepState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="step" value={step} />
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {children}
      <div className="flex justify-end pt-2">
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}

/** A checkbox or radio rendered as a large, obvious card. */
export function OptionCard({
  type,
  name,
  value,
  title,
  description,
  defaultChecked,
}: {
  type: 'checkbox' | 'radio';
  name: string;
  value: string;
  title: string;
  description?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-xl border border-[var(--border)] p-4 cursor-pointer',
        'hover:border-[var(--border-strong)] transition-colors',
        'has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-5 w-5 accent-[var(--accent)]"
      />
      <span className="min-w-0">
        <span className="block font-medium text-sm">{title}</span>
        {description ? (
          <span className="block text-sm text-[var(--text-muted)] mt-1 leading-relaxed">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function EquipmentStep({
  options,
  presets,
  initialSelected,
}: {
  options: EquipmentOption[];
  presets: PresetOption[];
  initialSelected: string[];
}) {
  return (
    <Card className="p-5">
      <Field label="Name this setup" htmlFor="profileName" hint="For example: Home, Main Gym, Hotel.">
        <Input id="profileName" name="profileName" defaultValue="My setup" maxLength={80} />
      </Field>
      <div className="mt-5">
        <EquipmentPicker options={options} presets={presets} initialSelected={initialSelected} />
      </div>
      <input type="hidden" name="presetKey" value="bodyweight_home" />
      <Notice tone="neutral" className="mt-4">
        Selecting nothing is fine — GymOS will plan bodyweight sessions and tell you which movement
        patterns it cannot cover. You can add more equipment or create extra profiles at any time.
      </Notice>
    </Card>
  );
}

export { Card, Field, Input, Select, Textarea, Checkbox, Badge, Notice };
