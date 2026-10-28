import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { wardrobeItems, outfitCombinations, outfitPlans } from '@/lib/db/schema';
import {
  suggestOutfits,
  outfitGaps,
  normaliseOccasion,
  normaliseWeather,
  slotForCategory,
  parseColour,
  type OutfitItem,
  type OutfitSuggestion,
  type WardrobeGap,
  type Occasion,
  type WeatherBand,
} from '@/lib/engines/outfit';
import { newId } from '@/lib/auth/ids';
import { ownsMedia } from './media';
import { requireEntitlement } from './entitlements';
import { NotFoundError } from './equipment';
import { ValidationError } from './account';
import type { Plan } from '@/lib/engines/entitlements';

/* -------------------------------------------------------------- validation */

const MAX_NAME = 80;
const MAX_NOTES = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireName(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError('Give this a name so you can recognise it later.', field);
  return trimmed.slice(0, MAX_NAME);
}

function requireIsoDate(value: string, field = 'date'): string {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new ValidationError('Use a calendar date in YYYY-MM-DD form.', field);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampScale(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(5, Math.max(1, Math.round(value)));
}

const MAX_TAGS = 12;

/**
 * Normalises a tag list, and refuses an over-long one rather than truncating it.
 *
 * Truncating was the easy thing and the wrong thing: the edit form now round-trips the
 * tags an item already has, so a silent `slice` would drop one of them the next time the
 * user ticked a box — losing something they had typed, with no error and no message. An
 * item is allowed a sensible number of tags; past that the user is told, not edited.
 */
function cleanTags(tags: string[] | undefined, field: string): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim().slice(0, 40);
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  if (out.length > MAX_TAGS) {
    throw new ValidationError(
      `An item holds up to ${MAX_TAGS} ${field}, and this one has ${out.length}. Remove ${out.length - MAX_TAGS} — nothing was saved, so none of the others were lost.`,
      field,
    );
  }
  return out;
}

/**
 * A photo may only be linked once the media service confirms this user owns it.
 * Ownership is checked there, not here, so there is exactly one authority on it.
 */
function verifyAsset(userId: string, assetId: string | null | undefined): string | null {
  if (!assetId) return null;
  if (!ownsMedia(userId, assetId)) {
    throw new ValidationError('That photo does not belong to your account, so it was not linked.', 'assetId');
  }
  return assetId;
}

/* ------------------------------------------------------------------- items */

export interface WardrobeItemInput {
  name: string;
  category: string;
  /** Stored on the row as `colors`, which is the schema's spelling. */
  colors?: string[];
  fabric?: string;
  sizeLabel?: string;
  occasionTags?: string[];
  seasonTags?: string[];
  formality?: number;
  warmth?: number;
  favourite?: boolean;
  needsCare?: boolean;
  notes?: string;
  assetId?: string | null;
}

export type WardrobeItemRow = typeof wardrobeItems.$inferSelect;

export interface WardrobeItemView extends WardrobeItemRow {
  /** Which outfit slot the free-text category maps to; null when unrecognised. */
  slot: ReturnType<typeof slotForCategory>;
  /** Colour names GymOS could not match against its colour table. */
  unrecognisedColors: string[];
}

function toView(row: WardrobeItemRow): WardrobeItemView {
  return {
    ...row,
    slot: slotForCategory(row.category),
    unrecognisedColors: row.colors.filter((c) => parseColour(c) === null),
  };
}

export function listWardrobeItems(
  userId: string,
  opts: { includeArchived?: boolean; category?: string; occasion?: string } = {},
): WardrobeItemView[] {
  const clauses = [eq(wardrobeItems.userId, userId)];
  if (!opts.includeArchived) clauses.push(eq(wardrobeItems.archived, false));
  if (opts.category) clauses.push(eq(wardrobeItems.category, opts.category));
  const rows = db
    .select()
    .from(wardrobeItems)
    .where(and(...clauses))
    .orderBy(desc(wardrobeItems.createdAt))
    .all();
  const views = rows.map(toView);
  if (!opts.occasion) return views;
  const occasion = normaliseOccasion(opts.occasion);
  return views.filter((item) => item.occasionTags.some((t) => normaliseOccasion(t) === occasion));
}

/** Ownership is in the SQL predicate on every single read. */
export function getWardrobeItem(userId: string, itemId: string): WardrobeItemView {
  const row = db
    .select()
    .from(wardrobeItems)
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That wardrobe item does not exist.');
  return toView(row);
}

