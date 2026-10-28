'use client';

import { useState, useTransition } from 'react';
import { Check, ChevronDown, ChevronUp, Plus, Trash2, Undo2 } from 'lucide-react';
import { Badge, Button, Checkbox, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import {
  addRoutineStepAction,
  completeAppointmentAction,
  createAppointmentAction,
  createRoutineAction,
  deleteAppointmentAction,
  deleteRoutineAction,
  deleteRoutineStepAction,
  logRoutineAction,
  markRoutineDoneAction,
  moveRoutineStepAction,
  setRoutineActiveAction,
  unlogRoutineAction,
  updateRoutineAction,
  type ActionState,
} from '@/app/(app)/grooming/actions';

const DAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const SLOTS = [
  { value: 'morning', label: 'Morning' },
  { value: 'evening', label: 'Evening' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Only on chosen days' },
];

export interface ProductOption {
  id: string;
  name: string;
}

function Result({ state }: { state: ActionState }) {
  if (state.error) return <Notice tone="bad">{state.error}</Notice>;
  if (state.success) return <Notice tone="ok">{state.success}</Notice>;
  return null;
}

function DayPicker({ selected }: { selected?: number[] }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="block text-sm font-medium">Days</legend>
      <div className="flex flex-wrap gap-2">
        {DAYS.map((day) => (
          <label
            key={day.value}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-sm"
          >
            <Checkbox
              name="daysOfWeek"
              value={String(day.value)}
              defaultChecked={selected?.includes(day.value) ?? false}
            />
            {day.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Leave every day unticked for a morning or evening routine you want every day.
      </p>
    </fieldset>
  );
}

/* ----------------------------------------------------------- create routine */

export function RoutineCreateForm({ products }: { products: ProductOption[] }) {
  const [state, setState] = useState<ActionState>({});
  const [stepCount, setStepCount] = useState(3);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await createRoutineAction({}, data));
        })
      }
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Routine name" htmlFor="routine-name" required>
          <Input id="routine-name" name="name" required maxLength={80} placeholder="Morning face" />
        </Field>
        <Field label="When" htmlFor="routine-slot">
          <Select id="routine-slot" name="slot" defaultValue="morning">
            {SLOTS.map((slot) => (
              <option key={slot.value} value={slot.value}>
                {slot.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <DayPicker />

      <div className="space-y-2">
        <p className="text-sm font-medium">Steps, in order</p>
        {Array.from({ length: stepCount }, (_, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr]">
            <Input
              name="stepLabel"
              maxLength={120}
              placeholder={index === 0 ? 'Cleanse' : `Step ${index + 1} (optional)`}
              aria-label={`Step ${index + 1} label`}
            />
            <Select name="stepProductId" defaultValue="" aria-label={`Step ${index + 1} product`}>
              <option value="">No product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
            <input type="hidden" name="stepNotes" value="" />
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setStepCount((count) => Math.min(30, count + 1))}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Another step
        </Button>
      </div>

      <Field label="Notes" htmlFor="routine-notes" hint="Anything you want to remember. Optional.">
        <Textarea id="routine-notes" name="notes" rows={2} maxLength={500} />
      </Field>

      <Button type="submit" disabled={pending}>
        Save routine
      </Button>
      <Result state={state} />
    </form>
  );
}

/* ------------------------------------------------------------- edit routine */

export interface RoutineEditView {
  id: string;
  name: string;
  slot: string;
  daysOfWeek: number[];
  active: boolean;
  notes: string;
  steps: { id: string; label: string; productName: string | null }[];
}

export function RoutineEditor({
  routine,
  products,
}: {
  routine: RoutineEditView;
  products: ProductOption[];
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <form
        action={(data) =>
          startTransition(async () => {
            setState(await updateRoutineAction({}, data));
          })
        }
        className="space-y-3"
      >
        <input type="hidden" name="routineId" value={routine.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor={`name-${routine.id}`} required>
            <Input
              id={`name-${routine.id}`}
              name="name"
              defaultValue={routine.name}
              required
              maxLength={80}
            />
          </Field>
          <Field label="When" htmlFor={`slot-${routine.id}`}>
            <Select id={`slot-${routine.id}`} name="slot" defaultValue={routine.slot}>
              {SLOTS.map((slot) => (
                <option key={slot.value} value={slot.value}>
                  {slot.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <DayPicker selected={routine.daysOfWeek} />
        <Field label="Notes" htmlFor={`notes-${routine.id}`}>
          <Textarea
            id={`notes-${routine.id}`}
            name="notes"
            rows={2}
            maxLength={500}
            defaultValue={routine.notes}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox name="active" defaultChecked={routine.active} />
          Keep this routine switched on
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            Save changes
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setState(await setRoutineActiveAction(routine.id, !routine.active));
              })
            }
          >
            {routine.active ? 'Pause' : 'Switch on'}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setState(await deleteRoutineAction(routine.id));
              })
            }
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete routine
          </Button>
        </div>
      </form>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">Steps</p>
        {routine.steps.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No steps yet.</p>
        ) : (
          <ol className="space-y-1">
            {routine.steps.map((step, index) => (
              <li
                key={step.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="tabular-nums text-[var(--text-muted)] mr-2">{index + 1}.</span>
                  {step.label}
                  {step.productName ? (
                    <span className="block text-xs text-[var(--text-muted)]">
                      {step.productName}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={pending || index === 0}
                    onClick={() =>
                      startTransition(async () => {
                        setState(await moveRoutineStepAction(step.id, 'up'));
                      })
                    }
                    className="h-8 w-8 grid place-items-center rounded-lg hover:bg-[var(--surface-sunken)] disabled:opacity-40"
                  >
                    <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Move {step.label} earlier</span>
                  </button>
                  <button
                    type="button"
                    disabled={pending || index === routine.steps.length - 1}
                    onClick={() =>
                      startTransition(async () => {
                        setState(await moveRoutineStepAction(step.id, 'down'));
                      })
                    }
                    className="h-8 w-8 grid place-items-center rounded-lg hover:bg-[var(--surface-sunken)] disabled:opacity-40"
                  >
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Move {step.label} later</span>
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setState(await deleteRoutineStepAction(step.id));
                      })
                    }
                    className="h-8 w-8 grid place-items-center rounded-lg text-bad-500 hover:bg-bad-100/40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Remove step {step.label}</span>
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {routine.steps.length > 1 ? (
          <p className="text-xs text-[var(--text-muted)]">
            The arrows change the order you do them in. Nothing else about the step changes.
          </p>
        ) : null}
      </div>

      <form
        action={(data) =>
          startTransition(async () => {
            setState(await addRoutineStepAction({}, data));
          })
        }
        className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]"
      >
        <input type="hidden" name="routineId" value={routine.id} />
        <Input name="label" maxLength={120} placeholder="Add a step" aria-label="New step label" />
        <Select name="productId" defaultValue="" aria-label="New step product">
          <option value="">No product</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" disabled={pending}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add
        </Button>
      </form>

      <Result state={state} />
    </div>
  );
}

/* --------------------------------------------------------------- log button */

export function RoutineLogButton({
  routineId,
  date,
  doneToday,
  steps,
  completedStepIds,
}: {
  routineId: string;
  date: string;
  doneToday: boolean;
  steps: { id: string; label: string }[];
  completedStepIds: string[];
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const [showSteps, setShowSteps] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {doneToday ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setState(await unlogRoutineAction(routineId, date));
              })
            }
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Undo today&apos;s log
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setState(await markRoutineDoneAction(routineId, date));
              })
            }
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            Did it today
          </Button>
        )}

        {steps.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showSteps}
            onClick={() => setShowSteps((v) => !v)}
          >
            {showSteps ? (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            )}
            {showSteps ? 'Hide steps' : 'Tick individual steps'}
          </Button>
        ) : null}
      </div>

      {/*
        One tap covers the common case; this is for the day you did some of it. Ticking
        nothing and saving is a valid thing to record — it logs the routine without
        claiming which steps happened — so the submit never requires a selection.
      */}
      {showSteps && steps.length > 0 ? (
        <StepChecklist
          routineId={routineId}
          date={date}
          steps={steps}
          completedStepIds={completedStepIds}
        />
      ) : null}

      <Result state={state} />
    </div>
  );
}

