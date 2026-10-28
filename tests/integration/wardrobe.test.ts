/**
 * Style OS against a real database: ownership isolation on items, outfits and
 * plans, honest wear counts, the wardrobe_items entitlement gate, and the refusal
 * to link a photo that belongs to somebody else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymos-wardrobe-media-'));
process.env.GYMOS_MEDIA_PATH = mediaDir;

let account: typeof import('@/lib/services/account');
let wardrobe: typeof import('@/lib/services/wardrobe');
let media: typeof import('@/lib/services/media');
let equipmentService: typeof import('@/lib/services/equipment');
let entitlementEngine: typeof import('@/lib/engines/entitlements');
let dbClient: typeof import('@/lib/db/client');
let schema: typeof import('@/lib/db/schema');
let drizzle: typeof import('drizzle-orm');

let owner: string;
let other: string;
let freeUser: string;

/** A structurally valid minimal PNG. Enough for the media pipeline to accept it. */
function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function makeUser(email: string, plan: 'free' | 'pro'): Promise<string> {
  const id = await account.registerUser({
    email,
    password: 'wardrobe-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(id, { displayName: email.split('@')[0] ?? email, ageBand: 'adult_18_plus' });
  account.completeOnboarding(id);
  if (plan === 'pro') account.devSetPlan(id, 'pro');
  return id;
}

const shirt = { name: 'Navy linen shirt', category: 'shirt', colors: ['navy'], formality: 3, warmth: 2 };
const chinos = { name: 'Tan chinos', category: 'chinos', colors: ['tan'], formality: 3, warmth: 2 };
const shoes = { name: 'Brown shoes', category: 'shoes', colors: ['brown'], formality: 4, warmth: 2 };

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  wardrobe = await import('@/lib/services/wardrobe');
  media = await import('@/lib/services/media');
  equipmentService = await import('@/lib/services/equipment');
  entitlementEngine = await import('@/lib/engines/entitlements');
  dbClient = await import('@/lib/db/client');
  schema = await import('@/lib/db/schema');
  drizzle = await import('drizzle-orm');

  owner = await makeUser('wardrobe-owner@example.com', 'pro');
  other = await makeUser('wardrobe-other@example.com', 'pro');
  freeUser = await makeUser('wardrobe-free@example.com', 'free');
});

