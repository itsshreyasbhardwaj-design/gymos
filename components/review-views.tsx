'use client';

import { useActionState } from 'react';
import { Button, Card, CardHeader, Checkbox, Field, Notice, Select, Textarea } from '@/components/ui';
import {
  generateReviewAction,
  saveReviewPreferencesAction,
  saveReviewGoalsAction,
  deleteReviewAction,
  type ActionState,
} from '@/app/(app)/reviews/actions';
import { ALL_SECTION_KEYS } from '@/lib/engines/review';

const EMPTY: ActionState = {};

const SECTION_LABELS: Record<string, string> = {
  training: 'Training',
  nutrition: 'Food',
  grooming: 'Grooming and skincare',
  wardrobe: 'Wardrobe',
  voice: 'Speaking practice',
  hygiene: 'Routines',
  journal: 'Journal',
};

export function GenerateReviewForm({ cadence }: { cadence: string }) {
  const [state, action, pending] = useActionState(generateReviewAction, EMPTY);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="cadence" value={cadence} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Generating…' : 'Generate this review'}
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
    </form>
  );
}

export function ReviewPreferencesForm({
  cadence,
  includedSections,
}: {
  cadence: string;
  includedSections: string[];
}) {
  const [state, action, pending] = useActionState(saveReviewPreferencesAction, EMPTY);
  // An empty stored list means "everything", so that is how the boxes start.
  const checked = (key: string) => includedSections.length === 0 || includedSections.includes(key);

  return (
    <form action={action} className="space-y-4">
      <Field label="How often" hint="This only changes the window a review covers. Nothing is sent to you.">
        <Select name="cadence" defaultValue={cadence}>
          <option value="weekly">Weekly</option>
          <option value="fortnightly">Fortnightly</option>
          <option value="monthly">Monthly</option>
          <option value="manual">Only when I ask</option>
        </Select>
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What to include</legend>
        {ALL_SECTION_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <Checkbox name={`section:${key}`} defaultChecked={checked(key)} />
            {SECTION_LABELS[key] ?? key}
          </label>
        ))}
      </fieldset>

      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Save review settings'}
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
    </form>
  );
}

export function ReviewGoalsForm({ id, goals }: { id: string; goals: string[] }) {
  const [state, action, pending] = useActionState(saveReviewGoalsAction, EMPTY);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field
        label="Your own notes for this period"
        hint="Yours to write, in your words. GymOS does not grade them."
      >
        <Textarea name="goals" rows={4} defaultValue={goals.join('\n')} placeholder="One per line" />
      </Field>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save notes'}
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
    </form>
  );
}

export function DeleteReviewForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteReviewAction, EMPTY);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="quiet" size="sm" disabled={pending}>
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
    </form>
  );
}

export function ReviewSettingsCard({
  cadence,
  includedSections,
}: {
  cadence: string;
  includedSections: string[];
}) {
  return (
    <Card>
      <CardHeader title="Review settings" subtitle="What a review covers, and how far back it looks." />
      <div className="px-5 pb-5">
        <ReviewPreferencesForm cadence={cadence} includedSections={includedSections} />
      </div>
    </Card>
  );
}