function StepChecklist({
  routineId,
  date,
  steps,
  completedStepIds,
}: {
  routineId: string;
  date: string;
  steps: { id: string; label: string }[];
  completedStepIds: string[];
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="rounded-lg border border-[var(--border)] px-3 py-2.5 space-y-2.5"
      action={(formData) =>
        startTransition(async () => {
          setState(await logRoutineAction({}, formData));
        })
      }
    >
      <input type="hidden" name="routineId" value={routineId} />
      <input type="hidden" name="date" value={date} />

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-[var(--text-muted)]">
          Which steps did you do? Leave them all unticked to log the routine without saying.
        </legend>
        {steps.map((step) => (
          <label key={step.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              name="completedStepIds"
              value={step.id}
              defaultChecked={completedStepIds.includes(step.id)}
            />
            {step.label}
          </label>
        ))}
      </fieldset>

      <Field label="Note" hint="Only you ever see this. Optional.">
        <Input name="note" placeholder="Skipped the serum, ran out" />
      </Field>

      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save what I did'}
      </Button>

      <Result state={state} />
    </form>
  );
}

/* ------------------------------------------------------------ appointments */

export function AppointmentForm() {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await createAppointmentAction({}, data));
        })
      }
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What is it" htmlFor="appt-title" required>
          <Input id="appt-title" name="title" required maxLength={80} placeholder="Haircut" />
        </Field>
        <Field label="Kind" htmlFor="appt-kind">
          <Select id="appt-kind" name="kind" defaultValue="other">
            <option value="haircut">Haircut</option>
            <option value="beard">Beard or shave</option>
            <option value="salon">Salon</option>
            <option value="dermatologist">Dermatologist or doctor</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="When" htmlFor="appt-when" required>
          <Input id="appt-when" name="scheduledAt" type="datetime-local" required />
        </Field>
        <Field label="Where" htmlFor="appt-where" hint="Optional.">
          <Input id="appt-where" name="location" maxLength={200} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="appt-notes" hint="Optional.">
        <Textarea id="appt-notes" name="notes" rows={2} maxLength={500} />
      </Field>
      <Button type="submit" disabled={pending}>
        Save appointment
      </Button>
      <Result state={state} />
    </form>
  );
}

export function AppointmentRow({
  appointment,
}: {
  appointment: {
    id: string;
    title: string;
    kind: string;
    scheduledAt: string;
    location: string;
    completed: boolean;
  };
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <li className="rounded-xl border border-[var(--border)] px-3.5 py-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{appointment.title}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {new Date(appointment.scheduledAt).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            {appointment.location ? ` · ${appointment.location}` : ''}
          </p>
        </div>
        <Badge tone={appointment.completed ? 'ok' : 'neutral'}>
          {appointment.completed ? 'Done' : appointment.kind}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setState(await completeAppointmentAction(appointment.id, !appointment.completed));
            })
          }
        >
          {appointment.completed ? 'Move back to upcoming' : 'Mark as done'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setState(await deleteAppointmentAction(appointment.id));
            })
          }
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Delete
        </Button>
      </div>
      <Result state={state} />
    </li>
  );
}
