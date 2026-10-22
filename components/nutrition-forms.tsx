'use client';

import { useState, useTransition } from 'react';
import { Button, Field, Notice, Select, Textarea } from '@/components/ui';
import { saveNutritionPrefsAction, type ActionState } from '@/app/(app)/actions';
import { cn } from '@/lib/ui/cn';

interface Prefs {
  diet: string;
  cuisines: string[];
  allergenIds: string[];
  dislikedIngredientIds: string[];
  cookingSkill: string;
  maxPrepMinutes: number;
  householdSize: number;
  includeSnacks: boolean;
  medicalDietaryNote?: string;
}

function Chip({
  name,
  value,
  label,
  defaultChecked,
  tone = 'default',
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <label
      className={cn(
        'cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors',
        'border-[var(--border)] hover:border-[var(--border-strong)]',
        tone === 'danger'
          ? 'has-[:checked]:border-bad-500 has-[:checked]:bg-bad-100/50 has-[:checked]:text-bad-500'
          : 'has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)] has-[:checked]:text-[var(--accent)]',
      )}
    >
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="sr-only" />
      {label}
    </label>
  );
}

export function NutritionPrefsForm({
  prefs,
  allergens,
  cuisines,
  ingredients,
  isMinor,
}: {
  prefs: Prefs;
  allergens: { id: string; name: string }[];
  cuisines: { id: string; label: string }[];
  ingredients: { id: string; name: string }[];
  isMinor: boolean;
}) {
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(data) =>
        startTransition(async () => {
          setState(await saveNutritionPrefsAction({}, data));
        })
      }
      className="space-y-5"
    >
      <Field label="Dietary preference" htmlFor="diet">
        <Select id="diet" name="diet" defaultValue={prefs.diet}>
          <option value="no_preference">No preference</option>
          <option value="vegetarian">Vegetarian</option>
          <option value="vegan">Vegan</option>
          <option value="eggetarian">Vegetarian plus egg</option>
          <option value="non_vegetarian">Non-vegetarian</option>
        </Select>
      </Field>

      <fieldset>
        <legend className="text-sm font-medium mb-2">Allergies (hard exclusions)</legend>
        <div className="flex flex-wrap gap-1.5">
          {allergens.map((a) => (
            <Chip
              key={a.id}
              name="allergens"
              value={a.id}
              label={a.name}
              defaultChecked={prefs.allergenIds.includes(a.id)}
              tone="danger"
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium mb-2">Cuisines you enjoy</legend>
        <div className="flex flex-wrap gap-1.5">
          {cuisines.map((c) => (
            <Chip
              key={c.id}
              name="cuisines"
              value={c.id}
              label={c.label}
              defaultChecked={prefs.cuisines.includes(c.id)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium mb-2">Ingredients to avoid</legend>
        <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
          {ingredients.map((i) => (
            <Chip
              key={i.id}
              name="dislikes"
              value={i.id}
              label={i.name}
              defaultChecked={prefs.dislikedIngredientIds.includes(i.id)}
            />
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Cooking confidence" htmlFor="cookingSkill">
          <Select id="cookingSkill" name="cookingSkill" defaultValue={prefs.cookingSkill}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Comfortable</option>
            <option value="confident">Confident</option>
          </Select>
        </Field>
        <Field label="Max time per meal" htmlFor="maxPrepMinutes">
          <Select id="maxPrepMinutes" name="maxPrepMinutes" defaultValue={String(prefs.maxPrepMinutes)}>
            {[15, 20, 30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cooking for" htmlFor="householdSize">
          <Select id="householdSize" name="householdSize" defaultValue={String(prefs.householdSize)}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'person' : 'people'}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="includeSnacks"
          defaultChecked={prefs.includeSnacks}
          className="h-5 w-5 accent-[var(--accent)]"
        />
        Include snack suggestions
      </label>

      <Field
        label="Medical dietary requirements"
        htmlFor="medicalDietaryNote"
        hint="GymOS does not build therapeutic diets. This is recorded so it can remind you to involve a qualified dietitian."
      >
        <Textarea
          id="medicalDietaryNote"
          name="medicalDietaryNote"
          rows={2}
          maxLength={500}
          defaultValue={prefs.medicalDietaryNote ?? ''}
        />
      </Field>

      {isMinor ? (
        <Notice tone="teal">
          This is an under-18 account, so calorie targets, weight goals and restrictive plans are
          refused by the server — not merely hidden here.
        </Notice>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save preferences'}
      </Button>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      {state.success ? <Notice tone="ok">{state.success}</Notice> : null}
    </form>
  );
}
