import { describe, it, expect } from 'vitest';
import {
  checkEntitlement,
  getEntitlement,
  ENTITLEMENT_MATRIX,
  PRICING,
  BILLING_STATUS,
  EntitlementError,
  humanFeature,
  FEATURES,
} from '@/lib/engines/entitlements';

describe('entitlement matrix', () => {
  it('defines every feature for both plans', () => {
    const features = new Set(ENTITLEMENT_MATRIX.map((e) => e.feature));
    for (const feature of features) {
      expect(ENTITLEMENT_MATRIX.filter((e) => e.feature === feature).length).toBe(2);
    }
    expect(features.size).toBe(Object.keys(FEATURES).length);
  });

  it('never gives free more than pro', () => {
    const features = new Set(ENTITLEMENT_MATRIX.map((e) => e.feature));
    for (const feature of features) {
      const free = getEntitlement('free', feature);
      const pro = getEntitlement('pro', feature);
      if (!free.enabled) continue;
      if (free.limitValue == null) {
        expect(pro.limitValue).toBeNull();
      } else if (pro.limitValue != null) {
        expect(pro.limitValue).toBeGreaterThanOrEqual(free.limitValue);
      }
    }
  });

  it('keeps data export available on every plan', () => {
    expect(getEntitlement('free', 'data_export').enabled).toBe(true);
    expect(getEntitlement('free', 'data_export').limitValue).toBeNull();
  });

  it('keeps the free tier genuinely usable on its own', () => {
    for (const feature of ['gym_profiles', 'history_days', 'meal_plan_days', 'fitbrain_actions'] as const) {
      expect(getEntitlement('free', feature).enabled).toBe(true);
    }
  });
});

describe('checkEntitlement', () => {
  it('blocks a feature that is not part of the plan', () => {
    const result = checkEntitlement('free', 'realitysync');
    expect(result.allowed).toBe(false);
    expect(result.upgradeRequired).toBe(true);
    expect(result.reason).toMatch(/Pro/);
  });

  it('allows a feature that is part of the plan', () => {
    expect(checkEntitlement('pro', 'realitysync').allowed).toBe(true);
  });

  it('allows usage up to the limit and blocks at it', () => {
    expect(checkEntitlement('free', 'gym_profiles', 0).allowed).toBe(true);
    expect(checkEntitlement('free', 'gym_profiles', 1).allowed).toBe(false);
    expect(checkEntitlement('pro', 'gym_profiles', 1).allowed).toBe(true);
  });

  it('does not offer an upgrade to someone already on pro', () => {
    const result = checkEntitlement('pro', 'gym_profiles', 999);
    expect(result.allowed).toBe(false);
    expect(result.upgradeRequired).toBe(false);
  });

  it('treats an unlimited feature as always allowed', () => {
    expect(checkEntitlement('pro', 'history_days', 10_000).allowed).toBe(true);
  });

  it('fails closed for an unknown feature', () => {
    expect(checkEntitlement('free', 'not_a_feature' as never).allowed).toBe(false);
  });

  it('produces a readable error', () => {
    const check = checkEntitlement('free', 'pantry');
    const error = new EntitlementError('pantry', check);
    expect(error.message).toMatch(/Pro/);
    expect(error.feature).toBe('pantry');
  });

  it('gives every feature a human-readable name', () => {
    for (const feature of Object.values(FEATURES)) {
      expect(humanFeature(feature)).not.toBe(feature);
    }
  });
});

describe('pricing and billing honesty', () => {
  it('prices in integer paise, never floats', () => {
    expect(Number.isInteger(PRICING.free.pricePaise)).toBe(true);
    expect(Number.isInteger(PRICING.pro.pricePaise)).toBe(true);
    expect(PRICING.free.pricePaise).toBe(0);
  });

  it('states plainly that billing is not live', () => {
    expect(BILLING_STATUS.live).toBe(false);
    expect(BILLING_STATUS.message).toMatch(/not enabled|no card can be charged/i);
  });
});
