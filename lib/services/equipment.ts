import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { gymProfiles, gymEquipment, equipmentTypes } from '@/lib/db/schema';
import { expandEquipment } from '@/lib/engines/equipment';
import { EQUIPMENT_CATALOG, EQUIPMENT_PRESETS } from '@/lib/content/equipment';
import { newId } from '@/lib/auth/ids';
import { requireEntitlement } from './entitlements';
import type { Plan } from '@/lib/engines/entitlements';

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export interface GymProfileSummary {
  id: string;
  name: string;
  environment: string;
  isActive: boolean;
  notes: string;
  equipmentCount: number;
}

export function listGymProfiles(userId: string): GymProfileSummary[] {
  const profiles = db
    .select({
      id: gymProfiles.id,
      name: gymProfiles.name,
      environment: gymProfiles.environment,
      isActive: gymProfiles.isActive,
      notes: gymProfiles.notes,
      createdAt: gymProfiles.createdAt,
    })
    .from(gymProfiles)
    .where(eq(gymProfiles.userId, userId))
    .all();

  // Counted with a grouped query and joined in memory: clearer than a correlated
  // subquery, and it keeps the profile list to two predictable statements.
  const counts = new Map<string, number>();
  if (profiles.length > 0) {
    const rows = db
      .select({ profileId: gymEquipment.gymProfileId, count: sql<number>`count(*)` })
      .from(gymEquipment)
      .where(
        and(
          inArray(
            gymEquipment.gymProfileId,
            profiles.map((p) => p.id),
          ),
          eq(gymEquipment.available, true),
        ),
      )
      .groupBy(gymEquipment.gymProfileId)
      .all();
    for (const row of rows) counts.set(row.profileId, row.count);
  }

  return profiles
    .map((p) => ({
      id: p.id,
      name: p.name,
      environment: p.environment,
      isActive: p.isActive,
      notes: p.notes,
      createdAt: p.createdAt,
      equipmentCount: counts.get(p.id) ?? 0,
    }))
    .sort(
      (a, b) =>
        Number(b.isActive) - Number(a.isActive) || a.createdAt.localeCompare(b.createdAt),
    )
    .map(({ createdAt: _createdAt, ...rest }) => rest);
}

/** Ownership is checked in SQL on every read, not in application code afterwards. */
export function getGymProfile(userId: string, profileId: string) {
  const profile = db
    .select()
    .from(gymProfiles)
    .where(and(eq(gymProfiles.id, profileId), eq(gymProfiles.userId, userId)))
    .get();
  if (!profile) throw new NotFoundError('That equipment profile does not exist.');
  const items = db
    .select({
      id: gymEquipment.id,
      equipmentTypeId: gymEquipment.equipmentTypeId,
      available: gymEquipment.available,
      quantity: gymEquipment.quantity,
      detail: gymEquipment.detail,
      preferred: gymEquipment.preferred,
      notes: gymEquipment.notes,
      name: equipmentTypes.name,
      category: equipmentTypes.category,
    })
    .from(gymEquipment)
    .innerJoin(equipmentTypes, eq(equipmentTypes.id, gymEquipment.equipmentTypeId))
    .where(eq(gymEquipment.gymProfileId, profileId))
    .all();
  return { profile, items };
}

export function getActiveGymProfile(userId: string) {
  const active = db
    .select()
    .from(gymProfiles)
    .where(and(eq(gymProfiles.userId, userId), eq(gymProfiles.isActive, true)))
    .get();
  if (active) return active;
  return db.select().from(gymProfiles).where(eq(gymProfiles.userId, userId)).get() ?? null;
}

/** The expanded equipment set used by every eligibility decision. */
export function activeEquipmentSet(userId: string): {
  set: Set<string>;
  profileId: string | null;
  profileName: string | null;
} {
  const profile = getActiveGymProfile(userId);
  if (!profile) return { set: expandEquipment([]), profileId: null, profileName: null };
  return {
    set: equipmentSetForProfile(profile.id),
    profileId: profile.id,
    profileName: profile.name,
  };
}

export function equipmentSetForProfile(profileId: string): Set<string> {
  const rows = db
    .select({ id: gymEquipment.equipmentTypeId })
    .from(gymEquipment)
    .where(and(eq(gymEquipment.gymProfileId, profileId), eq(gymEquipment.available, true)))
    .all();
  return expandEquipment(rows.map((r) => r.id));
}

export function createGymProfile(
  userId: string,
  plan: Plan,
  input: { name: string; environment: string; presetKey?: string; equipmentIds?: string[]; notes?: string },
): string {
  requireEntitlement(plan, userId, 'gym_profiles');
  const id = newId();
  const existing = listGymProfiles(userId);
  const ids =
    input.equipmentIds ??
    (input.presetKey ? (EQUIPMENT_PRESETS[input.presetKey]?.ids ?? []) : []);

  db.transaction((tx) => {
    tx.insert(gymProfiles)
      .values({
        id,
        userId,
        name: input.name.slice(0, 80),
        environment: input.environment as never,
        isActive: existing.length === 0,
        notes: (input.notes ?? '').slice(0, 500),
      })
      .run();
    for (const equipmentTypeId of new Set(ids)) {
      tx.insert(gymEquipment)
        .values({ id: newId(), gymProfileId: id, equipmentTypeId, available: true })
        .run();
    }
  });
  return id;
}