export function createWardrobeItem(userId: string, plan: Plan, input: WardrobeItemInput): string {
  requireEntitlement(plan, userId, 'wardrobe_items');
  const name = requireName(input.name, 'name');
  const category = input.category.trim().slice(0, 40);
  if (!category) throw new ValidationError('Pick what kind of garment this is.', 'category');

  const id = newId();
  db.insert(wardrobeItems)
    .values({
      id,
      userId,
      name,
      category,
      colors: cleanTags(input.colors, 'colours'),
      fabric: (input.fabric ?? '').trim().slice(0, 60),
      sizeLabel: (input.sizeLabel ?? '').trim().slice(0, 30),
      occasionTags: cleanTags(input.occasionTags, 'occasion tags'),
      seasonTags: cleanTags(input.seasonTags, 'season tags'),
      formality: clampScale(input.formality, 2),
      warmth: clampScale(input.warmth, 2),
      favourite: input.favourite ?? false,
      needsCare: input.needsCare ?? false,
      notes: (input.notes ?? '').slice(0, MAX_NOTES),
      assetId: verifyAsset(userId, input.assetId),
    })
    .run();
  return id;
}

export function updateWardrobeItem(
  userId: string,
  itemId: string,
  patch: Partial<WardrobeItemInput> & { archived?: boolean },
): void {
  const existing = getWardrobeItem(userId, itemId);
  const values: Partial<WardrobeItemRow> = {};
  if (patch.name !== undefined) values.name = requireName(patch.name, 'name');
  if (patch.category !== undefined) {
    const category = patch.category.trim().slice(0, 40);
    if (!category) throw new ValidationError('Pick what kind of garment this is.', 'category');
    values.category = category;
  }
  if (patch.colors !== undefined) values.colors = cleanTags(patch.colors, 'colours');
  if (patch.fabric !== undefined) values.fabric = patch.fabric.trim().slice(0, 60);
  if (patch.sizeLabel !== undefined) values.sizeLabel = patch.sizeLabel.trim().slice(0, 30);
  if (patch.occasionTags !== undefined) values.occasionTags = cleanTags(patch.occasionTags, 'occasion tags');
  if (patch.seasonTags !== undefined) values.seasonTags = cleanTags(patch.seasonTags, 'season tags');
  if (patch.formality !== undefined) values.formality = clampScale(patch.formality, existing.formality);
  if (patch.warmth !== undefined) values.warmth = clampScale(patch.warmth, existing.warmth);
  if (patch.favourite !== undefined) values.favourite = patch.favourite;
  if (patch.needsCare !== undefined) values.needsCare = patch.needsCare;
  if (patch.notes !== undefined) values.notes = patch.notes.slice(0, MAX_NOTES);
  if (patch.archived !== undefined) values.archived = patch.archived;
  if (patch.assetId !== undefined) values.assetId = verifyAsset(userId, patch.assetId);
  if (Object.keys(values).length === 0) return;

  db.update(wardrobeItems)
    .set(values)
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)))
    .run();
}

export function archiveWardrobeItem(userId: string, itemId: string, archived = true): void {
  updateWardrobeItem(userId, itemId, { archived });
}

export function deleteWardrobeItem(userId: string, itemId: string): void {
  getWardrobeItem(userId, itemId);
  db.transaction((tx) => {
    tx.delete(wardrobeItems)
      .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)))
      .run();
    // Saved combinations that referenced it would otherwise claim a garment the
    // user no longer has, so they go too. The plans' FK sets outfit_id to null.
    const affected = tx
      .select({ id: outfitCombinations.id, itemIds: outfitCombinations.itemIds })
      .from(outfitCombinations)
      .where(eq(outfitCombinations.userId, userId))
      .all()
      .filter((row) => row.itemIds.includes(itemId));
    for (const row of affected) {
      tx.delete(outfitCombinations)
        .where(and(eq(outfitCombinations.id, row.id), eq(outfitCombinations.userId, userId)))
        .run();
    }
  });
}

/**
 * Wear logging. The counter increments in SQL with the ownership predicate in the
 * same statement, so there is no read-then-write window and no JS-side filtering.
 */
export function logItemWear(userId: string, itemId: string, wornAt?: string): void {
  const when = wornAt ? requireIsoDate(wornAt, 'wornAt') : nowIso().slice(0, 10);
  const result = db
    .update(wardrobeItems)
    .set({ timesWorn: sql`${wardrobeItems.timesWorn} + 1`, lastWornAt: when })
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)))
    .run();
  if (result.changes === 0) throw new NotFoundError('That wardrobe item does not exist.');
}

