'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import {
  createGymProfileAction,
  activateProfileAction,
  saveProfileEquipmentAction,
  renameProfileAction,
  deleteProfileAction,
  createCustomEquipmentAction,
  type ActionState,
} from '@/app/(app)/actions';
import { EquipmentPicker, type EquipmentOption, type PresetOption } from '@/components/equipment-picker';

function useAction(fn: (prev: ActionState, data: FormData) => Promise<ActionState>) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const run = (data: FormData) =>
    startTransition(async () => {
      setState(await fn({}, data));
    });
  return { state, pending, run };
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Notice tone="bad" className="mt-3">{state.error}</Notice>;
  if (state.success) return <Notice tone="ok" className="mt-3">{state.success}</Notice>;
  return null;
}

export function NewProfileForm({ presets }: { presets: { key: string; label: string; items: number }[] }) {
  const { state, pending, run } = useAction(createGymProfileAction);
  return (
    <form action={run} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" required>
          <Input id="name" name="name" placeholder="Travel kit" required maxLength={80} />
        </Field>
        <Field label="Environment" htmlFor="environment">
          <Select id="environment" name="environment" defaultValue="home">
            <option value="home">Home</option>
            <option value="commercial_gym">Commercial gym</option>
            <option value="apartment_gym">Apartment gym</option>
            <option value="outdoor">Outdoors</option>
            <option value="travel">Travel</option>
            <option value="custom">Custom</option>
          </Select>
        </Field>
      </div>
      <Field label="Start from" htmlFor="presetKey" hint="You can change every item afterwards.">
        <Select id="presetKey" name="presetKey" defaultValue="bodyweight_home">
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label} ({p.items} items)
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} maxLength={500} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create profile'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ActivateProfileButton({ profileId }: { profileId: string }) {
  const { pending, run } = useAction(activateProfileAction);
  return (
    <form action={run}>
      <input type="hidden" name="profileId" value={profileId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? '…' : 'Train here'}
      </Button>
    </form>
  );
}

export function ProfileEquipmentForm({
  profileId,
  options,
  presets,
  initialSelected,
}: {
  profileId: string;
  options: EquipmentOption[];
  presets: PresetOption[];
  initialSelected: string[];
}) {
  const { state, pending, run } = useAction(saveProfileEquipmentAction);
  return (
    <form action={run} className="space-y-4">
      <input type="hidden" name="profileId" value={profileId} />
      <EquipmentPicker options={options} presets={presets} initialSelected={initialSelected} />
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save equipment'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RenameProfileForm({
  profileId,
  name,
  notes,
}: {
  profileId: string;
  name: string;
  notes: string;
}) {
  const { state, pending, run } = useAction(renameProfileAction);
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="profileId" value={profileId} />
      <Field label="Name" htmlFor={`name-${profileId}`}>
        <Input id={`name-${profileId}`} name="name" defaultValue={name} maxLength={80} />
      </Field>
      <Field label="Notes" htmlFor={`notes-${profileId}`}>
        <Textarea id={`notes-${profileId}`} name="notes" defaultValue={notes} rows={2} maxLength={500} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Save
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function DeleteProfileForm({ profileId }: { profileId: string }) {
  const { state, pending, run } = useAction(deleteProfileAction);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Delete this profile
      </Button>
    );
  }
  return (
    <form action={run} className="flex items-center gap-2 flex-wrap">
      <input type="hidden" name="profileId" value={profileId} />
      <p className="text-sm">Delete this profile? Plans already generated are not affected.</p>
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        Yes, delete
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function CustomEquipmentForm() {
  const { state, pending, run } = useAction(createCustomEquipmentAction);
  return (
    <form action={run} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="custom-name" required>
          <Input id="custom-name" name="name" required maxLength={80} placeholder="Sandbag" />
        </Field>
        <Field label="Category" htmlFor="custom-category">
          <Select id="custom-category" name="category" defaultValue="mobility_other">
            <option value="bodyweight_basic">Bodyweight &amp; basics</option>
            <option value="free_weights">Free weights</option>
            <option value="resistance">Resistance</option>
            <option value="racks_benches">Racks &amp; benches</option>
            <option value="upper_machines">Upper-body machines</option>
            <option value="lower_machines">Lower-body machines</option>
            <option value="cardio">Cardio</option>
            <option value="mobility_other">Mobility &amp; other</option>
          </Select>
        </Field>
      </div>
      <Field
        label="Description"
        htmlFor="custom-description"
        hint="Custom items do not yet appear in exercise requirements — they are recorded for your own reference."
      >
        <Input id="custom-description" name="description" maxLength={300} />
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        Add custom equipment
      </Button>
      <Feedback state={state} />
    </form>
  );
}
