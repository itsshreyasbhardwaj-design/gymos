'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser, audit } from '@/lib/auth/session';
import { upsertProfile, completeOnboarding, getProfile, setConsent } from '@/lib/services/account';
import {
  createGymProfile,
  listGymProfiles,
  setProfileEquipment,
  activateGymProfile,
} from '@/lib/services/equipment';
import { saveNutritionPrefs } from '@/lib/services/nutrition';
import { buildPlanDraft, savePlan } from '@/lib/services/plans';
import { materialiseWeek } from '@/lib/services/sessions';
import { EQUIPMENT_PRESETS } from '@/lib/content/equipment';

export interface StepState {
  error?: string;
}

function list(formData: FormData, key: string): string[] {
  return formData.getAll(key).map(String).filter(Boolean);
}

export async function saveStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const user = await requireUser();
  const step = Number(formData.get('step') ?? 1);

  try {
    switch (step) {
      case 1: {
        const displayName = String(formData.get('displayName') ?? '').trim();
        if (!displayName) return { error: 'Please tell us what to call you.' };
        const ageBand = String(formData.get('ageBand') ?? '');
        if (!['under_13', 'teen_13_17', 'adult_18_plus'].includes(ageBand)) {
          return { error: 'Please choose an age group.' };
        }
        upsertProfile(user.id, {
          displayName,
          ageBand: ageBand as never,
          language: String(formData.get('language') ?? 'en-IN'),
          timezone: String(formData.get('timezone') ?? 'Asia/Kolkata'),
          units: (formData.get('units') === 'imperial' ? 'imperial' : 'metric') as never,
          accessibility: {
            reduceMotion: formData.get('reduceMotion') === 'on',
            largeText: formData.get('largeText') === 'on',
            highContrast: formData.get('highContrast') === 'on',
          },
          onboardingStep: 2,
        });
        break;
      }
      case 2: {
        upsertProfile(user.id, {
          experience: String(formData.get('experience') ?? 'new') as never,
          activities: String(formData.get('activities') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 10),
          onboardingStep: 3,
        });
        break;
      }
      case 3: {
        const interests = list(formData, 'interests');
        if (interests.length === 0) return { error: 'Pick at least one thing you want from training.' };
        upsertProfile(user.id, { interests, onboardingStep: 4 });
        break;
      }
      case 4: {
        const trainingDays = list(formData, 'trainingDays').map(Number).filter((n) => n >= 0 && n <= 6);
        if (trainingDays.length === 0) return { error: 'Pick at least one day you can train.' };
        const sessionMinutes = Number(formData.get('sessionMinutes') ?? 45);
        upsertProfile(user.id, {
          trainingDays,
          sessionMinutes,
          preferredTime: String(formData.get('preferredTime') ?? '') || null,
          scheduleFlexibility: String(formData.get('scheduleFlexibility') ?? 'some') as never,
          onboardingStep: 5,
        });
        break;
      }
      case 5: {
        upsertProfile(user.id, {
          environment: String(formData.get('environment') ?? 'home'),
          limitations: list(formData, 'limitations'),
          onboardingStep: 6,
        });
        break;
      }
      case 6: {
        const profile = getProfile(user.id);
        const presetKey = String(formData.get('presetKey') ?? 'bodyweight_home');
        const selected = list(formData, 'equipment');
        const ids = selected.length > 0 ? selected : (EQUIPMENT_PRESETS[presetKey]?.ids ?? []);
        const existing = listGymProfiles(user.id);
        if (existing.length === 0) {
          const id = createGymProfile(user.id, user.plan, {
            name: String(formData.get('profileName') ?? 'My setup').slice(0, 80),
            environment: profile?.environment ?? 'home',
            equipmentIds: ids,
          });
          activateGymProfile(user.id, id);
        } else {
          const first = existing[0];
          if (first) {
            setProfileEquipment(user.id, first.id, ids);
            activateGymProfile(user.id, first.id);
          }
        }
        upsertProfile(user.id, { onboardingStep: 7 });
        break;
      }
      case 7: {
        const profile = getProfile(user.id);
        const householdSize = Number(formData.get('householdSize') ?? 1);
        if (householdSize > 1) setConsent(user.id, 'household_planning', true);
        saveNutritionPrefs(user.id, profile?.ageBand ?? 'adult_18_plus', {
          diet: String(formData.get('diet') ?? 'no_preference') as never,
          cuisines: list(formData, 'cuisines'),
          allergenIds: list(formData, 'allergens'),
          dislikedIngredientIds: list(formData, 'dislikes'),
          cookingSkill: String(formData.get('cookingSkill') ?? 'beginner') as never,
          maxPrepMinutes: Number(formData.get('maxPrepMinutes') ?? 45),
          householdSize,
          includeSnacks: formData.get('includeSnacks') === 'on',
          medicalDietaryNote: String(formData.get('medicalDietaryNote') ?? '').slice(0, 500),
        });
        upsertProfile(user.id, { onboardingStep: 8 });
        break;
      }
      case 8: {
        upsertProfile(user.id, { onboardingStep: 9 });
        break;
      }
      default:
        return { error: 'Unknown step.' };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.' };
  }

  revalidatePath('/onboarding');
  redirect(`/onboarding?step=${step + 1}`);
}

export async function goToStep(step: number): Promise<void> {
  'use server';
  redirect(`/onboarding?step=${step}`);
}

export async function finishOnboarding(): Promise<void> {
  const user = await requireUser();
  const draft = buildPlanDraft(user.id);
  savePlan(user.id, draft, { name: 'Your first plan' });
  materialiseWeek(user.id);
  completeOnboarding(user.id);
  await audit('onboarding.completed', { userId: user.id });
  redirect('/dashboard?welcome=1');
}