export function setItemCareFlag(userId: string, itemId: string, needsCare: boolean): void {
  const result = db
    .update(wardrobeItems)
    .set({ needsCare })
    .where(and(eq(wardrobeItems.id, itemId), eq(wardrobeItems.userId, userId)))
    .run();
  if (result.changes === 0) throw new NotFoundError('That wardrobe item does not exist.');
}

/* ----------------------------------------------------------------- outfits */

export type OutfitRow = typeof outfitCombinations.$inferSelect;

export interface OutfitView extends OutfitRow {
  items: { id: string; name: string; category: string; colors: string[] }[];
  /** Item ids on the combination that no longer resolve to a live item. */
  missingItemIds: string[];
}

/** Verifies in SQL that every id belongs to this user. Returns the live rows. */
function ownedItems(userId: string, itemIds: string[]): WardrobeItemRow[] {
  const unique = [...new Set(itemIds)];
  if (unique.length === 0) return [];
  return db
    .select()
    .from(wardrobeItems)
    .where(and(eq(wardrobeItems.userId, userId), inArray(wardrobeItems.id, unique)))
    .all();
}

export function listOutfits(userId: string): OutfitView[] {
  const rows = db
    .select()
    .from(outfitCombinations)
    .where(eq(outfitCombinations.userId, userId))
    .orderBy(desc(outfitCombinations.createdAt))
    .all();
  if (rows.length === 0) return [];
  const needed = [...new Set(rows.flatMap((r) => r.itemIds))];
  const items = ownedItems(userId, needed);
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.map((row) => hydrateOutfit(row, byId));
}

function hydrateOutfit(row: OutfitRow, byId: Map<string, WardrobeItemRow>): OutfitView {
  const resolved = row.itemIds.map((id) => byId.get(id));
  return {
    ...row,
    items: resolved
      .filter((item): item is WardrobeItemRow => item !== undefined)
      .map((item) => ({ id: item.id, name: item.name, category: item.category, colors: item.colors })),
    missingItemIds: row.itemIds.filter((id) => !byId.has(id)),
  };
}

