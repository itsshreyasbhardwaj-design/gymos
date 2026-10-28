import 'server-only';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { skincareProducts, skincareJournal, patchTests } from '@/lib/db/schema';
import { newId } from '@/lib/auth/ids';
import { ownsMedia } from './media';
import { NotFoundError } from './equipment';
import { ValidationError } from './account';
import {
  productExpiryState,
  patchTestVerdict,
  parseObservedOutcome,
  type ExpiryVerdict,
  type ObservedOutcome,
  type PatchTestVerdict,
} from '@/lib/engines/care';

/**
 * Product inventory, the skincare journal and patch tests.
 *
 * Deliberate absences, because the product would be worse with them:
 *  - nothing here scores skin, rates appearance or compares a person to an ideal.
 *    The journal holds a comfort number the USER chose and concerns the USER typed.
 *  - no photograph is interpreted. GymOS does not run a model over an image, so it
 *    never claims to have "analysed" one.
 *  - a patch test records what the user observed. It is not a diagnosis and the
 *    engine cannot return a clearance.
 */

const MAX_NAME = 120;
const MAX_NOTES = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Shelf categories — where a thing lives in the bathroom, not a clinical class. */
export const PRODUCT_CATEGORIES = [
  'cleanser',
  'moisturiser',
  'sunscreen',
  'serum',
  'exfoliant',
  'mask',
  'shaving',
  'hair',
  'body',
  'fragrance',
  'other',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Patch-test observation windows the UI offers. 24 hours is the shortest allowed. */
export const PATCH_TEST_WINDOW_HOURS = [24, 48, 72, 96] as const;
export const DEFAULT_PATCH_TEST_WINDOW_HOURS = 48;

function assertIsoDate(value: string, field: string): string {
  const date = value.slice(0, 10);
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new ValidationError(`${field} must be a date in YYYY-MM-DD form.`, field);
  }
  return date;
}

function optionalIsoDate(value: string | null | undefined, field: string): string | null {
  if (value == null || value === '') return null;
  return assertIsoDate(value, field);
}

/**
 * Trims, truncates and de-duplicates a list of strings the user typed.
 *
 * De-duplication is case-insensitive, and happens AFTER truncation, because every
 * consumer of these lists compares them case-insensitively: a row that kept both
 * "Glycerin" and "glycerin" would make one product look like two to
 * `duplicateIngredients`. The first spelling the user typed is the one kept, so the
 * UI still shows their own words back to them.
 */
function cleanStringList(values: string[] | undefined, max = 20): string[] {
  if (!values) return [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    const trimmed = value.trim().slice(0, 80);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(trimmed);
    if (kept.length >= max) break;
  }
  return kept;
}

/* ----------------------------------------------------------------- products */

export interface ProductInput {
  name: string;
  brand?: string;
  category?: string;
  /** Ingredients the user typed in. Stored verbatim, compared as plain strings. */
  keyIngredients?: string[];
  openedAt?: string | null;
  expiresAt?: string | null;
  /** The period-after-opening figure printed on the packaging, in months. */
  paoMonths?: number | null;
  /** Integer paise. Never a float. */
  pricePaise?: number | null;
  runningLow?: boolean;
  notes?: string;
}

export interface ProductView {
  id: string;
  name: string;
  brand: string;
  category: string;
  keyIngredients: string[];
  openedAt: string | null;
  expiresAt: string | null;
  paoMonths: number | null;
  pricePaise: number | null;
  runningLow: boolean;
  archived: boolean;
  notes: string;
  createdAt: string;
}

