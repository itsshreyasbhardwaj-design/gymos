'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import {
  generateReview,
  setReviewPreferences,
  setReviewGoals,
  deleteReview,
} from '@/lib/services/review';
import { ALL_SECTION_KEYS, type ReviewPeriodKind } from '@/lib/engines/review';

export interface ActionState {
  error?: string;
  success?: string;
}

async function run(fn: () => void | Promise<void>, success: string): Promise<ActionState> {
  try {
    await fn();
    return { success };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

const PERIODS: ReviewPeriodKind[] = ['weekly', 'fortnightly', 'monthly', 'manual'];

function periodFrom(formData: FormData): ReviewPeriodKind {
  const raw = String(formData.get('cadence') ?? 'weekly');
  return PERIODS.includes(raw as ReviewPeriodKind) ? (raw as ReviewPeriodKind) : 'weekly';
}

export async function generateReviewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => {
    generateReview(user.id, periodFrom(formData));
  }, 'Review generated from what you recorded.');
  revalidatePath('/reviews');
  return result;
}

export async function saveReviewPreferencesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const included = ALL_SECTION_KEYS.filter((key) => formData.get(`section:${key}`) === 'on');
  const result = await run(() => {
    setReviewPreferences(user.id, { cadence: periodFrom(formData), includedSections: included });
  }, 'Review settings saved.');
  revalidatePath('/reviews');
  return result;
}

export async function saveReviewGoalsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  const goals = String(formData.get('goals') ?? '')
    .split('\n')
    .map((g) => g.trim())
    .filter(Boolean);
  const result = await run(() => setReviewGoals(user.id, id, goals), 'Your notes are saved.');
  revalidatePath('/reviews');
  return result;
}

export async function deleteReviewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  const result = await run(() => deleteReview(user.id, id), 'Review deleted.');
  revalidatePath('/reviews');
  return result;
}
