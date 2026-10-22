import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { gymProfiles, groceryLists, equipmentTypes, mealPlans } from '@/lib/db/schema';
import {
  checkEntitlement,
  EntitlementError,
  type Feature,
  type Plan,
  type EntitlementCheck,
} from '@/lib/engines/entitlements';

/** Current usage count for the features that have limits. */
export function currentUsage(userId: string, feature: Feature): number {
  switch (feature) {
    case 'gym_profiles':
      return count(db.select({ c: sql<number>`count(*)` }).from(gymProfiles).where(eq(gymProfiles.userId, userId)).all());
    case 'grocery_lists':
      return count(db.select({ c: sql<number>`count(*)` }).from(groceryLists).where(eq(groceryLists.userId, userId)).all());
    case 'custom_equipment':
      return count(
        db
          .select({ c: sql<number>`count(*)` })
          .from(equipmentTypes)
          .where(and(eq(equipmentTypes.createdByUserId, userId), eq(equipmentTypes.isCustom, true)))
          .all(),
      );
    case 'plan_templates':
      return count(db.select({ c: sql<number>`count(*)` }).from(mealPlans).where(eq(mealPlans.userId, userId)).all());
    default:
      return 0;
  }
}

function count(rows: { c: number }[]): number {
  return rows[0]?.c ?? 0;
}

export function evaluate(plan: Plan, userId: string, feature: Feature): EntitlementCheck {
  return checkEntitlement(plan, feature, currentUsage(userId, feature));
}

/** Server-side gate. Throws EntitlementError, which the UI renders as an upgrade prompt. */
export function requireEntitlement(plan: Plan, userId: string, feature: Feature): EntitlementCheck {
  const result = evaluate(plan, userId, feature);
  if (!result.allowed) throw new EntitlementError(feature, result);
  return result;
}

export { EntitlementError };