export function setProfileEquipment(userId: string, profileId: string, equipmentIds: string[]): void {
  getGymProfile(userId, profileId); // ownership check
  const valid = new Set(
    db.select({ id: equipmentTypes.id }).from(equipmentTypes).all().map((r) => r.id),
  );
  const wanted = [...new Set(equipmentIds)].filter((id) => valid.has(id));
  db.transaction((tx) => {
    tx.delete(gymEquipment).where(eq(gymEquipment.gymProfileId, profileId)).run();
    for (const equipmentTypeId of wanted) {
      tx.insert(gymEquipment)
        .values({ id: newId(), gymProfileId: profileId, equipmentTypeId, available: true })
        .run();
    }
    tx.update(gymProfiles)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(gymProfiles.id, profileId))
      .run();
  });
}

export function toggleEquipmentAvailability(
  userId: string,
  profileId: string,
  equipmentTypeId: string,
  available: boolean,
): void {
  getGymProfile(userId, profileId);
  const existing = db
    .select({ id: gymEquipment.id })
    .from(gymEquipment)
    .where(
      and(
        eq(gymEquipment.gymProfileId, profileId),
        eq(gymEquipment.equipmentTypeId, equipmentTypeId),
      ),
    )
    .get();
  if (existing) {
    db.update(gymEquipment)
      .set({ available, updatedAt: new Date().toISOString() })
      .where(eq(gymEquipment.id, existing.id))
      .run();
  } else if (available) {
    db.insert(gymEquipment)
      .values({ id: newId(), gymProfileId: profileId, equipmentTypeId, available: true })
      .run();
  }
}

export function setEquipmentDetail(
  userId: string,
  profileId: string,
  equipmentTypeId: string,
  detail: { minKg?: number; maxKg?: number; stepKg?: number; note?: string },
  opts: { preferred?: boolean; notes?: string; quantity?: number } = {},
): void {
  getGymProfile(userId, profileId);
  db.update(gymEquipment)
    .set({
      detail,
      preferred: opts.preferred,
      notes: opts.notes?.slice(0, 300),
      quantity: opts.quantity,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(gymEquipment.gymProfileId, profileId),
        eq(gymEquipment.equipmentTypeId, equipmentTypeId),
      ),
    )
    .run();
}

export function activateGymProfile(userId: string, profileId: string): void {
  getGymProfile(userId, profileId);
  db.transaction((tx) => {
    tx.update(gymProfiles).set({ isActive: false }).where(eq(gymProfiles.userId, userId)).run();
    tx.update(gymProfiles).set({ isActive: true }).where(eq(gymProfiles.id, profileId)).run();
  });
}

export function renameGymProfile(userId: string, profileId: string, name: string, notes?: string): void {
  getGymProfile(userId, profileId);
  db.update(gymProfiles)
    .set({ name: name.slice(0, 80), notes: notes?.slice(0, 500), updatedAt: new Date().toISOString() })
    .where(eq(gymProfiles.id, profileId))
    .run();
}

export function deleteGymProfile(userId: string, profileId: string): void {
  const { profile } = getGymProfile(userId, profileId);
  const all = listGymProfiles(userId);
  if (all.length <= 1) {
    throw new Error('You need at least one equipment profile. Edit this one instead of deleting it.');
  }
  db.transaction((tx) => {
    tx.delete(gymProfiles).where(eq(gymProfiles.id, profileId)).run();
    if (profile.isActive) {
      const next = all.find((p) => p.id !== profileId);
      if (next) tx.update(gymProfiles).set({ isActive: true }).where(eq(gymProfiles.id, next.id)).run();
    }
  });
}

export function createCustomEquipment(
  userId: string,
  plan: Plan,
  input: { name: string; category: string; description?: string },
): string {
  requireEntitlement(plan, userId, 'custom_equipment');
  const slug = `custom-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}-${newId().slice(0, 6)}`;
  db.insert(equipmentTypes)
    .values({
      id: slug,
      name: input.name.slice(0, 80),
      category: input.category as never,
      description: (input.description ?? '').slice(0, 300),
      isCustom: true,
      createdByUserId: userId,
      sortOrder: 999,
    })
    .run();
  return slug;
}

export function listEquipmentTypes(userId: string) {
  return db
    .select()
    .from(equipmentTypes)
    .where(sql`${equipmentTypes.isCustom} = 0 or ${equipmentTypes.createdByUserId} = ${userId}`)
    .orderBy(equipmentTypes.sortOrder, equipmentTypes.name)
    .all();
}

export { EQUIPMENT_CATALOG, EQUIPMENT_PRESETS };