afterAll(() => {
  temp.cleanup();
  try {
    fs.rmSync(mediaDir, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
});

/* ------------------------------------------------------ ownership isolation */

describe('wardrobe items are isolated per user', () => {
  it('refuses every read and write of another account’s item', () => {
    const itemId = wardrobe.createWardrobeItem(owner, 'pro', shirt);

    expect(() => wardrobe.getWardrobeItem(other, itemId)).toThrow(equipmentService.NotFoundError);
    expect(() => wardrobe.updateWardrobeItem(other, itemId, { name: 'Hijacked' })).toThrow(
      equipmentService.NotFoundError,
    );
    expect(() => wardrobe.logItemWear(other, itemId)).toThrow(equipmentService.NotFoundError);
    expect(() => wardrobe.setItemCareFlag(other, itemId, true)).toThrow(
      equipmentService.NotFoundError,
    );
    expect(() => wardrobe.archiveWardrobeItem(other, itemId, true)).toThrow(
      equipmentService.NotFoundError,
    );
    expect(() => wardrobe.deleteWardrobeItem(other, itemId)).toThrow(
      equipmentService.NotFoundError,
    );

    // Nothing above touched the row.
    const row = wardrobe.getWardrobeItem(owner, itemId);
    expect(row.name).toBe(shirt.name);
    expect(row.timesWorn).toBe(0);
    expect(row.needsCare).toBe(false);
    expect(row.archived).toBe(false);

    expect(wardrobe.listWardrobeItems(other).map((i) => i.id)).not.toContain(itemId);
    wardrobe.deleteWardrobeItem(owner, itemId);
  });

  it('keeps suggestions and gaps to the caller’s own wardrobe', () => {
    const ids = [
      wardrobe.createWardrobeItem(owner, 'pro', shirt),
      wardrobe.createWardrobeItem(owner, 'pro', chinos),
      wardrobe.createWardrobeItem(owner, 'pro', shoes),
    ];
    const mine = wardrobe.suggestOutfitsFor(owner, { occasion: 'work', weather: 'mild' });
    expect(mine.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of mine.suggestions) {
      for (const id of suggestion.itemIds) expect(ids).toContain(id);
    }
    // Colour is reported as measured or not reported at all, never filled in.
    for (const suggestion of mine.suggestions) {
      expect(suggestion.colourPairsScored).toBeLessThanOrEqual(suggestion.colourPairsTotal);
      if (suggestion.colourScore === null) {
        expect(suggestion.colourScoreNote).toBeTruthy();
        // No score means no pairing carried one; the count has to agree.
        expect(suggestion.colourPairsScored).toBe(0);
      } else {
        expect(suggestion.colourScoreNote).toBeNull();
        expect(suggestion.colourScore).toBeGreaterThan(0);
        expect(suggestion.colourPairsScored).toBeGreaterThan(0);
      }
    }

    // The other account's wardrobe is empty, so it gets nothing — not the owner's.
    expect(wardrobe.suggestOutfitsFor(other).suggestions).toEqual([]);
    expect(wardrobe.wardrobeGaps(other).length).toBeGreaterThan(0);
    for (const id of ids) wardrobe.deleteWardrobeItem(owner, id);
  });
});

describe('saved outfits are isolated per user', () => {
  it('refuses to build an outfit from another account’s items', () => {
    const a = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const b = wardrobe.createWardrobeItem(owner, 'pro', chinos);
    expect(() =>
      wardrobe.saveOutfit(other, { name: 'Borrowed', itemIds: [a, b] }),
    ).toThrow(equipmentService.NotFoundError);

    // Not even a partial outfit: a mix of own and foreign items is refused too.
    const mine = wardrobe.createWardrobeItem(other, 'pro', shoes);
    expect(() =>
      wardrobe.saveOutfit(other, { name: 'Half borrowed', itemIds: [mine, a] }),
    ).toThrow(equipmentService.NotFoundError);
    expect(wardrobe.listOutfits(other)).toEqual([]);

    wardrobe.deleteWardrobeItem(owner, a);
    wardrobe.deleteWardrobeItem(owner, b);
    wardrobe.deleteWardrobeItem(other, mine);
  });

  it('refuses every read and write of another account’s outfit', () => {
    const a = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const b = wardrobe.createWardrobeItem(owner, 'pro', chinos);
    const outfitId = wardrobe.saveOutfit(owner, { name: 'Work day', itemIds: [a, b], occasion: 'work' });

    expect(() => wardrobe.getOutfit(other, outfitId)).toThrow(equipmentService.NotFoundError);
    expect(() => wardrobe.renameOutfit(other, outfitId, 'Mine now')).toThrow(
      equipmentService.NotFoundError,
    );
    expect(() => wardrobe.setOutfitFavourite(other, outfitId, true)).toThrow(
      equipmentService.NotFoundError,
    );
    expect(() => wardrobe.logOutfitWear(other, outfitId)).toThrow(equipmentService.NotFoundError);
    expect(() => wardrobe.deleteOutfit(other, outfitId)).toThrow(equipmentService.NotFoundError);

    const outfit = wardrobe.getOutfit(owner, outfitId);
    expect(outfit.name).toBe('Work day');
    expect(outfit.timesWorn).toBe(0);
    expect(outfit.favourite).toBe(false);
    expect(wardrobe.listOutfits(other).map((o) => o.id)).not.toContain(outfitId);

    wardrobe.deleteOutfit(owner, outfitId);
    wardrobe.deleteWardrobeItem(owner, a);
    wardrobe.deleteWardrobeItem(owner, b);
  });
});

describe('outfit plans are isolated per user', () => {
  it('refuses to plan with, read or change another account’s plan', () => {
    const a = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const b = wardrobe.createWardrobeItem(owner, 'pro', chinos);
    const outfitId = wardrobe.saveOutfit(owner, { name: 'Monday', itemIds: [a, b] });
    const planId = wardrobe.setOutfitPlan(owner, {
      date: '2026-11-02',
      occasion: 'work',
      outfitId,
    });

    // Someone else cannot attach the owner's outfit to their own week.
    expect(() =>
      wardrobe.setOutfitPlan(other, { date: '2026-11-02', occasion: 'work', outfitId }),
    ).toThrow(equipmentService.NotFoundError);
    expect(() => wardrobe.setOutfitPlanStatus(other, planId, 'worn')).toThrow(
      equipmentService.NotFoundError,
    );
    expect(() => wardrobe.deleteOutfitPlan(other, planId)).toThrow(
      equipmentService.NotFoundError,
    );
    expect(wardrobe.listOutfitPlans(other, '2026-11-01', '2026-11-08')).toEqual([]);

    const plans = wardrobe.listOutfitPlans(owner, '2026-11-01', '2026-11-08');
    expect(plans).toHaveLength(1);
    expect(plans[0]!.status).toBe('planned');
    expect(plans[0]!.outfitName).toBe('Monday');
    expect(plans[0]!.itemNames).toEqual([shirt.name, chinos.name]);

    // One plan per date and occasion: planning again replaces it.
    wardrobe.setOutfitPlan(owner, { date: '2026-11-02', occasion: 'work', outfitId, note: 'swapped' });
    const after = wardrobe.listOutfitPlans(owner, '2026-11-01', '2026-11-08');
    expect(after).toHaveLength(1);
    expect(after[0]!.note).toBe('swapped');

    wardrobe.deleteOutfitPlan(owner, planId);
    wardrobe.deleteOutfit(owner, outfitId);
    wardrobe.deleteWardrobeItem(owner, a);
    wardrobe.deleteWardrobeItem(owner, b);
  });

  it('saves an ad-hoc combination when planning without a saved outfit', () => {
    const a = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const b = wardrobe.createWardrobeItem(owner, 'pro', chinos);
    const planId = wardrobe.setOutfitPlan(owner, {
      date: '2026-11-03',
      occasion: 'casual',
      itemIds: [a, b],
    });
    const plans = wardrobe.listOutfitPlans(owner, '2026-11-03', '2026-11-03');
    expect(plans).toHaveLength(1);
    expect(plans[0]!.outfitName).toContain('2026-11-03');
    expect(wardrobe.listOutfits(owner).some((o) => o.itemIds.length === 2)).toBe(true);

    // And it refuses an ad-hoc combination made of someone else's clothes.
    expect(() =>
      wardrobe.setOutfitPlan(other, { date: '2026-11-03', itemIds: [a, b] }),
    ).toThrow(equipmentService.NotFoundError);

    wardrobe.deleteOutfitPlan(owner, planId);
    for (const outfit of wardrobe.listOutfits(owner)) wardrobe.deleteOutfit(owner, outfit.id);
    wardrobe.deleteWardrobeItem(owner, a);
    wardrobe.deleteWardrobeItem(owner, b);
  });
});

/* ---------------------------------------------------------------- editing */

describe('editing an item', () => {
  it('patches only the fields it is given and leaves the rest of the row alone', () => {
    const id = wardrobe.createWardrobeItem(owner, 'pro', {
      ...shirt,
      colors: ['navy', 'white'],
      fabric: 'linen',
      sizeLabel: 'M',
      occasionTags: ['work'],
      seasonTags: ['summer'],
      notes: 'bought in Jaipur',
    });
    wardrobe.logItemWear(owner, id, '2026-10-22');

    // The edit control sends the fields it carries; everything else must survive.
    wardrobe.updateWardrobeItem(owner, id, { name: 'Navy linen shirt (altered)', formality: 4 });

    const row = wardrobe.getWardrobeItem(owner, id);
    expect(row.name).toBe('Navy linen shirt (altered)');
    expect(row.formality).toBe(4);
    expect(row.category).toBe(shirt.category);
    expect(row.colors).toEqual(['navy', 'white']);
    expect(row.fabric).toBe('linen');
    expect(row.sizeLabel).toBe('M');
    expect(row.occasionTags).toEqual(['work']);
    expect(row.seasonTags).toEqual(['summer']);
    expect(row.notes).toBe('bought in Jaipur');
    expect(row.warmth).toBe(shirt.warmth);
    expect(row.timesWorn).toBe(1);
    expect(row.lastWornAt).toBe('2026-10-22');

    // Clearing a list is a real edit, and is distinct from not sending it.
    wardrobe.updateWardrobeItem(owner, id, { colors: [], occasionTags: [] });
    const cleared = wardrobe.getWardrobeItem(owner, id);
    expect(cleared.colors).toEqual([]);
    expect(cleared.occasionTags).toEqual([]);
    expect(cleared.seasonTags).toEqual(['summer']);
    expect(cleared.notes).toBe('bought in Jaipur');

    // An empty name is refused rather than written over a good one.
    expect(() => wardrobe.updateWardrobeItem(owner, id, { name: '  ' })).toThrow(
      account.ValidationError,
    );
    expect(wardrobe.getWardrobeItem(owner, id).name).toBe('Navy linen shirt (altered)');

    wardrobe.deleteWardrobeItem(owner, id);
  });
});

/* ------------------------------------------------------------ wear logging */

describe('wear logging', () => {
  it('counts an item wear once and records the date', () => {
    const id = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const today = new Date().toISOString().slice(0, 10);

    wardrobe.logItemWear(owner, id);
    let row = wardrobe.getWardrobeItem(owner, id);
    expect(row.timesWorn).toBe(1);
    expect(row.lastWornAt).toBe(today);

    wardrobe.logItemWear(owner, id, '2026-10-20');
    row = wardrobe.getWardrobeItem(owner, id);
    expect(row.timesWorn).toBe(2);
    expect(row.lastWornAt).toBe('2026-10-20');

    expect(() => wardrobe.logItemWear(owner, id, '20-10-2026')).toThrow(account.ValidationError);
    expect(wardrobe.getWardrobeItem(owner, id).timesWorn).toBe(2);

    wardrobe.deleteWardrobeItem(owner, id);
  });

  it('counts an outfit wear against the outfit and every item in it', () => {
    const a = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const b = wardrobe.createWardrobeItem(owner, 'pro', chinos);
    const c = wardrobe.createWardrobeItem(owner, 'pro', shoes);
    const outfitId = wardrobe.saveOutfit(owner, { name: 'Three piece', itemIds: [a, b, c] });

    wardrobe.logOutfitWear(owner, outfitId, '2026-10-21');
    expect(wardrobe.getOutfit(owner, outfitId).timesWorn).toBe(1);
    for (const id of [a, b, c]) {
      const row = wardrobe.getWardrobeItem(owner, id);
      expect(row.timesWorn).toBe(1);
      expect(row.lastWornAt).toBe('2026-10-21');
    }

    // An untouched item of the same user is not incremented.
    const spare = wardrobe.createWardrobeItem(owner, 'pro', { ...shirt, name: 'Spare shirt' });
    expect(wardrobe.getWardrobeItem(owner, spare).timesWorn).toBe(0);

    wardrobe.deleteOutfit(owner, outfitId);
    for (const id of [a, b, c, spare]) wardrobe.deleteWardrobeItem(owner, id);
  });

  it('marking a plan worn logs the wear exactly once', () => {
    const a = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const b = wardrobe.createWardrobeItem(owner, 'pro', chinos);
    const outfitId = wardrobe.saveOutfit(owner, { name: 'Planned day', itemIds: [a, b] });
    const planId = wardrobe.setOutfitPlan(owner, { date: '2026-11-04', outfitId });

    wardrobe.setOutfitPlanStatus(owner, planId, 'worn');
    expect(wardrobe.getOutfit(owner, outfitId).timesWorn).toBe(1);
    expect(wardrobe.getWardrobeItem(owner, a).lastWornAt).toBe('2026-11-04');

    // Re-marking an already-worn plan must not inflate the count.
    wardrobe.setOutfitPlanStatus(owner, planId, 'worn');
    expect(wardrobe.getOutfit(owner, outfitId).timesWorn).toBe(1);

    // Skipping records nothing beyond the status.
    wardrobe.setOutfitPlanStatus(owner, planId, 'skipped');
    expect(wardrobe.getOutfit(owner, outfitId).timesWorn).toBe(1);
    expect(wardrobe.listOutfitPlans(owner, '2026-11-04', '2026-11-04')[0]!.status).toBe('skipped');

    wardrobe.deleteOutfitPlan(owner, planId);
    wardrobe.deleteOutfit(owner, outfitId);
    for (const id of [a, b]) wardrobe.deleteWardrobeItem(owner, id);
  });

  it('deleting an item also deletes the saved outfits that used it', () => {
    const a = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const b = wardrobe.createWardrobeItem(owner, 'pro', chinos);
    const outfitId = wardrobe.saveOutfit(owner, { name: 'Doomed', itemIds: [a, b] });
    wardrobe.deleteWardrobeItem(owner, a);
    expect(() => wardrobe.getOutfit(owner, outfitId)).toThrow(equipmentService.NotFoundError);
    wardrobe.deleteWardrobeItem(owner, b);
  });
});

/* ------------------------------------------------------------- entitlements */

describe('the wardrobe_items entitlement gate', () => {
  it('stops a free account at its limit and counts only live items', () => {
    const limit = entitlementEngine.getEntitlement('free', 'wardrobe_items').limitValue;
    expect(limit).not.toBeNull();
    const created: string[] = [];
    for (let i = 0; i < limit!; i += 1) {
      created.push(
        wardrobe.createWardrobeItem(freeUser, 'free', { ...shirt, name: `Shirt ${i}` }),
      );
    }
    expect(() =>
      wardrobe.createWardrobeItem(freeUser, 'free', { ...shirt, name: 'One too many' }),
    ).toThrow(entitlementEngine.EntitlementError);
    expect(wardrobe.listWardrobeItems(freeUser)).toHaveLength(limit!);

    // Archiving frees an allowance, because the limit counts active items.
    wardrobe.archiveWardrobeItem(freeUser, created[0]!, true);
    const extra = wardrobe.createWardrobeItem(freeUser, 'free', { ...shirt, name: 'Replacement' });
    expect(extra).toBeTruthy();

    // A pro account is not gated by the free limit.
    const proItem = wardrobe.createWardrobeItem(owner, 'pro', { ...shirt, name: 'Pro shirt' });
    expect(proItem).toBeTruthy();
    wardrobe.deleteWardrobeItem(owner, proItem);
  });

  it('validates its inputs instead of writing junk', () => {
    expect(() => wardrobe.createWardrobeItem(owner, 'pro', { ...shirt, name: '   ' })).toThrow(
      account.ValidationError,
    );
    expect(() => wardrobe.createWardrobeItem(owner, 'pro', { ...shirt, category: '' })).toThrow(
      account.ValidationError,
    );
    const id = wardrobe.createWardrobeItem(owner, 'pro', { ...shirt, formality: 99, warmth: -4 });
    const row = wardrobe.getWardrobeItem(owner, id);
    expect(row.formality).toBe(5);
    expect(row.warmth).toBe(1);
    expect(() => wardrobe.saveOutfit(owner, { name: 'Lonely', itemIds: [id] })).toThrow(
      account.ValidationError,
    );
    expect(() => wardrobe.listOutfitPlans(owner, 'yesterday', '2026-11-01')).toThrow(
      account.ValidationError,
    );
    wardrobe.deleteWardrobeItem(owner, id);
  });
});

/* --------------------------------------------------------------- photo links */

describe('photo links go through the media service', () => {
  it('refuses to link a photo that belongs to another account', () => {
    account.setConsent(owner, 'photo_journal', true);
    const asset = media.storeMedia(owner, 'pro', {
      kind: 'photo',
      mimeType: 'image/png',
      bytes: tinyPng(),
      consent: 'photo_journal',
    });

    // The owner may link their own asset.
    const mine = wardrobe.createWardrobeItem(owner, 'pro', { ...shirt, assetId: asset.id });
    expect(wardrobe.getWardrobeItem(owner, mine).assetId).toBe(asset.id);

    // Another account may not, on create or on update.
    expect(() =>
      wardrobe.createWardrobeItem(other, 'pro', { ...shirt, assetId: asset.id }),
    ).toThrow(account.ValidationError);
    expect(wardrobe.listWardrobeItems(other)).toHaveLength(0);

    const theirs = wardrobe.createWardrobeItem(other, 'pro', chinos);
    expect(() => wardrobe.updateWardrobeItem(other, theirs, { assetId: asset.id })).toThrow(
      account.ValidationError,
    );
    expect(wardrobe.getWardrobeItem(other, theirs).assetId).toBeNull();

    // A made-up asset id is refused too.
    expect(() =>
      wardrobe.createWardrobeItem(owner, 'pro', { ...shirt, assetId: 'not-a-real-asset' }),
    ).toThrow(account.ValidationError);

    wardrobe.deleteWardrobeItem(other, theirs);
    wardrobe.deleteWardrobeItem(owner, mine);
    media.deleteMedia(owner, asset.id, 'user_request');
  });

  it('never stores an appearance or body column: the row holds only what was typed', () => {
    const id = wardrobe.createWardrobeItem(owner, 'pro', shirt);
    const row = dbClient.db
      .select()
      .from(schema.wardrobeItems)
      .where(drizzle.eq(schema.wardrobeItems.id, id))
      .get();
    expect(row).toBeDefined();
    const forbidden = /score|rating|attractive|beauty|bodyfat|body_fat|physique|shape|looks/i;
    for (const column of Object.keys(row!)) {
      expect(forbidden.test(column), `column ${column}`).toBe(false);
    }
    wardrobe.deleteWardrobeItem(owner, id);
  });
});

describe('tag limits refuse rather than truncate', () => {
  /**
   * The edit form round-trips the tags an item already has, so a silent `slice` would
   * drop one of them the next time the user ticked a box — losing something they typed,
   * with no error. The limit is now a refusal, and nothing is written.
   */
  it('keeps a list at the limit', () => {
    const tags = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
    const id = wardrobe.createWardrobeItem(owner, 'pro', {
      name: 'Twelve tags',
      category: 'top',
      occasionTags: tags,
    });
    expect(wardrobe.getWardrobeItem(owner, id).occasionTags).toEqual(tags);
  });

  it('refuses one over the limit, and writes nothing', () => {
    const before = wardrobe.listWardrobeItems(owner, { includeArchived: true }).length;
    expect(() =>
      wardrobe.createWardrobeItem(owner, 'pro', {
        name: 'Thirteen tags',
        category: 'top',
        occasionTags: Array.from({ length: 13 }, (_, i) => `tag-${i}`),
      }),
    ).toThrow(/holds up to 12 occasion tags/);
    expect(wardrobe.listWardrobeItems(owner, { includeArchived: true }).length).toBe(before);
  });

  it('refuses an over-long list on an edit without losing the tags already there', () => {
    const original = ['casual', 'work', 'formal'];
    const id = wardrobe.createWardrobeItem(owner, 'pro', {
      name: 'Editable',
      category: 'top',
      occasionTags: original,
    });
    expect(() =>
      wardrobe.updateWardrobeItem(owner, id, {
        occasionTags: Array.from({ length: 13 }, (_, i) => `tag-${i}`),
      }),
    ).toThrow(/nothing was saved/);
    // The refusal must not have been a partial write.
    expect(wardrobe.getWardrobeItem(owner, id).occasionTags).toEqual(original);
  });

  it('still de-duplicates and trims within the limit', () => {
    const id = wardrobe.createWardrobeItem(owner, 'pro', {
      name: 'Messy tags',
      category: 'top',
      seasonTags: ['  summer  ', 'summer', '', '   ', 'winter'],
    });
    expect(wardrobe.getWardrobeItem(owner, id).seasonTags).toEqual(['summer', 'winter']);
  });
});
