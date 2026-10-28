'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import {
  createWardrobeItem,
  updateWardrobeItem,
  archiveWardrobeItem,
  deleteWardrobeItem,
  logItemWear,
  setItemCareFlag,
  saveOutfit,
  deleteOutfit,
  setOutfitFavourite,
  logOutfitWear,
  setOutfitPlan,
  setOutfitPlanStatus,
  deleteOutfitPlan,
  type WardrobeItemInput,
} from '@/lib/services/wardrobe';

export interface ActionState {
  error?: string;
  success?: string;
}

/** Wraps an action so a thrown service error becomes a readable message. */
async function run(fn: () => void | Promise<void>, success: string): Promise<ActionState> {
  try {
    await fn();
    return { success };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Something went wrong.' };
  }
}

function revalidateWardrobe(): void {
  revalidatePath('/wardrobe');
  revalidatePath('/wardrobe/outfits');
  revalidatePath('/wardrobe/planner');
}

function text(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

function list(data: FormData, key: string): string[] {
  return text(data, key)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function multi(data: FormData, key: string): string[] {
  return data
    .getAll(key)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function scale(data: FormData, key: string, fallback: number): number {
  const parsed = Number(text(data, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(data: FormData, key: string): boolean {
  const value = text(data, key);
  return value === 'on' || value === 'true' || value === '1';
}

/*
 * Partial-edit readers. A field the form did not send reads as undefined, which
 * the service leaves untouched — as opposed to the empty string a plain read
 * returns, which would overwrite the stored value with nothing.
 */

function optionalText(data: FormData, key: string): string | undefined {
  const value = data.get(key);
  return typeof value === 'string' ? value : undefined;
}

function optionalList(data: FormData, key: string): string[] | undefined {
  const raw = optionalText(data, key);
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function optionalScale(data: FormData, key: string): number | undefined {
  const raw = optionalText(data, key);
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A checkbox group sends nothing when every box is cleared, which is
 * indistinguishable from a form that had no such group. The form therefore
 * sends `<key>Present`, so an empty group can mean "cleared" rather than
 * "untouched".
 */
function optionalMulti(data: FormData, key: string): string[] | undefined {
  if (data.get(`${key}Present`) === null) return undefined;
  return multi(data, key);
}

/* ------------------------------------------------------------------- items */

export async function createWardrobeItemAction(
  _prev: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () =>
      void createWardrobeItem(user.id, user.plan, {
        name: text(data, 'name'),
        category: text(data, 'category'),
        colors: list(data, 'colours'),
        fabric: text(data, 'fabric'),
        sizeLabel: text(data, 'sizeLabel'),
        occasionTags: multi(data, 'occasionTags'),
        seasonTags: multi(data, 'seasonTags'),
        formality: scale(data, 'formality', 2),
        warmth: scale(data, 'warmth', 2),
        favourite: flag(data, 'favourite'),
        notes: text(data, 'notes'),
        assetId: text(data, 'assetId') || null,
      }),
    'Added to your wardrobe.',
  );
  revalidateWardrobe();
  return result;
}

/**
 * Edits one wardrobe item. Only the fields the form actually submitted are
 * patched, so a form that carries three inputs changes three columns and leaves
 * the rest of the row exactly as it was.
 */
export async function updateWardrobeItemAction(
  _prev: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const itemId = text(data, 'itemId');
  const patch: Partial<WardrobeItemInput> = {};
  const name = optionalText(data, 'name');
  if (name !== undefined) patch.name = name;
  const category = optionalText(data, 'category');
  if (category !== undefined) patch.category = category;
  const colors = optionalList(data, 'colours');
  if (colors !== undefined) patch.colors = colors;
  const fabric = optionalText(data, 'fabric');
  if (fabric !== undefined) patch.fabric = fabric;
  const sizeLabel = optionalText(data, 'sizeLabel');
  if (sizeLabel !== undefined) patch.sizeLabel = sizeLabel;
  const occasionTags = optionalMulti(data, 'occasionTags');
  if (occasionTags !== undefined) patch.occasionTags = occasionTags;
  const seasonTags = optionalMulti(data, 'seasonTags');
  if (seasonTags !== undefined) patch.seasonTags = seasonTags;
  const formality = optionalScale(data, 'formality');
  if (formality !== undefined) patch.formality = formality;
  const warmth = optionalScale(data, 'warmth');
  if (warmth !== undefined) patch.warmth = warmth;
  const notes = optionalText(data, 'notes');
  if (notes !== undefined) patch.notes = notes;

  const result = await run(() => updateWardrobeItem(user.id, itemId, patch), 'Item updated.');
  revalidateWardrobe();
  return result;
}

export async function logItemWearAction(itemId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => logItemWear(user.id, itemId), 'Logged as worn today.');
  revalidateWardrobe();
  return result;
}

export async function setItemCareFlagAction(
  itemId: string,
  needsCare: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => setItemCareFlag(user.id, itemId, needsCare),
    needsCare ? 'Marked as needing a wash or a repair.' : 'Marked as ready to wear.',
  );
  revalidateWardrobe();
  return result;
}

export async function archiveWardrobeItemAction(
  itemId: string,
  archived: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => archiveWardrobeItem(user.id, itemId, archived),
    archived ? 'Moved out of your active wardrobe.' : 'Back in your active wardrobe.',
  );
  revalidateWardrobe();
  return result;
}

export async function deleteWardrobeItemAction(itemId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => deleteWardrobeItem(user.id, itemId),
    'Item deleted, along with any saved outfit that used it.',
  );
  revalidateWardrobe();
  return result;
}

/* ----------------------------------------------------------------- outfits */

export async function saveOutfitAction(_prev: ActionState, data: FormData): Promise<ActionState> {
  const user = await requireUser();
  const itemIds = multi(data, 'itemIds').flatMap((value) => value.split(',').map((v) => v.trim()));
  const result = await run(
    () =>
      void saveOutfit(user.id, {
        name: text(data, 'name'),
        itemIds: itemIds.filter((id) => id.length > 0),
        occasion: text(data, 'occasion'),
        source: text(data, 'source') === 'suggested' ? 'suggested' : 'manual',
        // Saved verbatim from the engine's own explanation; nothing is invented here.
        rationale: text(data, 'rationale'),
        notes: text(data, 'notes'),
      }),
    'Outfit saved.',
  );
  revalidateWardrobe();
  return result;
}

export async function setOutfitFavouriteAction(
  outfitId: string,
  favourite: boolean,
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => setOutfitFavourite(user.id, outfitId, favourite),
    favourite ? 'Added to your favourites.' : 'Removed from your favourites.',
  );
  revalidateWardrobe();
  return result;
}

export async function logOutfitWearAction(outfitId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => logOutfitWear(user.id, outfitId),
    'Logged as worn — every item in it counted too.',
  );
  revalidateWardrobe();
  return result;
}

export async function deleteOutfitAction(outfitId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteOutfit(user.id, outfitId), 'Outfit deleted.');
  revalidateWardrobe();
  return result;
}

/* ------------------------------------------------------------------- plans */

export async function setOutfitPlanAction(
  _prev: ActionState,
  data: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const outfitId = text(data, 'outfitId');
  const itemIds = multi(data, 'itemIds');
  const result = await run(
    () =>
      void setOutfitPlan(user.id, {
        date: text(data, 'date'),
        occasion: text(data, 'occasion'),
        outfitId: outfitId || null,
        itemIds: outfitId ? [] : itemIds,
        note: text(data, 'note'),
      }),
    'Added to your week.',
  );
  revalidateWardrobe();
  return result;
}

export async function setOutfitPlanStatusAction(
  planId: string,
  status: 'planned' | 'worn' | 'skipped',
): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(
    () => setOutfitPlanStatus(user.id, planId, status),
    status === 'worn' ? 'Marked as worn.' : status === 'skipped' ? 'Marked as not worn.' : 'Back to planned.',
  );
  revalidateWardrobe();
  return result;
}

export async function deleteOutfitPlanAction(planId: string): Promise<ActionState> {
  const user = await requireUser();
  const result = await run(() => deleteOutfitPlan(user.id, planId), 'Removed from your week.');
  revalidateWardrobe();
  return result;
}