/** Ownership is checked in SQL on every read, not in application code afterwards. */
export function getProduct(userId: string, productId: string): ProductView {
  const row = db
    .select()
    .from(skincareProducts)
    .where(and(eq(skincareProducts.id, productId), eq(skincareProducts.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That product does not exist.');
  return row;
}

export function listProducts(
  userId: string,
  opts: { includeArchived?: boolean } = {},
): ProductView[] {
  const clauses = [eq(skincareProducts.userId, userId)];
  if (!opts.includeArchived) clauses.push(eq(skincareProducts.archived, false));
  return db
    .select()
    .from(skincareProducts)
    .where(and(...clauses))
    .orderBy(asc(skincareProducts.name))
    .all();
}

function normalisePrice(pricePaise: number | null | undefined): number | null {
  if (pricePaise == null) return null;
  if (!Number.isFinite(pricePaise) || pricePaise < 0) {
    throw new ValidationError('A price cannot be negative.', 'pricePaise');
  }
  // Money is stored as whole paise. Rounding here keeps a stray float out of the row.
  return Math.round(pricePaise);
}

function normalisePao(paoMonths: number | null | undefined): number | null {
  if (paoMonths == null) return null;
  if (!Number.isFinite(paoMonths) || paoMonths <= 0) {
    throw new ValidationError(
      'Period-after-opening is a whole number of months, as printed on the packaging.',
      'paoMonths',
    );
  }
  return Math.floor(paoMonths);
}

export function createProduct(userId: string, input: ProductInput): string {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Give the product a name.', 'name');
  const id = newId();
  db.insert(skincareProducts)
    .values({
      id,
      userId,
      name: name.slice(0, MAX_NAME),
      brand: (input.brand ?? '').trim().slice(0, MAX_NAME),
      category: (input.category ?? 'other').slice(0, 40),
      keyIngredients: cleanStringList(input.keyIngredients),
      openedAt: optionalIsoDate(input.openedAt, 'openedAt'),
      expiresAt: optionalIsoDate(input.expiresAt, 'expiresAt'),
      paoMonths: normalisePao(input.paoMonths),
      pricePaise: normalisePrice(input.pricePaise),
      runningLow: input.runningLow ?? false,
      notes: (input.notes ?? '').slice(0, MAX_NOTES),
    })
    .run();
  return id;
}

export function updateProduct(
  userId: string,
  productId: string,
  input: Partial<ProductInput> & { archived?: boolean },
): void {
  const existing = db
    .select({ id: skincareProducts.id })
    .from(skincareProducts)
    .where(and(eq(skincareProducts.id, productId), eq(skincareProducts.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That product does not exist.');

  const patch: Partial<typeof skincareProducts.$inferInsert> = {};
  if (input.name != null) {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Give the product a name.', 'name');
    patch.name = name.slice(0, MAX_NAME);
  }
  if (input.brand != null) patch.brand = input.brand.trim().slice(0, MAX_NAME);
  if (input.category != null) patch.category = input.category.slice(0, 40);
  if (input.keyIngredients != null) patch.keyIngredients = cleanStringList(input.keyIngredients);
  if (input.openedAt !== undefined) patch.openedAt = optionalIsoDate(input.openedAt, 'openedAt');
  if (input.expiresAt !== undefined) patch.expiresAt = optionalIsoDate(input.expiresAt, 'expiresAt');
  if (input.paoMonths !== undefined) patch.paoMonths = normalisePao(input.paoMonths);
  if (input.pricePaise !== undefined) patch.pricePaise = normalisePrice(input.pricePaise);
  if (input.runningLow != null) patch.runningLow = input.runningLow;
  if (input.archived != null) patch.archived = input.archived;
  if (input.notes != null) patch.notes = input.notes.slice(0, MAX_NOTES);
  if (Object.keys(patch).length === 0) return;

  db.update(skincareProducts)
    .set(patch)
    .where(and(eq(skincareProducts.id, productId), eq(skincareProducts.userId, userId)))
    .run();
}

export function deleteProduct(userId: string, productId: string): void {
  const existing = db
    .select({ id: skincareProducts.id })
    .from(skincareProducts)
    .where(and(eq(skincareProducts.id, productId), eq(skincareProducts.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That product does not exist.');
  db.delete(skincareProducts)
    .where(and(eq(skincareProducts.id, productId), eq(skincareProducts.userId, userId)))
    .run();
}

export interface ProductWithExpiry {
  product: ProductView;
  expiry: ExpiryVerdict;
}

/** Products with the engine's date verdict attached, newest problem first. */
export function productsWithExpiry(userId: string, today: string): ProductWithExpiry[] {
  const date = assertIsoDate(today, 'today');
  const order = { expired: 0, use_soon: 1, unknown: 2, fresh: 3 } as const;
  return listProducts(userId)
    .map((product) => ({ product, expiry: productExpiryState(product, date) }))
    .sort(
      (a, b) =>
        order[a.expiry.state] - order[b.expiry.state] ||
        a.product.name.localeCompare(b.product.name),
    );
}

/** Just the ones that need attention — the grooming hub's "check these" list. */
export function productsNeedingAttention(userId: string, today: string): ProductWithExpiry[] {
  return productsWithExpiry(userId, today).filter(
    (p) => p.expiry.state === 'expired' || p.expiry.state === 'use_soon' || p.product.runningLow,
  );
}

export interface DuplicateIngredientGroup {
  ingredient: string;
  products: { id: string; name: string }[];
}

/**
 * Products that share an ingredient string the user typed.
 *
 * This is string matching on the user's own text and nothing more. It is not an
 * interaction check, not a formulation review and not advice: GymOS has no
 * ingredient database and says so in the UI.
 */
export function duplicateIngredients(userId: string): DuplicateIngredientGroup[] {
  const products = listProducts(userId);
  const byIngredient = new Map<string, { id: string; name: string }[]>();
  for (const product of products) {
    // Rows written before `cleanStringList` de-duplicated case-insensitively can
    // still hold "Glycerin" and "glycerin", and a long ingredient name can repeat
    // once truncated. One product must never be reported as sharing something with
    // itself, so each key counts at most once per product.
    const seenForProduct = new Set<string>();
    for (const raw of product.keyIngredients) {
      const key = raw.trim().toLowerCase();
      if (!key || seenForProduct.has(key)) continue;
      seenForProduct.add(key);
      const list = byIngredient.get(key) ?? [];
      list.push({ id: product.id, name: product.name });
      byIngredient.set(key, list);
    }
  }
  return [...byIngredient.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([ingredient, list]) => ({ ingredient, products: list }))
    .sort((a, b) => b.products.length - a.products.length || a.ingredient.localeCompare(b.ingredient));
}

/* ------------------------------------------------------------------ journal */

export interface JournalInput {
  date: string;
  /** The user's own 1-5 comfort rating. Never computed, never a skin score. */
  comfort?: number | null;
  /** Free text the user chose to record. GymOS infers nothing. */
  concerns?: string[];
  productIdsUsed?: string[];
  note?: string;
  /**
   * A private media asset of this user, which is verified here but NOT stored:
   * `skincare_journal` has no asset column in the schema and this module may not
   * add one. See the module notes in the service report.
   */
  photoAssetId?: string | null;
}

export interface JournalEntryView {
  id: string;
  date: string;
  comfort: number | null;
  concerns: string[];
  productIdsUsed: string[];
  note: string;
  createdAt: string;
}

export function listJournal(
  userId: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): JournalEntryView[] {
  const clauses = [eq(skincareJournal.userId, userId)];
  if (opts.from) clauses.push(gte(skincareJournal.date, assertIsoDate(opts.from, 'from')));
  if (opts.to) clauses.push(lte(skincareJournal.date, assertIsoDate(opts.to, 'to')));
  return db
    .select()
    .from(skincareJournal)
    .where(and(...clauses))
    .orderBy(desc(skincareJournal.date))
    .limit(opts.limit ?? 120)
    .all();
}

export function getJournalEntry(userId: string, entryId: string): JournalEntryView {
  const row = db
    .select()
    .from(skincareJournal)
    .where(and(eq(skincareJournal.id, entryId), eq(skincareJournal.userId, userId)))
    .get();
  if (!row) throw new NotFoundError('That journal entry does not exist.');
  return row;
}

/**
 * One entry per day, upserted on (user_id, date).
 *
 * `photoAssetId` is accepted and its ownership verified through the media service,
 * so a stranger's asset id is rejected rather than silently accepted — but the
 * schema has no column to store it on, so nothing is written and the caller is told.
 */
export function upsertJournalEntry(userId: string, input: JournalInput): string {
  const date = assertIsoDate(input.date, 'date');
  if (input.comfort != null) {
    if (!Number.isInteger(input.comfort) || input.comfort < 1 || input.comfort > 5) {
      throw new ValidationError('Comfort is your own rating from 1 to 5.', 'comfort');
    }
  }
  if (input.photoAssetId) {
    // Verified through the media service, which is the only module allowed to read
    // private_media_assets. A foreign asset id gets the same "does not exist" answer.
    if (!ownsMedia(userId, input.photoAssetId)) {
      throw new NotFoundError('That file does not exist.');
    }
    throw new ValidationError(
      'GymOS cannot attach a photo to a skincare journal entry yet: there is no column for it in the database schema. Use the photo check-in feature, which stores photographs privately, and keep the written entry here.',
      'photoAssetId',
    );
  }

  const productIdsUsed = verifyOwnedProducts(userId, input.productIdsUsed ?? []);
  const concerns = cleanStringList(input.concerns, 12);
  const note = (input.note ?? '').slice(0, MAX_NOTES);
  const comfort = input.comfort ?? null;

  const existing = db
    .select({ id: skincareJournal.id })
    .from(skincareJournal)
    .where(and(eq(skincareJournal.userId, userId), eq(skincareJournal.date, date)))
    .get();

  const id = existing?.id ?? newId();
  db.insert(skincareJournal)
    .values({ id, userId, date, comfort, concerns, productIdsUsed, note })
    .onConflictDoUpdate({
      target: [skincareJournal.userId, skincareJournal.date],
      set: { comfort, concerns, productIdsUsed, note },
    })
    .run();
  return id;
}

export function deleteJournalEntry(userId: string, entryId: string): void {
  const existing = db
    .select({ id: skincareJournal.id })
    .from(skincareJournal)
    .where(and(eq(skincareJournal.id, entryId), eq(skincareJournal.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That journal entry does not exist.');
  db.delete(skincareJournal)
    .where(and(eq(skincareJournal.id, entryId), eq(skincareJournal.userId, userId)))
    .run();
}

/** Keeps a foreign product id out of a journal row's JSON. */
function verifyOwnedProducts(userId: string, ids: string[]): string[] {
  const wanted = [...new Set(ids.filter((id) => id.length > 0))];
  if (wanted.length === 0) return [];
  const rows = db
    .select({ id: skincareProducts.id })
    .from(skincareProducts)
    .where(and(eq(skincareProducts.userId, userId), inArray(skincareProducts.id, wanted)))
    .all();
  const owned = new Set(rows.map((r) => r.id));
  for (const id of wanted) {
    if (!owned.has(id)) throw new NotFoundError('That product does not exist.');
  }
  return wanted;
}

/* -------------------------------------------------------------- patch tests */

export interface PatchTestView {
  id: string;
  productId: string;
  productName: string;
  startedAt: string;
  checkAt: string;
  outcome: 'pending' | ObservedOutcome;
  note: string;
  createdAt: string;
}

export interface PatchTestWithVerdict {
  test: PatchTestView;
  verdict: PatchTestVerdict;
}

/** Joined to the product, both filtered on this user in SQL. */
function selectPatchTests(userId: string) {
  return db
    .select({
      id: patchTests.id,
      productId: patchTests.productId,
      productName: skincareProducts.name,
      startedAt: patchTests.startedAt,
      checkAt: patchTests.checkAt,
      outcome: patchTests.outcome,
      note: patchTests.note,
      createdAt: patchTests.createdAt,
    })
    .from(patchTests)
    .innerJoin(
      skincareProducts,
      and(
        eq(skincareProducts.id, patchTests.productId),
        eq(skincareProducts.userId, userId),
      ),
    );
}

export function listPatchTests(userId: string, today: string): PatchTestWithVerdict[] {
  const rows = selectPatchTests(userId)
    .where(eq(patchTests.userId, userId))
    .orderBy(desc(patchTests.startedAt))
    .limit(100)
    .all();
  return rows.map((test) => ({ test, verdict: patchTestVerdict(test, today) }));
}

export function getPatchTest(userId: string, testId: string, today: string): PatchTestWithVerdict {
  const test = selectPatchTests(userId)
    .where(and(eq(patchTests.id, testId), eq(patchTests.userId, userId)))
    .get();
  if (!test) throw new NotFoundError('That patch test does not exist.');
  return { test, verdict: patchTestVerdict(test, today) };
}

/**
 * Starts a patch test on one of the user's own products.
 *
 * The window cannot be shorter than 24 hours: a shorter window would invite a
 * same-hour "all clear" that means nothing. `checkAt` is computed, not supplied.
 *
 * `startedAt` is bounded at both ends for the same reason. A backdated start would
 * otherwise produce a window that is already closed at the moment the test is
 * created, which makes an immediately storable "no reaction" out of a test nobody
 * ever watched; a future start would park the window outside the test's own life.
 */
export function startPatchTest(
  userId: string,
  input: {
    productId: string;
    startedAt?: string;
    windowHours?: number;
    note?: string;
    /** The clock to judge the window against. Defaults to now; tests pass it in. */
    now?: string;
  },
): string {
  const product = db
    .select({ id: skincareProducts.id })
    .from(skincareProducts)
    .where(and(eq(skincareProducts.id, input.productId), eq(skincareProducts.userId, userId)))
    .get();
  if (!product) throw new NotFoundError('That product does not exist.');

  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  if (Number.isNaN(nowMs)) throw new ValidationError('Invalid date.', 'now');
  const startedAtMs = input.startedAt ? Date.parse(input.startedAt) : nowMs;
  if (Number.isNaN(startedAtMs)) {
    throw new ValidationError('When did you start the patch test?', 'startedAt');
  }
  const hours = input.windowHours ?? DEFAULT_PATCH_TEST_WINDOW_HOURS;
  if (!Number.isFinite(hours) || hours < 24 || hours > 168) {
    throw new ValidationError(
      'A patch-test window runs from 24 hours to 7 days. Anything shorter tells you nothing.',
      'windowHours',
    );
  }
  if (startedAtMs > nowMs) {
    throw new ValidationError(
      'A patch test cannot start in the future. Start it when you put the product on your skin.',
      'startedAt',
    );
  }
  const checkAtMs = startedAtMs + hours * 3_600_000;
  if (checkAtMs <= nowMs) {
    throw new ValidationError(
      'That start time is too far in the past: the observation window would already be closed, so there would be nothing to observe in it. Start a patch test when you apply the product.',
      'startedAt',
    );
  }

  const id = newId();
  db.insert(patchTests)
    .values({
      id,
      userId,
      productId: input.productId,
      startedAt: new Date(startedAtMs).toISOString(),
      checkAt: new Date(checkAtMs).toISOString(),
      outcome: 'pending',
      note: (input.note ?? '').slice(0, MAX_NOTES),
    })
    .run();
  return id;
}

/**
 * Records what the user observed.
 *
 * A reaction is accepted at any point, because stopping early is the safe
 * direction. "No reaction" and "not sure" are refused until the window closes, so
 * the app cannot hold a conclusion that was never actually observed.
 */
export function observePatchTest(
  userId: string,
  testId: string,
  input: { outcome: ObservedOutcome; note?: string; now?: string },
): void {
  const existing = db
    .select({ id: patchTests.id, checkAt: patchTests.checkAt })
    .from(patchTests)
    .where(and(eq(patchTests.id, testId), eq(patchTests.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That patch test does not exist.');

  // The allow-list is checked here too, not only in the action that reads the form.
  // A type cannot stop a value at runtime, and "no reaction" is the one answer that
  // could send someone back to a product that hurt them, so an unrecognised outcome
  // is refused and the row keeps the state the user actually left it in.
  const outcome = parseObservedOutcome(input.outcome);
  if (outcome == null) {
    throw new ValidationError(
      'Choose what you actually saw at the patch site. GymOS will not record "no reaction" for you.',
      'outcome',
    );
  }

  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  if (Number.isNaN(nowMs)) throw new ValidationError('Invalid date.', 'now');
  const checkMs = Date.parse(existing.checkAt);
  const windowClosed = Number.isNaN(checkMs) ? true : nowMs >= checkMs;

  if (outcome !== 'reaction' && !windowClosed) {
    const hours = Math.ceil((checkMs - nowMs) / 3_600_000);
    throw new ValidationError(
      `This test still has about ${hours} hour${hours === 1 ? '' : 's'} to run. You can record a reaction at any time, but "no reaction" can only be recorded once the window has closed.`,
      'outcome',
    );
  }

  db.update(patchTests)
    .set({ outcome, note: (input.note ?? '').slice(0, MAX_NOTES) })
    .where(and(eq(patchTests.id, testId), eq(patchTests.userId, userId)))
    .run();
}

/**
 * Reads a finished test back with the engine's verdict.
 *
 * It finalises nothing on its own: if the user has not recorded what they saw, it
 * says so rather than inventing an outcome.
 */
export function concludePatchTest(
  userId: string,
  testId: string,
  today: string,
): PatchTestWithVerdict {
  const result = getPatchTest(userId, testId, today);
  if (result.test.outcome === 'pending') {
    throw new ValidationError(
      'Record what you saw at the patch site first. GymOS does not look at anything on your behalf.',
      'outcome',
    );
  }
  return result;
}

export function deletePatchTest(userId: string, testId: string): void {
  const existing = db
    .select({ id: patchTests.id })
    .from(patchTests)
    .where(and(eq(patchTests.id, testId), eq(patchTests.userId, userId)))
    .get();
  if (!existing) throw new NotFoundError('That patch test does not exist.');
  db.delete(patchTests)
    .where(and(eq(patchTests.id, testId), eq(patchTests.userId, userId)))
    .run();
}

/** Tests whose window has closed and that are still waiting on the user. */
export function patchTestsAwaitingObservation(userId: string, now: string): PatchTestWithVerdict[] {
  return listPatchTests(userId, now).filter(
    (row) => row.verdict.code === 'awaiting_your_observation',
  );
}