export function getOutfit(userId: string, outfitId: string): OutfitView {
  const row = db
    .select()
    .from(outfitCombinations)
    .where(and(eq(outfitCombinations.id, outfitId), eq(outfitCombinations.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That outfit does not exist.');
  const items = ownedItems(userId, row.itemIds);
  return hydrateOutfit(row, new Map(items.map((i) => [i.id, i])));
}

export interface SaveOutfitInput {
  name: string;
  itemIds: string[];
  occasion?: string;
  source?: 'manual' | 'suggested';
  /** The engine's own explanation, or the user's words. Never invented here. */
  rationale?: string;
  notes?: string;
}

export function saveOutfit(userId: string, input: SaveOutfitInput): string {
  const name = requireName(input.name, 'name');
  const ids = [...new Set(input.itemIds.filter((id) => id.trim().length > 0))];
  if (ids.length < 2) throw new ValidationError('An outfit needs at least two items.', 'itemIds');
  const owned = ownedItems(userId, ids);
  if (owned.length !== ids.length) {
    throw new NotFoundError('One of those items is not in your wardrobe.');
  }
  const id = newId();
  db.insert(outfitCombinations)
    .values({
      id,
      userId,
      name,
      itemIds: ids,
      occasion: input.occasion ? normaliseOccasion(input.occasion) : 'casual',
      source: input.source ?? 'manual',
      rationale: (input.rationale ?? '').slice(0, 1000),
      notes: (input.notes ?? '').slice(0, MAX_NOTES),
    })
    .run();
  return id;
}

export function renameOutfit(userId: string, outfitId: string, name: string): void {
  const result = db
    .update(outfitCombinations)
    .set({ name: requireName(name, 'name') })
    .where(and(eq(outfitCombinations.id, outfitId), eq(outfitCombinations.userId, userId)))
    .run();
  if (result.changes === 0) throw new NotFoundError('That outfit does not exist.');
}

export function setOutfitFavourite(userId: string, outfitId: string, favourite: boolean): void {
  const result = db
    .update(outfitCombinations)
    .set({ favourite })
    .where(and(eq(outfitCombinations.id, outfitId), eq(outfitCombinations.userId, userId)))
    .run();
  if (result.changes === 0) throw new NotFoundError('That outfit does not exist.');
}

export function deleteOutfit(userId: string, outfitId: string): void {
  const result = db
    .delete(outfitCombinations)
    .where(and(eq(outfitCombinations.id, outfitId), eq(outfitCombinations.userId, userId)))
    .run();
  if (result.changes === 0) throw new NotFoundError('That outfit does not exist.');
}

/** Logs the outfit as worn, and every item in it, in one transaction. */
export function logOutfitWear(userId: string, outfitId: string, wornAt?: string): void {
  const outfit = getOutfit(userId, outfitId);
  const when = wornAt ? requireIsoDate(wornAt, 'wornAt') : nowIso().slice(0, 10);
  db.transaction((tx) => {
    tx.update(outfitCombinations)
      .set({ timesWorn: sql`${outfitCombinations.timesWorn} + 1`, lastWornAt: when })
      .where(and(eq(outfitCombinations.id, outfitId), eq(outfitCombinations.userId, userId)))
      .run();
    for (const item of outfit.items) {
      tx.update(wardrobeItems)
        .set({ timesWorn: sql`${wardrobeItems.timesWorn} + 1`, lastWornAt: when })
        .where(and(eq(wardrobeItems.id, item.id), eq(wardrobeItems.userId, userId)))
        .run();
    }
  });
}

/* ------------------------------------------------------------------- plans */

export type OutfitPlanRow = typeof outfitPlans.$inferSelect;

export interface OutfitPlanView extends OutfitPlanRow {
  outfitName: string | null;
  itemNames: string[];
}

export function listOutfitPlans(userId: string, from: string, to: string): OutfitPlanView[] {
  const start = requireIsoDate(from, 'from');
  const end = requireIsoDate(to, 'to');
  const rows = db
    .select()
    .from(outfitPlans)
    .where(
      and(
        eq(outfitPlans.userId, userId),
        sql`${outfitPlans.date} >= ${start}`,
        sql`${outfitPlans.date} <= ${end}`,
      ),
    )
    .orderBy(outfitPlans.date)
    .all();
  if (rows.length === 0) return [];

  const outfitIds = [...new Set(rows.map((r) => r.outfitId).filter((id): id is string => Boolean(id)))];
  const outfits =
    outfitIds.length === 0
      ? []
      : db
          .select({
            id: outfitCombinations.id,
            name: outfitCombinations.name,
            itemIds: outfitCombinations.itemIds,
          })
          .from(outfitCombinations)
          .where(
            and(eq(outfitCombinations.userId, userId), inArray(outfitCombinations.id, outfitIds)),
          )
          .all();
  const itemRows = ownedItems(userId, outfits.flatMap((o) => o.itemIds));
  const itemNames = new Map(itemRows.map((i) => [i.id, i.name]));
  const byOutfit = new Map(outfits.map((o) => [o.id, o]));

  return rows.map((row) => {
    const outfit = row.outfitId ? byOutfit.get(row.outfitId) : undefined;
    return {
      ...row,
      outfitName: outfit?.name ?? null,
      itemNames: (outfit?.itemIds ?? [])
        .map((id) => itemNames.get(id))
        .filter((name): name is string => name !== undefined),
    };
  });
}

export interface SetOutfitPlanInput {
  date: string;
  occasion?: string;
  /** An existing saved outfit… */
  outfitId?: string | null;
  /** …or an ad-hoc set of items, which is saved as a combination first. */
  itemIds?: string[];
  note?: string;
}

/**
 * Assigns an outfit to a date. One plan per (date, occasion) — assigning again
 * replaces it, which is what the unique index enforces.
 */
export function setOutfitPlan(userId: string, input: SetOutfitPlanInput): string {
  const date = requireIsoDate(input.date);
  const occasion: Occasion = input.occasion ? normaliseOccasion(input.occasion) : 'casual';

  let outfitId: string | null = null;
  if (input.outfitId) {
    getOutfit(userId, input.outfitId); // ownership check
    outfitId = input.outfitId;
  } else if (input.itemIds && input.itemIds.length > 0) {
    outfitId = saveOutfit(userId, {
      name: `${occasion} outfit for ${date}`,
      itemIds: input.itemIds,
      occasion,
      source: 'manual',
      notes: 'Built while planning the week.',
    });
  }

  const id = newId();
  const note = (input.note ?? '').slice(0, MAX_NOTES);
  db.insert(outfitPlans)
    .values({ id, userId, date, occasion, outfitId, status: 'planned', note })
    .onConflictDoUpdate({
      target: [outfitPlans.userId, outfitPlans.date, outfitPlans.occasion],
      set: { outfitId, note, status: 'planned' },
    })
    .run();

  const saved = db
    .select({ id: outfitPlans.id })
    .from(outfitPlans)
    .where(
      and(
        eq(outfitPlans.userId, userId),
        eq(outfitPlans.date, date),
        eq(outfitPlans.occasion, occasion),
      ),
    )
    .get();
  return saved?.id ?? id;
}

/** Marking a plan 'worn' also logs the wear, so the counts cannot drift apart. */
export function setOutfitPlanStatus(
  userId: string,
  planId: string,
  status: 'planned' | 'worn' | 'skipped',
): void {
  const plan = db
    .select()
    .from(outfitPlans)
    .where(and(eq(outfitPlans.id, planId), eq(outfitPlans.userId, userId)))
    .get();
  if (!plan) throw new NotFoundError('That plan does not exist.');

  db.update(outfitPlans)
    .set({ status })
    .where(and(eq(outfitPlans.id, planId), eq(outfitPlans.userId, userId)))
    .run();

  if (status === 'worn' && plan.outfitId && plan.status !== 'worn') {
    logOutfitWear(userId, plan.outfitId, plan.date);
  }
}

export function deleteOutfitPlan(userId: string, planId: string): void {
  const result = db
    .delete(outfitPlans)
    .where(and(eq(outfitPlans.id, planId), eq(outfitPlans.userId, userId)))
    .run();
  if (result.changes === 0) throw new NotFoundError('That plan does not exist.');
}

/* ---------------------------------------------------------------- engine IO */

function toEngineItem(row: WardrobeItemRow): OutfitItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    colours: row.colors,
    formality: row.formality,
    warmth: row.warmth,
    occasionTags: row.occasionTags,
    seasonTags: row.seasonTags,
    favourite: row.favourite,
    needsCare: row.needsCare,
  };
}

export interface SuggestionRequest {
  occasion?: string;
  weather?: string;
  excludeItemIds?: string[];
  limit?: number;
}

/**
 * Suggestions for this user's own wardrobe. The engine does the thinking; this
 * function only loads the user's rows and hands them over.
 */
export function suggestOutfitsFor(
  userId: string,
  request: SuggestionRequest = {},
): { occasion: Occasion; weather: WeatherBand; suggestions: OutfitSuggestion[] } {
  const occasion = normaliseOccasion(request.occasion ?? 'casual');
  const weather = normaliseWeather(request.weather ?? 'mild');
  const rows = db
    .select()
    .from(wardrobeItems)
    .where(and(eq(wardrobeItems.userId, userId), eq(wardrobeItems.archived, false)))
    .all();
  const suggestions = suggestOutfits(rows.map(toEngineItem), {
    occasion,
    weather,
    excludeItemIds: request.excludeItemIds ?? [],
    limit: request.limit ?? 4,
    // Seeded by the user and the context, so the same wardrobe gives the same
    // order every time the page is rendered.
    seed: `${userId}:${occasion}:${weather}`,
  });
  return { occasion, weather, suggestions };
}

export function wardrobeGaps(userId: string): WardrobeGap[] {
  const rows = db
    .select()
    .from(wardrobeItems)
    .where(and(eq(wardrobeItems.userId, userId), eq(wardrobeItems.archived, false)))
    .all();
  return outfitGaps(rows.map(toEngineItem));
}

export interface WardrobeStats {
  total: number;
  archived: number;
  needingCare: number;
  neverWorn: number;
  categories: { category: string; count: number }[];
}

export function wardrobeStats(userId: string): WardrobeStats {
  const rows = db
    .select({
      category: wardrobeItems.category,
      archived: wardrobeItems.archived,
      needsCare: wardrobeItems.needsCare,
      timesWorn: wardrobeItems.timesWorn,
    })
    .from(wardrobeItems)
    .where(eq(wardrobeItems.userId, userId))
    .all();
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.archived) continue;
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
  }
  return {
    total: rows.filter((r) => !r.archived).length,
    archived: rows.filter((r) => r.archived).length,
    needingCare: rows.filter((r) => !r.archived && r.needsCare).length,
    neverWorn: rows.filter((r) => !r.archived && r.timesWorn === 0).length,
    categories: [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
  };
}
