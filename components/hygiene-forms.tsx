'use client';

import { useState, useTransition } from 'react';
import { Check, Clock, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import {
  addTaskAction,
  checkInRoutineAction,
  checkInTaskAction,
  createRoutineAction,
  createSupplyAction,
  deleteRoutineAction,
  deleteSupplyAction,
  deleteTaskAction,
  markSupplyReplacedAction,
  setRoutineActiveAction,
  setSupplyRunningLowAction,
  snoozeRoutineAction,
  uncheckTaskAction,
  updateRoutineAction,
  updateSupplyAction,
  type ActionState,
} from '@/app/(app)/hygiene/actions';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DueRoutineProps {
  routineId: string;
  routineName: string;
  category: string;
  due: boolean;
  /** The engine's neutral statement of where this routine sits in its schedule. */
  detail: string;
  tasks: { id: string; label: string; orderIndex: number; doneToday: boolean }[];
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Notice tone="bad">{state.error}</Notice>;
  if (state.success) return <Notice tone="ok">{state.success}</Notice>;
  return null;
}

/* ------------------------------------------------------------ today's list */

/**
 * The tick list. Ticking is idempotent on the server, so a double click is
 * harmless. Nothing here scores the day or comments on what was not ticked.
 */
export function TodayChecklist({ routines, today }: { routines: DueRoutineProps[]; today: string }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  if (routines.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        Nothing is scheduled for today. Routines appear here on the days you set.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Feedback state={state} />
      {routines.map((routine) => (
        <div key={routine.routineId} className="rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="font-medium text-sm">{routine.routineName}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">{routine.detail}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={routine.due ? 'warn' : 'neutral'}>{routine.category}</Badge>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending || routine.tasks.every((t) => t.doneToday)}
                onClick={() =>
                  startTransition(async () => {
                    setState(await checkInRoutineAction(routine.routineId, today));
                  })
                }
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Tick all
              </Button>
            </div>
          </div>

          <ul className="mt-3 space-y-1">
            {routine.tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--surface-sunken)]"
              >
                <Checkbox
                  id={`task-${task.id}`}
                  checked={task.doneToday}
                  disabled={pending}
                  onChange={(e) => {
                    const next = e.target.checked;
                    startTransition(async () => {
                      setState(
                        next
                          ? await checkInTaskAction(task.id, today)
                          : await uncheckTaskAction(task.id, today),
                      );
                    });
                  }}
                />
                <label
                  htmlFor={`task-${task.id}`}
                  className={
                    task.doneToday
                      ? 'text-sm text-[var(--text-muted)] line-through'
                      : 'text-sm cursor-pointer'
                  }
                >
                  {task.label}
                </label>
              </li>
            ))}
            {routine.tasks.length === 0 ? (
              <li className="text-xs text-[var(--text-muted)] px-2">
                No tasks in this routine yet.
              </li>
            ) : null}
          </ul>

          {routine.tasks.length > 0 && routine.tasks.every((t) => t.doneToday) ? (
            <p className="mt-2 px-2 text-xs text-[var(--text-muted)]">
              Nothing left to tick here today. It stays on the list until tomorrow so you can
              un-tick anything you ticked by mistake.
            </p>
          ) : null}

          <form
            action={(data) =>
              startTransition(async () => {
                setState(await snoozeRoutineAction({}, data));
              })
            }
            className="mt-3 flex items-end gap-2 flex-wrap"
          >
            <input type="hidden" name="routineId" value={routine.routineId} />
            <div className="w-44">
              <Field label="Set aside until" htmlFor={`snooze-${routine.routineId}`}>
                <Input
                  id={`snooze-${routine.routineId}`}
                  name="until"
                  type="date"
                  min={today}
                  required
                />
              </Field>
            </div>
            <Button type="submit" variant="ghost" size="sm" disabled={pending}>
              <Clock className="h-4 w-4" aria-hidden="true" />
              Set aside
            </Button>
          </form>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ routine form */

/** Create a routine with its first few tasks. Cadence fields follow the schema. */
export function RoutineComposer({ canCreate, reason }: { canCreate: boolean; reason?: string }) {
  const [state, setState] = useState<ActionState>({});
  const [cadence, setCadence] = useState('daily');
  const [taskRows, setTaskRows] = useState(['', '', '']);
  const [pending, startTransition] = useTransition();

  if (!canCreate) {
    return (
      <Notice tone="warn" title="You have used your routine allowance">
        {reason ?? 'Pause or delete a routine to add another one.'}
      </Notice>
    );
  }

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          const result = await createRoutineAction({}, data);
          setState(result);
          if (result.success) setTaskRows(['', '', '']);
        })
      }
      className="space-y-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Routine name" htmlFor="routine-name" required>
          <Input
            id="routine-name"
            name="name"
            maxLength={80}
            required
            placeholder="Morning routine"
          />
        </Field>
        <Field label="Category" htmlFor="routine-category" hint="Your own label. Optional.">
          <Input id="routine-category" name="category" maxLength={40} placeholder="general" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How often" htmlFor="routine-cadence">
          <Select
            id="routine-cadence"
            name="cadence"
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Weekly, on chosen days</option>
            <option value="custom">Custom interval</option>
          </Select>
        </Field>
        {cadence === 'custom' ? (
          <Field
            label="Every how many days"
            htmlFor="routine-interval"
            hint="Counted from the last time you ticked everything in the routine."
          >
            <Input
              id="routine-interval"
              name="everyNDays"
              type="number"
              min="1"
              max="365"
              placeholder="3"
            />
          </Field>
        ) : null}
      </div>

      {cadence === 'weekly' || cadence === 'custom' ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Days of the week
            {cadence === 'custom' ? ' (optional if you set an interval)' : ''}
          </legend>
          <div className="flex flex-wrap gap-3">
            {DAY_LABELS.map((label, index) => (
              <label key={label} className="flex items-center gap-2 text-sm">
                <Checkbox name="daysOfWeek" value={index} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tasks</legend>
        <p className="text-xs text-[var(--text-muted)]">
          Whatever you want to tick off, in your own words. You can add more later.
        </p>
        {taskRows.map((value, index) => (
          <Input
            key={index}
            name="taskLabel"
            maxLength={120}
            value={value}
            onChange={(e) =>
              setTaskRows((prev) => prev.map((row, i) => (i === index ? e.target.value : row)))
            }
            placeholder={index === 0 ? 'Brush teeth' : 'Another task'}
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setTaskRows((prev) => [...prev, ''])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Another task
        </Button>
      </fieldset>

      <Field label="Notes" htmlFor="routine-notes" hint="Only you ever see these.">
        <Textarea id="routine-notes" name="notes" maxLength={500} rows={2} />
      </Field>

      <Button type="submit" disabled={pending}>
        Save routine
      </Button>
      <Feedback state={state} />
    </form>
  );
}

/* -------------------------------------------------------- routine management */

export interface ManagedRoutine {
  id: string;
  name: string;
  category: string;
  cadenceLabel: string;
  cadence: string;
  daysOfWeek: number[];
  everyNDays: number | null;
  notes: string;
  active: boolean;
  tasks: { id: string; label: string }[];
}

/**
 * Edit one routine's name and cadence in place.
 *
 * Every field the form shows is submitted, including the day picker's hidden
 * `daysOfWeekSent` marker, so what the user sees is exactly what is saved. Fields the
 * form does not show — `active`, the reminder time — are not sent, and the action
 * leaves them as they are rather than clearing them.
 */
function RoutineEditForm({
  routine,
  pending,
  onResult,
  onClose,
}: {
  routine: ManagedRoutine;
  pending: boolean;
  onResult: (state: ActionState) => void;
  onClose: () => void;
}) {
  const [cadence, setCadence] = useState(routine.cadence);
  const [saving, startTransition] = useTransition();
  const busy = pending || saving;

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          const result = await updateRoutineAction({}, data);
          onResult(result);
          if (result.success) onClose();
        })
      }
      className="mt-3 space-y-3 rounded-xl border border-[var(--border)] p-3.5"
    >
      <input type="hidden" name="routineId" value={routine.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Routine name" htmlFor={`edit-name-${routine.id}`} required>
          <Input
            id={`edit-name-${routine.id}`}
            name="name"
            maxLength={80}
            required
            defaultValue={routine.name}
          />
        </Field>
        <Field label="Category" htmlFor={`edit-category-${routine.id}`}>
          <Input
            id={`edit-category-${routine.id}`}
            name="category"
            maxLength={40}
            defaultValue={routine.category}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="How often" htmlFor={`edit-cadence-${routine.id}`}>
          <Select
            id={`edit-cadence-${routine.id}`}
            name="cadence"
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
          >
            <option value="daily">Every day</option>
            <option value="weekly">Weekly, on chosen days</option>
            <option value="custom">Custom interval</option>
          </Select>
        </Field>
        {cadence === 'custom' ? (
          <Field
            label="Every how many days"
            htmlFor={`edit-interval-${routine.id}`}
            hint="Counted from the last time you ticked everything in the routine."
          >
            <Input
              id={`edit-interval-${routine.id}`}
              name="everyNDays"
              type="number"
              min="1"
              max="365"
              defaultValue={routine.everyNDays ?? ''}
            />
          </Field>
        ) : null}
      </div>

      {cadence === 'weekly' || cadence === 'custom' ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            Days of the week
            {cadence === 'custom' ? ' (optional if you set an interval)' : ''}
          </legend>
          {/* Tells the action the picker was on screen, so clearing every box clears
              the days instead of reading as "field not sent". */}
          <input type="hidden" name="daysOfWeekSent" value="1" />
          <div className="flex flex-wrap gap-3">
            {DAY_LABELS.map((label, index) => (
              <label key={label} className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="daysOfWeek"
                  value={index}
                  defaultChecked={routine.daysOfWeek.includes(index)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <Field label="Notes" htmlFor={`edit-notes-${routine.id}`} hint="Only you ever see these.">
        <Textarea
          id={`edit-notes-${routine.id}`}
          name="notes"
          maxLength={500}
          rows={2}
          defaultValue={routine.notes}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function RoutineManager({ routines }: { routines: ManagedRoutine[] }) {
  const [state, setState] = useState<ActionState>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (routines.length === 0) {
    return <p className="text-sm text-[var(--text-muted)]">No routines yet.</p>;
  }

  return (
    <div className="space-y-3">
      <Feedback state={state} />
      {routines.map((routine) => (
        <Card key={routine.id} className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="font-medium text-sm">
                {routine.name}
                {routine.active ? null : (
                  <Badge tone="neutral" className="ml-2">
                    Paused
                  </Badge>
                )}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">{routine.cadenceLabel}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setEditingId((id) => (id === routine.id ? null : routine.id))}
                aria-expanded={editingId === routine.id}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {editingId === routine.id ? 'Close' : 'Edit'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setState(await setRoutineActiveAction(routine.id, !routine.active));
                  })
                }
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                {routine.active ? 'Pause' : 'Resume'}
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
                Delete
              </Button>
            </div>
          </div>

          {editingId === routine.id ? (
            <RoutineEditForm
              routine={routine}
              pending={pending}
              onResult={setState}
              onClose={() => setEditingId(null)}
            />
          ) : null}

          <ul className="mt-3 space-y-1">
            {routine.tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 text-sm rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <span className="min-w-0">{task.label}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      setState(await deleteTaskAction(task.id));
                    })
                  }
                  className="h-8 w-8 grid place-items-center rounded-lg text-bad-500 hover:bg-bad-100/40"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Remove {task.label}</span>
                </button>
              </li>
            ))}
          </ul>

          <form
            action={(data) =>
              startTransition(async () => {
                setState(await addTaskAction({}, data));
              })
            }
            className="mt-3 flex items-end gap-2"
          >
            <input type="hidden" name="routineId" value={routine.id} />
            <div className="flex-1">
              <Field label="Add a task" htmlFor={`add-task-${routine.id}`}>
                <Input id={`add-task-${routine.id}`} name="label" maxLength={120} required />
              </Field>
            </div>
            <Button type="submit" variant="secondary" size="sm" disabled={pending}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </Button>
          </form>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ supplies */

export interface SupplyRow {
  supplyId: string;
  name: string;
  category: string;
  basis: 'typical_usage' | 'unknown';
  restock: boolean;
  /** The engine's honest note, including "GymOS cannot work this out" cases. */
  note: string;
  runningLow: boolean;
  /** The user's own stored values, so the edit form starts from what is saved. */
  lastReplacedAt: string | null;
  replaceEveryDays: number | null;
  notes: string;
}

/**
 * Edit the two numbers the runway is computed from, plus the item's own labels.
 *
 * Clearing a date or the interval here is a real instruction and is saved as such —
 * the runway then honestly reports "unknown" rather than an estimate. Fields the form
 * does not send are left untouched by the action.
 */
function SupplyEditForm({
  supply,
  today,
  pending,
  onResult,
  onClose,
}: {
  supply: SupplyRow;
  today: string;
  pending: boolean;
  onResult: (state: ActionState) => void;
  onClose: () => void;
}) {
  const [saving, startTransition] = useTransition();
  const busy = pending || saving;

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          const result = await updateSupplyAction({}, data);
          onResult(result);
          if (result.success) onClose();
        })
      }
      className="mt-3 space-y-3 rounded-xl border border-[var(--border)] p-3.5"
    >
      <input type="hidden" name="supplyId" value={supply.supplyId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Item" htmlFor={`edit-supply-name-${supply.supplyId}`} required>
          <Input
            id={`edit-supply-name-${supply.supplyId}`}
            name="name"
            maxLength={80}
            required
            defaultValue={supply.name}
          />
        </Field>
        <Field label="Category" htmlFor={`edit-supply-category-${supply.supplyId}`}>
          <Input
            id={`edit-supply-category-${supply.supplyId}`}
            name="category"
            maxLength={40}
            defaultValue={supply.category}
          />
        </Field>
        <Field
          label="Last replaced"
          htmlFor={`edit-supply-last-${supply.supplyId}`}
          hint="Clear it and GymOS stops working out a date."
        >
          <Input
            id={`edit-supply-last-${supply.supplyId}`}
            name="lastReplacedAt"
            type="date"
            max={today}
            defaultValue={supply.lastReplacedAt ?? ''}
          />
        </Field>
        <Field
          label="Usually lasts (days)"
          htmlFor={`edit-supply-interval-${supply.supplyId}`}
          hint="Your own estimate. GymOS never guesses this."
        >
          <Input
            id={`edit-supply-interval-${supply.supplyId}`}
            name="replaceEveryDays"
            type="number"
            min="1"
            max="3650"
            defaultValue={supply.replaceEveryDays ?? ''}
          />
        </Field>
      </div>
      <Field label="Notes" htmlFor={`edit-supply-notes-${supply.supplyId}`}>
        <Textarea
          id={`edit-supply-notes-${supply.supplyId}`}
          name="notes"
          maxLength={500}
          rows={2}
          defaultValue={supply.notes}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save changes
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function SupplyManager({ supplies, today }: { supplies: SupplyRow[]; today: string }) {
  const [state, setState] = useState<ActionState>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-5">
      <Feedback state={state} />

      <form
        action={(data) =>
          startTransition(async () => {
            setState(await createSupplyAction({}, data));
          })
        }
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Item" htmlFor="supply-name" required>
            <Input id="supply-name" name="name" maxLength={80} required placeholder="Toothpaste" />
          </Field>
          <Field label="Category" htmlFor="supply-category">
            <Input id="supply-category" name="category" maxLength={40} placeholder="general" />
          </Field>
          <Field label="Last replaced" htmlFor="supply-last" hint="Optional.">
            <Input id="supply-last" name="lastReplacedAt" type="date" max={today} />
          </Field>
          <Field
            label="Usually lasts (days)"
            htmlFor="supply-interval"
            hint="Your own estimate. GymOS never guesses this."
          >
            <Input id="supply-interval" name="replaceEveryDays" type="number" min="1" max="3650" />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={pending}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add supply
        </Button>
      </form>

      {supplies.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nothing tracked yet.</p>
      ) : (
        <ul className="space-y-2">
          {supplies.map((supply) => (
            <li key={supply.supplyId} className="rounded-xl border border-[var(--border)] p-3.5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {supply.name}
                    {supply.restock ? (
                      <Badge tone="warn" className="ml-2">
                        Restock
                      </Badge>
                    ) : null}
                    {supply.basis === 'unknown' ? (
                      <Badge tone="neutral" className="ml-2">
                        No estimate
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{supply.note}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      setEditingId((id) => (id === supply.supplyId ? null : supply.supplyId))
                    }
                    aria-expanded={editingId === supply.supplyId}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    {editingId === supply.supplyId ? 'Close' : 'Edit'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setState(
                          await setSupplyRunningLowAction(supply.supplyId, !supply.runningLow),
                        );
                      })
                    }
                  >
                    {supply.runningLow ? 'Not low any more' : 'Running low'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setState(await markSupplyReplacedAction(supply.supplyId, today));
                      })
                    }
                  >
                    Replaced today
                  </Button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setState(await deleteSupplyAction(supply.supplyId));
                      })
                    }
                    className="h-8 w-8 grid place-items-center rounded-lg text-bad-500 hover:bg-bad-100/40"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">Remove {supply.name}</span>
                  </button>
                </div>
              </div>
              {editingId === supply.supplyId ? (
                <SupplyEditForm
                  supply={supply}
                  today={today}
                  pending={pending}
                  onResult={setState}
                  onClose={() => setEditingId(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
