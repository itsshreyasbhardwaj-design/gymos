export type Plan = 'free' | 'pro';

export const FEATURES = {
  GYM_PROFILES: 'gym_profiles',
  REALITYSYNC: 'realitysync',
  MEAL_PLAN_DAYS: 'meal_plan_days',
  GROCERY_LISTS: 'grocery_lists',
  PANTRY: 'pantry',
  HISTORY_DAYS: 'history_days',
  PLAN_TEMPLATES: 'plan_templates',
  FITBRAIN_ACTIONS: 'fitbrain_actions',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  DATA_EXPORT: 'data_export',
  CUSTOM_EQUIPMENT: 'custom_equipment',
  // Wellness modules
  MEDIA_ASSETS: 'media_assets',
  WARDROBE_ITEMS: 'wardrobe_items',
  CARE_ROUTINES: 'care_routines',
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

export interface EntitlementRow {
  plan: Plan;
  feature: Feature;
  enabled: boolean;
  limitValue: number | null;
  note: string;
}

/**
 * The entitlement matrix. This is the single source of truth and is seeded into the
 * `entitlements` table; every check runs on the server.
 *
 * Free tier is deliberately usable on its own: one equipment profile, the full exercise
 * library, real workout generation, logging, history and basic meal suggestions.
 */
export const ENTITLEMENT_MATRIX: EntitlementRow[] = [
  { plan: 'free', feature: 'gym_profiles', enabled: true, limitValue: 1, note: 'One equipment profile' },
  { plan: 'pro', feature: 'gym_profiles', enabled: true, limitValue: 10, note: 'Up to 10 profiles' },

  { plan: 'free', feature: 'realitysync', enabled: false, limitValue: 0, note: 'Pro feature' },
  { plan: 'pro', feature: 'realitysync', enabled: true, limitValue: null, note: 'Full adaptation' },

  { plan: 'free', feature: 'meal_plan_days', enabled: true, limitValue: 2, note: 'Two days of meal suggestions' },
  { plan: 'pro', feature: 'meal_plan_days', enabled: true, limitValue: 7, note: 'Full week' },

  { plan: 'free', feature: 'grocery_lists', enabled: false, limitValue: 0, note: 'Pro feature' },
  { plan: 'pro', feature: 'grocery_lists', enabled: true, limitValue: 25, note: 'Saved lists' },

  { plan: 'free', feature: 'pantry', enabled: false, limitValue: 0, note: 'Pro feature' },
  { plan: 'pro', feature: 'pantry', enabled: true, limitValue: null, note: 'Full pantry' },

  { plan: 'free', feature: 'history_days', enabled: true, limitValue: 30, note: 'Last 30 days' },
  { plan: 'pro', feature: 'history_days', enabled: true, limitValue: null, note: 'Full history' },

  { plan: 'free', feature: 'plan_templates', enabled: false, limitValue: 0, note: 'Pro feature' },
  { plan: 'pro', feature: 'plan_templates', enabled: true, limitValue: 20, note: 'Saved templates' },

  { plan: 'free', feature: 'fitbrain_actions', enabled: true, limitValue: 10, note: '10 assistant actions a day' },
  { plan: 'pro', feature: 'fitbrain_actions', enabled: true, limitValue: null, note: 'Unlimited' },

  { plan: 'free', feature: 'advanced_analytics', enabled: false, limitValue: 0, note: 'Pro feature' },
  { plan: 'pro', feature: 'advanced_analytics', enabled: true, limitValue: null, note: 'Full analytics' },

  // Data rights are never gated behind a paywall.
  { plan: 'free', feature: 'data_export', enabled: true, limitValue: null, note: 'Always available' },
  { plan: 'pro', feature: 'data_export', enabled: true, limitValue: null, note: 'Always available' },

  { plan: 'free', feature: 'custom_equipment', enabled: true, limitValue: 5, note: 'Up to 5 custom items' },
  { plan: 'pro', feature: 'custom_equipment', enabled: true, limitValue: 100, note: 'Up to 100' },

  // Private media is capped by storage cost, not withheld as a lever: the journal
  // itself is free, and the data rights over it are never paywalled.
  { plan: 'free', feature: 'media_assets', enabled: true, limitValue: 25, note: '25 private files' },
  { plan: 'pro', feature: 'media_assets', enabled: true, limitValue: 500, note: '500 private files' },

  { plan: 'free', feature: 'wardrobe_items', enabled: true, limitValue: 40, note: '40 wardrobe items' },
  { plan: 'pro', feature: 'wardrobe_items', enabled: true, limitValue: null, note: 'Unlimited' },

  { plan: 'free', feature: 'care_routines', enabled: true, limitValue: 4, note: '4 care routines' },
  { plan: 'pro', feature: 'care_routines', enabled: true, limitValue: null, note: 'Unlimited' },
];

const BY_KEY = new Map(ENTITLEMENT_MATRIX.map((r) => [`${r.plan}:${r.feature}`, r]));

export interface EntitlementCheck {
  allowed: boolean;
  limit: number | null;
  current?: number;
  reason?: string;
  upgradeRequired: boolean;
}

export function getEntitlement(plan: Plan, feature: Feature): EntitlementRow {
  return (
    BY_KEY.get(`${plan}:${feature}`) ?? {
      plan,
      feature,
      enabled: false,
      limitValue: 0,
      note: 'Unknown feature',
    }
  );
}

/** Pure entitlement decision. Callers must pass the current usage count for limits. */
export function checkEntitlement(
  plan: Plan,
  feature: Feature,
  currentUsage = 0,
): EntitlementCheck {
  const row = getEntitlement(plan, feature);
  if (!row.enabled) {
    return {
      allowed: false,
      limit: 0,
      current: currentUsage,
      reason: `${humanFeature(feature)} is part of GymOS Pro.`,
      upgradeRequired: true,
    };
  }
  if (row.limitValue != null && currentUsage >= row.limitValue) {
    return {
      allowed: false,
      limit: row.limitValue,
      current: currentUsage,
      reason:
        plan === 'free'
          ? `Your free plan includes ${row.limitValue} ${humanFeature(feature).toLowerCase()}. Pro raises this limit.`
          : `You have reached the limit of ${row.limitValue} for ${humanFeature(feature).toLowerCase()}.`,
      upgradeRequired: plan === 'free',
    };
  }
  return { allowed: true, limit: row.limitValue, current: currentUsage, upgradeRequired: false };
}

export function humanFeature(feature: Feature): string {
  const map: Record<string, string> = {
    gym_profiles: 'Equipment profiles',
    realitysync: 'RealitySync adaptation',
    meal_plan_days: 'Meal plan days',
    grocery_lists: 'Grocery lists',
    pantry: 'Pantry tracking',
    history_days: 'Training history window',
    plan_templates: 'Saved plan templates',
    fitbrain_actions: 'FitBrain actions',
    advanced_analytics: 'Advanced progress analytics',
    data_export: 'Data export',
    custom_equipment: 'Custom equipment entries',
    media_assets: 'Private photo and voice files',
    wardrobe_items: 'Wardrobe items',
    care_routines: 'Grooming and hygiene routines',
  };
  return map[feature] ?? feature;
}

export class EntitlementError extends Error {
  readonly check: EntitlementCheck;
  readonly feature: Feature;
  constructor(feature: Feature, check: EntitlementCheck) {
    super(check.reason ?? 'Not included in your plan');
    this.name = 'EntitlementError';
    this.feature = feature;
    this.check = check;
  }
}

/* --------------------------------------------------------------- pricing copy */

export const PRICING = {
  free: {
    name: 'GymOS Free',
    pricePaise: 0,
    interval: 'month' as const,
    blurb: 'Everything you need to train with what you have.',
    includes: [
      'One equipment profile',
      'Full exercise library with instructions',
      'Generated weekly workout plan',
      'Guided workout logging',
      'Training history (last 30 days)',
      'Two days of meal suggestions',
      'Data export and account deletion',
    ],
  },
  pro: {
    name: 'GymOS Pro',
    pricePaise: 29900,
    interval: 'month' as const,
    blurb: 'For training that has to fit around real life.',
    includes: [
      'Up to 10 equipment profiles',
      'RealitySync: adapt plans to equipment, time and schedule changes',
      'Full weekly meal planning',
      'Grocery lists and pantry tracking',
      'Complete training history and analytics',
      'Saved plan templates',
      'Unlimited FitBrain actions',
    ],
  },
} as const;

/**
 * Billing status. Razorpay is NOT connected: there is no live payment path in this
 * build, and the UI says so rather than simulating a successful purchase.
 */
export const BILLING_STATUS = {
  provider: 'razorpay' as const,
  live: false,
  message:
    'Payments are not enabled in this build. The pricing below is the intended plan structure, and the entitlement checks behind it are real and enforced on the server — but no card can be charged and no subscription can be purchased yet.',
} as const;
