/**
 * Grooming and skincare: ownership isolation, log idempotency, entitlement gating.
 *
 * Two accounts are created and every id-taking read and write in both services is
 * called with the other account's id. Ownership is enforced in the SQL predicate, so
 * a foreign id must come back as NotFoundError and must change nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();

/**
 * The grooming action module is exercised for real further down, so the allow-list
 * that stops GymOS answering "no reaction" on a user's behalf is covered where the
 * submitted form value is actually read. Only the two pieces of request context the
 * action needs are stood in for; the services and the database underneath are real.
 */
const acting = vi.hoisted(() => ({ id: '' }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/lib/auth/session', () => ({
  requireUser: async () => ({ id: acting.id, plan: 'pro' }),
}));

let account: typeof import('@/lib/services/account');
let grooming: typeof import('@/lib/services/grooming');
let skincare: typeof import('@/lib/services/skincare');
let equipmentService: typeof import('@/lib/services/equipment');
let entitlements: typeof import('@/lib/engines/entitlements');
let dbClient: typeof import('@/lib/db/client');
let schema: typeof import('@/lib/db/schema');
let groomingActions: typeof import('@/app/(app)/grooming/actions');

interface Fixture {
  userId: string;
  routineId: string;
  stepId: string;
  productId: string;
  patchTestId: string;
  appointmentId: string;
  journalId: string;
}

let alice: Fixture;
let mallory: Fixture;

const TODAY = '2026-10-27';
const NOW = '2026-10-27T09:00:00.000Z';

async function makeUser(email: string, plan: 'free' | 'pro'): Promise<Fixture> {
  const userId = await account.registerUser({
    email,
    password: 'grooming-long-secret',
    acceptTerms: true,
  });
  account.upsertProfile(userId, {
    displayName: email.split('@')[0]!,
    ageBand: 'adult_18_plus',
    experience: 'some',
    trainingDays: [1, 3],
    sessionMinutes: 45,
  });
  account.completeOnboarding(userId);
  account.devSetPlan(userId, plan);

  const productId = skincare.createProduct(userId, {
    name: `${email} cleanser`,
    brand: 'Shelf',
    category: 'cleanser',
    keyIngredients: ['Glycerin', 'Niacinamide'],
    openedAt: '2026-09-01',
    paoMonths: 6,
    pricePaise: 49900,
  });
  const routineId = grooming.createRoutine(userId, plan, {
    name: `${email} morning`,
    slot: 'morning',
    daysOfWeek: [],
    steps: [{ label: 'Cleanse', productId }, { label: 'Moisturise' }],
  });
  const stepId = grooming.getRoutine(userId, routineId).steps[0]!.id;
  const patchTestId = skincare.startPatchTest(userId, {
    productId,
    startedAt: '2026-10-26T09:00:00.000Z',
    windowHours: 48,
    // `now` is supplied so the window is open relative to the suite's clock, not the
    // machine's: a start more than 48 hours before the real now is refused.
    now: NOW,
  });
  const appointmentId = grooming.createAppointment(userId, {
    title: 'Haircut',
    kind: 'haircut',
    scheduledAt: '2026-11-05T10:00:00.000Z',
  });
  const journalId = skincare.upsertJournalEntry(userId, {
    date: TODAY,
    comfort: 4,
    concerns: ['dry patch'],
    productIdsUsed: [productId],
    note: 'Felt fine.',
  });

  return { userId, routineId, stepId, productId, patchTestId, appointmentId, journalId };
}

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
  grooming = await import('@/lib/services/grooming');
  skincare = await import('@/lib/services/skincare');
  equipmentService = await import('@/lib/services/equipment');
  entitlements = await import('@/lib/engines/entitlements');
  dbClient = await import('@/lib/db/client');
  schema = await import('@/lib/db/schema');
  groomingActions = await import('@/app/(app)/grooming/actions');

  alice = await makeUser('alice-care@example.com', 'pro');
  mallory = await makeUser('mallory-care@example.com', 'pro');
  acting.id = alice.userId;
});

afterAll(() => temp.cleanup());

const isNotFound = (fn: () => unknown) => {
  expect(fn).toThrowError(equipmentService.NotFoundError);
};

/* -------------------------------------------------------------- isolation */

describe('ownership isolation — routines', () => {
  it('user B cannot read user A routine', () => {
    isNotFound(() => grooming.getRoutine(mallory.userId, alice.routineId));
    expect(grooming.getRoutine(alice.userId, alice.routineId).id).toBe(alice.routineId);
  });

  it('listRoutines only ever returns the caller rows', () => {
    const mine = grooming.listRoutines(alice.userId, { includeInactive: true });
    expect(mine.map((r) => r.id)).toEqual([alice.routineId]);
    const theirs = grooming.listRoutines(mallory.userId, { includeInactive: true });
    expect(theirs.map((r) => r.id)).toEqual([mallory.routineId]);
  });

  it('user B cannot update, pause or rename user A routine', () => {
    isNotFound(() => grooming.updateRoutine(mallory.userId, alice.routineId, { name: 'pwned' }));
    expect(grooming.getRoutine(alice.userId, alice.routineId).name).toContain('alice-care');
  });

  it('user B cannot delete user A routine', () => {
    isNotFound(() => grooming.deleteRoutine(mallory.userId, alice.routineId));
    expect(grooming.getRoutine(alice.userId, alice.routineId).id).toBe(alice.routineId);
  });

  it('user B cannot add to, reorder or delete user A steps', () => {
    isNotFound(() => grooming.addRoutineStep(mallory.userId, alice.routineId, { label: 'pwned' }));
    isNotFound(() => grooming.moveRoutineStep(mallory.userId, alice.stepId, 'down'));
    isNotFound(() => grooming.deleteRoutineStep(mallory.userId, alice.stepId));
    const steps = grooming.getRoutine(alice.userId, alice.routineId).steps;
    expect(steps.map((s) => s.label)).toEqual(['Cleanse', 'Moisturise']);
    expect(steps.map((s) => s.orderIndex)).toEqual([0, 1]);
  });

  it('a step cannot be linked to another user product', () => {
    isNotFound(() =>
      grooming.addRoutineStep(alice.userId, alice.routineId, {
        label: 'Borrowed serum',
        productId: mallory.productId,
      }),
    );
    isNotFound(() =>
      grooming.createRoutine(alice.userId, 'pro', {
        name: 'With a stolen product',
        slot: 'evening',
        steps: [{ label: 'Serum', productId: mallory.productId }],
      }),
    );
  });
});

describe('ownership isolation — logs', () => {
  it('user B cannot log or unlog user A routine', () => {
    isNotFound(() => grooming.logRoutineDone(mallory.userId, alice.routineId, { date: TODAY }));
    grooming.logRoutineDone(alice.userId, alice.routineId, { date: TODAY });
    grooming.unlogRoutine(mallory.userId, alice.routineId, TODAY);
    expect(grooming.listRoutineLogs(alice.userId, { routineId: alice.routineId })).toHaveLength(1);
    grooming.unlogRoutine(alice.userId, alice.routineId, TODAY);
    expect(grooming.listRoutineLogs(alice.userId, { routineId: alice.routineId })).toHaveLength(0);
  });

  it('listRoutineLogs never returns another user rows', () => {
    grooming.logRoutineDone(mallory.userId, mallory.routineId, { date: TODAY });
    const logs = grooming.listRoutineLogs(alice.userId);
    expect(logs.every((l) => l.routineId === alice.routineId)).toBe(true);
    grooming.unlogRoutine(mallory.userId, mallory.routineId, TODAY);
  });
});

describe('ownership isolation — products, journal, patch tests, appointments', () => {
  it('user B cannot read or write user A product', () => {
    isNotFound(() => skincare.getProduct(mallory.userId, alice.productId));
    isNotFound(() => skincare.updateProduct(mallory.userId, alice.productId, { name: 'pwned' }));
    isNotFound(() => skincare.deleteProduct(mallory.userId, alice.productId));
    expect(skincare.getProduct(alice.userId, alice.productId).name).toContain('alice-care');
  });

  it('a journal entry cannot reference another user product', () => {
    isNotFound(() =>
      skincare.upsertJournalEntry(alice.userId, {
        date: '2026-10-20',
        productIdsUsed: [mallory.productId],
      }),
    );
  });

  it('user B cannot read or delete user A journal entry', () => {
    isNotFound(() => skincare.getJournalEntry(mallory.userId, alice.journalId));
    isNotFound(() => skincare.deleteJournalEntry(mallory.userId, alice.journalId));
    expect(skincare.getJournalEntry(alice.userId, alice.journalId).note).toBe('Felt fine.');
  });

  it('user B cannot read, observe or delete user A patch test', () => {
    isNotFound(() => skincare.getPatchTest(mallory.userId, alice.patchTestId, NOW));
    isNotFound(() =>
      skincare.observePatchTest(mallory.userId, alice.patchTestId, {
        outcome: 'reaction',
        now: '2026-10-29T09:00:00.000Z',
      }),
    );
    isNotFound(() => skincare.deletePatchTest(mallory.userId, alice.patchTestId));
    expect(skincare.getPatchTest(alice.userId, alice.patchTestId, NOW).test.outcome).toBe(
      'pending',
    );
  });

  it('a patch test cannot be started on another user product', () => {
    isNotFound(() => skincare.startPatchTest(alice.userId, { productId: mallory.productId }));
  });

  it('listPatchTests is scoped to the caller', () => {
    const mine = skincare.listPatchTests(alice.userId, NOW);
    expect(mine.map((r) => r.test.id)).toEqual([alice.patchTestId]);
  });

  it('user B cannot read, update or delete user A appointment', () => {
    isNotFound(() => grooming.getAppointment(mallory.userId, alice.appointmentId));
    isNotFound(() =>
      grooming.updateAppointment(mallory.userId, alice.appointmentId, { title: 'pwned' }),
    );
    isNotFound(() => grooming.deleteAppointment(mallory.userId, alice.appointmentId));
    expect(grooming.getAppointment(alice.userId, alice.appointmentId).title).toBe('Haircut');
  });

  it('appointment and product listings are scoped to the caller', () => {
    expect(grooming.listAppointments(alice.userId).map((a) => a.id)).toEqual([
      alice.appointmentId,
    ]);
    expect(skincare.listProducts(mallory.userId).map((p) => p.id)).toEqual([mallory.productId]);
    expect(grooming.upcomingAppointments(alice.userId, TODAY, 45).map((a) => a.id)).toEqual([
      alice.appointmentId,
    ]);
  });
});

/* ------------------------------------------------------------ idempotency */

describe('routine log idempotency', () => {
  it('logging the same routine twice on the same day updates one row', () => {
    const first = grooming.logRoutineDone(alice.userId, alice.routineId, {
      date: '2026-10-22',
      note: 'first',
    });
    const second = grooming.logRoutineDone(alice.userId, alice.routineId, {
      date: '2026-10-22',
      note: 'second',
    });
    expect(second).toBe(first);
    const logs = grooming.listRoutineLogs(alice.userId, {
      routineId: alice.routineId,
      from: '2026-10-22',
      to: '2026-10-22',
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.note).toBe('second');
  });

  it('ten rapid logs still leave exactly one row for that day', () => {
    for (let i = 0; i < 10; i += 1) {
      grooming.logRoutineDone(alice.userId, alice.routineId, { date: '2026-10-23' });
    }
    expect(
      grooming.listRoutineLogs(alice.userId, {
        routineId: alice.routineId,
        from: '2026-10-23',
        to: '2026-10-23',
      }),
    ).toHaveLength(1);
  });

  it('different days are different rows, and the engine sees them as logged', () => {
    const logs = grooming.listRoutineLogs(alice.userId, {
      routineId: alice.routineId,
      from: '2026-10-22',
      to: '2026-10-23',
    });
    expect(logs).toHaveLength(2);
    const due = grooming
      .routinesDue(alice.userId, '2026-10-23')
      .find((row) => row.routine.id === alice.routineId);
    expect(due?.due.doneToday).toBe(true);
    expect(due?.due.due).toBe(false);
  });

  it('only step ids belonging to that routine are stored on a log', () => {
    grooming.logRoutineDone(alice.userId, alice.routineId, {
      date: '2026-10-24',
      completedStepIds: [alice.stepId, mallory.stepId, 'nonsense'],
    });
    const log = grooming.listRoutineLogs(alice.userId, {
      routineId: alice.routineId,
      from: '2026-10-24',
      to: '2026-10-24',
    })[0]!;
    expect(log.completedStepIds).toEqual([alice.stepId]);
  });
});

/* ------------------------------------------------------------- entitlement */

describe('care_routines entitlement gate', () => {
  it('a free account is cut off at its routine limit, and existing routines keep working', async () => {
    const userId = await account.registerUser({
      email: 'freecare@example.com',
      password: 'grooming-long-secret',
      acceptTerms: true,
    });
    account.devSetPlan(userId, 'free');
    const limit = entitlements.getEntitlement('free', 'care_routines').limitValue!;
    expect(limit).toBeGreaterThan(0);

    for (let i = 0; i < limit; i += 1) {
      grooming.createRoutine(userId, 'free', { name: `Routine ${i}`, slot: 'morning' });
    }
    expect(() =>
      grooming.createRoutine(userId, 'free', { name: 'One too many', slot: 'morning' }),
    ).toThrowError(entitlements.EntitlementError);

    // The gate blocks a new routine, it does not break the ones already there.
    const existing = grooming.listRoutines(userId);
    expect(existing).toHaveLength(limit);
    grooming.logRoutineDone(userId, existing[0]!.id, { date: TODAY });
    expect(grooming.listRoutineLogs(userId)).toHaveLength(1);

    // Pausing one frees the allowance, because the limit counts active routines.
    grooming.updateRoutine(userId, existing[0]!.id, { active: false });
    const freed = grooming.createRoutine(userId, 'free', { name: 'Room again', slot: 'evening' });
    expect(freed).toBeTruthy();
  });

  it('a pro account is not limited by that gate', () => {
    for (let i = 0; i < 8; i += 1) {
      grooming.createRoutine(mallory.userId, 'pro', { name: `Pro ${i}`, slot: 'evening' });
    }
    expect(grooming.listRoutines(mallory.userId).length).toBeGreaterThan(8);
  });

  it('appointments, products, journal entries and patch tests are not entitlement-gated', () => {
    // Personal-care record keeping is not a paywall lever; only routine count is capped.
    expect(() =>
      grooming.createAppointment(alice.userId, {
        title: 'Second haircut',
        scheduledAt: '2026-12-01T10:00:00.000Z',
      }),
    ).not.toThrow();
  });
});

/* --------------------------------------------------------------- behaviour */

describe('safety behaviour at the service boundary', () => {
  it('refuses to record "no reaction" before the observation window closes', () => {
    const testId = skincare.startPatchTest(alice.userId, {
      productId: alice.productId,
      startedAt: '2026-10-27T08:00:00.000Z',
      windowHours: 48,
      now: NOW,
    });
    expect(() =>
      skincare.observePatchTest(alice.userId, testId, {
        outcome: 'no_reaction',
        now: '2026-10-27T10:00:00.000Z',
      }),
    ).toThrowError(/window has closed/i);

    // A reaction is always accepted, because stopping early is the safe direction.
    skincare.observePatchTest(alice.userId, testId, {
      outcome: 'reaction',
      now: '2026-10-27T10:00:00.000Z',
    });
    const verdict = skincare.getPatchTest(alice.userId, testId, '2026-10-27T10:00:00.000Z').verdict;
    expect(verdict.code).toBe('reaction_observed');
    expect(verdict.seeProfessional).toBe(true);
    skincare.deletePatchTest(alice.userId, testId);
  });

  it('refuses to conclude a patch test the user has not observed', () => {
    expect(() =>
      skincare.concludePatchTest(alice.userId, alice.patchTestId, '2026-10-29T09:00:00.000Z'),
    ).toThrowError(/record what you saw/i);
  });

  it('refuses a patch-test window shorter than 24 hours', () => {
    expect(() =>
      skincare.startPatchTest(alice.userId, { productId: alice.productId, windowHours: 2 }),
    ).toThrowError(/24 hours/i);
  });

  it('stores money as whole paise', () => {
    const id = skincare.createProduct(alice.userId, { name: 'Priced', pricePaise: 12345.6 });
    expect(skincare.getProduct(alice.userId, id).pricePaise).toBe(12346);
    skincare.deleteProduct(alice.userId, id);
  });

  it('refuses a comfort rating outside the user scale, and never computes one', () => {
    expect(() =>
      skincare.upsertJournalEntry(alice.userId, { date: '2026-10-19', comfort: 9 }),
    ).toThrowError(/1 to 5/);
    const id = skincare.upsertJournalEntry(alice.userId, { date: '2026-10-19' });
    expect(skincare.getJournalEntry(alice.userId, id).comfort).toBeNull();
  });

  it('a journal entry is one row per day, upserted', () => {
    const first = skincare.upsertJournalEntry(alice.userId, { date: '2026-10-18', note: 'a' });
    const second = skincare.upsertJournalEntry(alice.userId, { date: '2026-10-18', note: 'b' });
    expect(second).toBe(first);
    expect(
      skincare.listJournal(alice.userId, { from: '2026-10-18', to: '2026-10-18' }),
    ).toHaveLength(1);
  });

  it('rejects a foreign media asset id rather than linking it', () => {
    expect(() =>
      skincare.upsertJournalEntry(alice.userId, {
        date: '2026-10-17',
        photoAssetId: 'some-other-persons-asset',
      }),
    ).toThrowError(equipmentService.NotFoundError);
  });

  it('the expiry verdict uses the earlier of the two recorded dates', () => {
    const id = skincare.createProduct(alice.userId, {
      name: 'Old jar',
      expiresAt: '2030-01-01',
      openedAt: '2026-01-01',
      paoMonths: 3,
    });
    const row = skincare
      .productsWithExpiry(alice.userId, TODAY)
      .find((p) => p.product.id === id)!;
    expect(row.expiry.state).toBe('expired');
    expect(row.expiry.basis).toBe('period_after_opening');
    skincare.deleteProduct(alice.userId, id);
  });
});

/* ---------------------------------------------------- step order and reorder */

describe('routine steps keep a single, editable order', () => {
  it('a blank row in the form does not leave a gap that a later step collides with', () => {
    // The old code used the FORM index while skipping blanks, so this routine kept
    // indices 0 and 2; addRoutineStep then used count(*) = 2 and produced a second
    // step at index 2, leaving the "ordered list" order up to the database.
    const routineId = grooming.createRoutine(alice.userId, 'pro', {
      name: 'Gapped',
      slot: 'evening',
      steps: [{ label: 'Cleanse' }, { label: '   ' }, { label: 'Moisturise' }],
    });
    const created = grooming.getRoutine(alice.userId, routineId).steps;
    expect(created.map((s) => s.label)).toEqual(['Cleanse', 'Moisturise']);
    expect(created.map((s) => s.orderIndex)).toEqual([0, 1]);

    const addedId = grooming.addRoutineStep(alice.userId, routineId, { label: 'Serum' });
    const after = grooming.getRoutine(alice.userId, routineId).steps;
    expect(after.map((s) => s.label)).toEqual(['Cleanse', 'Moisturise', 'Serum']);
    expect(after.map((s) => s.orderIndex)).toEqual([0, 1, 2]);
    expect(new Set(after.map((s) => s.orderIndex)).size).toBe(after.length);
    expect(after.map((s) => s.id)).toContain(addedId);

    grooming.deleteRoutine(alice.userId, routineId);
  });

  it('deleting a step closes the gap it leaves behind', () => {
    const routineId = grooming.createRoutine(alice.userId, 'pro', {
      name: 'Three steps',
      slot: 'evening',
      steps: [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }],
    });
    const middle = grooming.getRoutine(alice.userId, routineId).steps[1]!;
    grooming.deleteRoutineStep(alice.userId, middle.id);
    const left = grooming.getRoutine(alice.userId, routineId).steps;
    expect(left.map((s) => s.label)).toEqual(['One', 'Three']);
    expect(left.map((s) => s.orderIndex)).toEqual([0, 1]);
    grooming.deleteRoutine(alice.userId, routineId);
  });

  it('a step can be moved up and down, keeping its id and its product link', () => {
    const routineId = grooming.createRoutine(alice.userId, 'pro', {
      name: 'Reorderable',
      slot: 'morning',
      steps: [
        { label: 'Cleanse', productId: alice.productId },
        { label: 'Serum' },
        { label: 'Moisturise' },
      ],
    });
    const before = grooming.getRoutine(alice.userId, routineId).steps;
    const serum = before[1]!;

    grooming.moveRoutineStep(alice.userId, serum.id, 'up');
    const moved = grooming.getRoutine(alice.userId, routineId).steps;
    expect(moved.map((s) => s.label)).toEqual(['Serum', 'Cleanse', 'Moisturise']);
    expect(moved.map((s) => s.orderIndex)).toEqual([0, 1, 2]);
    // Ids survive a reorder, because routine logs reference them.
    expect(moved.map((s) => s.id).sort()).toEqual(before.map((s) => s.id).sort());
    expect(moved.find((s) => s.id === before[0]!.id)!.productId).toBe(alice.productId);

    grooming.moveRoutineStep(alice.userId, serum.id, 'down');
    expect(
      grooming.getRoutine(alice.userId, routineId).steps.map((s) => s.label),
    ).toEqual(['Cleanse', 'Serum', 'Moisturise']);

    // At the ends the press is a no-op rather than an error or a wrap-around.
    grooming.moveRoutineStep(alice.userId, before[0]!.id, 'up');
    grooming.moveRoutineStep(alice.userId, before[2]!.id, 'down');
    expect(
      grooming.getRoutine(alice.userId, routineId).steps.map((s) => s.label),
    ).toEqual(['Cleanse', 'Serum', 'Moisturise']);

    grooming.deleteRoutine(alice.userId, routineId);
  });

  it('a reorder keeps the step ids a log already recorded', () => {
    const routineId = grooming.createRoutine(alice.userId, 'pro', {
      name: 'Logged then reordered',
      slot: 'morning',
      steps: [{ label: 'First' }, { label: 'Second' }],
    });
    const steps = grooming.getRoutine(alice.userId, routineId).steps;
    grooming.logRoutineDone(alice.userId, routineId, {
      date: '2026-10-16',
      completedStepIds: [steps[1]!.id],
    });
    grooming.moveRoutineStep(alice.userId, steps[1]!.id, 'up');
    const log = grooming.listRoutineLogs(alice.userId, {
      routineId,
      from: '2026-10-16',
      to: '2026-10-16',
    })[0]!;
    const stillThere = grooming.getRoutine(alice.userId, routineId).steps.map((s) => s.id);
    expect(log.completedStepIds).toEqual([steps[1]!.id]);
    expect(stillThere).toContain(log.completedStepIds[0]);
    grooming.deleteRoutine(alice.userId, routineId);
  });
});

/* ------------------------------------------------- shelf and patch-test reads */

describe('duplicateIngredients', () => {
  it('groups two products that share an ingredient, whatever case it was typed in', () => {
    // Ingredient names nothing else on the shelf uses, so the group is exactly these.
    const a = skincare.createProduct(alice.userId, {
      name: 'Serum A',
      keyIngredients: ['Shareate', 'Soloate'],
    });
    const b = skincare.createProduct(alice.userId, {
      name: 'Serum B',
      keyIngredients: ['SHAREATE'],
    });
    const groups = skincare.duplicateIngredients(alice.userId);
    const shared = groups.find((g) => g.ingredient === 'shareate');
    expect(shared).toBeDefined();
    expect(shared!.products.map((p) => p.name).sort()).toEqual(['Serum A', 'Serum B']);
    expect(shared!.products.map((p) => p.id).sort()).toEqual([a, b].sort());
    // 'Soloate' is in one product only, so it is not a shared ingredient.
    expect(groups.some((g) => g.ingredient === 'soloate')).toBe(false);

    skincare.deleteProduct(alice.userId, a);
    skincare.deleteProduct(alice.userId, b);
  });

  it('never reports a single product as sharing an ingredient with itself', () => {
    // The regression: the stored list de-duplicated case-SENSITIVELY while the
    // grouping keyed case-INsensitively, so one product was listed two or three
    // times under its own ingredient.
    const id = skincare.createProduct(alice.userId, {
      name: 'Case jumble',
      keyIngredients: ['Loneate', 'loneate', 'LONEATE', ' Loneate '],
    });
    expect(skincare.getProduct(alice.userId, id).keyIngredients).toEqual(['Loneate']);

    const groups = skincare.duplicateIngredients(alice.userId);
    // No group anywhere may list the same product id more than once.
    for (const group of groups) {
      const ids = group.products.map((p) => p.id);
      expect(new Set(ids).size, `${group.ingredient} lists a product twice`).toBe(ids.length);
    }
    // And an ingredient only this product has is not a duplicate at all, however
    // many ways the user capitalised it.
    expect(groups.some((g) => g.ingredient === 'loneate')).toBe(false);

    skincare.deleteProduct(alice.userId, id);
  });

  it('does not trip over a row stored before the list was de-duplicated', () => {
    // Rows already in the database can hold case variants, because the write path
    // used to de-duplicate case-sensitively. Written straight to the table, past the
    // service, so the read path is the only thing under test here.
    const id = 'legacy-case-variant-row';
    dbClient.db
      .insert(schema.skincareProducts)
      .values({
        id,
        userId: alice.userId,
        name: 'Legacy row',
        keyIngredients: ['Legacyate', 'legacyate', 'LEGACYATE'],
      })
      .run();
    expect(skincare.getProduct(alice.userId, id).keyIngredients).toHaveLength(3);

    const groups = skincare.duplicateIngredients(alice.userId);
    expect(groups.some((g) => g.ingredient === 'legacyate')).toBe(false);
    for (const group of groups) {
      const ids = group.products.map((p) => p.id);
      expect(new Set(ids).size, `${group.ingredient} lists a product twice`).toBe(ids.length);
    }

    skincare.deleteProduct(alice.userId, id);
  });

  it('only ever compares the caller own shelf', () => {
    const mine = skincare.createProduct(alice.userId, {
      name: 'Mine',
      keyIngredients: ['Shared thing'],
    });
    const theirs = skincare.createProduct(mallory.userId, {
      name: 'Theirs',
      keyIngredients: ['Shared thing'],
    });
    expect(skincare.duplicateIngredients(alice.userId).some((g) => g.ingredient === 'shared thing')).toBe(
      false,
    );
    expect(skincare.duplicateIngredients(mallory.userId).some((g) => g.ingredient === 'shared thing')).toBe(
      false,
    );
    skincare.deleteProduct(alice.userId, mine);
    skincare.deleteProduct(mallory.userId, theirs);
  });
});

describe('productsNeedingAttention', () => {
  it('lists only what the recorded dates or the running-low flag justify, worst first', () => {
    const expired = skincare.createProduct(alice.userId, {
      name: 'Expired tube',
      expiresAt: '2026-01-01',
    });
    const useSoon = skincare.createProduct(alice.userId, {
      name: 'Nearly due',
      expiresAt: '2026-11-05',
    });
    const fresh = skincare.createProduct(alice.userId, {
      name: 'Years away',
      expiresAt: '2030-01-01',
    });
    const noDates = skincare.createProduct(alice.userId, { name: 'No dates at all' });
    const low = skincare.createProduct(alice.userId, { name: 'Almost empty', runningLow: true });

    const ids = skincare.productsNeedingAttention(alice.userId, TODAY).map((p) => p.product.id);
    expect(ids).toContain(expired);
    expect(ids).toContain(useSoon);
    expect(ids).toContain(low);
    // A date years out is not a problem, and no date at all is not a problem either:
    // GymOS does not nag about something it knows nothing about.
    expect(ids).not.toContain(fresh);
    expect(ids).not.toContain(noDates);
    expect(ids.indexOf(expired)).toBeLessThan(ids.indexOf(useSoon));

    const rows = skincare.productsNeedingAttention(alice.userId, TODAY);
    expect(rows.find((r) => r.product.id === expired)!.expiry.state).toBe('expired');
    expect(rows.find((r) => r.product.id === useSoon)!.expiry.state).toBe('use_soon');
    expect(rows.find((r) => r.product.id === low)!.expiry.state).toBe('unknown');

    for (const id of [expired, useSoon, fresh, noDates, low]) {
      skincare.deleteProduct(alice.userId, id);
    }
  });

  it('never shows another account shelf', () => {
    const theirs = skincare.createProduct(mallory.userId, {
      name: 'Their expired tube',
      expiresAt: '2026-01-01',
    });
    expect(
      skincare.productsNeedingAttention(alice.userId, TODAY).map((p) => p.product.id),
    ).not.toContain(theirs);
    skincare.deleteProduct(mallory.userId, theirs);
  });
});

describe('patchTestsAwaitingObservation', () => {
  it('holds a test open from the moment its window closes until the user answers', () => {
    const testId = skincare.startPatchTest(alice.userId, {
      productId: alice.productId,
      startedAt: '2026-10-27T08:00:00.000Z',
      windowHours: 24,
      now: NOW,
    });
    const closes = '2026-10-28T08:00:00.000Z';

    // While it is running there is nothing for the user to answer.
    expect(
      skincare.patchTestsAwaitingObservation(alice.userId, NOW).map((r) => r.test.id),
    ).not.toContain(testId);

    // The instant the window closes, and for as long as it stays unanswered.
    expect(
      skincare.patchTestsAwaitingObservation(alice.userId, closes).map((r) => r.test.id),
    ).toContain(testId);
    expect(
      skincare.patchTestsAwaitingObservation(alice.userId, '2026-11-20T08:00:00.000Z').map(
        (r) => r.test.id,
      ),
    ).toContain(testId);

    // Once the user records what they saw it drops off the list.
    skincare.observePatchTest(alice.userId, testId, { outcome: 'unsure', now: closes });
    expect(
      skincare.patchTestsAwaitingObservation(alice.userId, closes).map((r) => r.test.id),
    ).not.toContain(testId);

    skincare.deletePatchTest(alice.userId, testId);
  });

  it('is scoped to the caller', () => {
    expect(
      skincare
        .patchTestsAwaitingObservation(mallory.userId, '2026-10-29T09:00:00.000Z')
        .map((r) => r.test.id),
    ).not.toContain(alice.patchTestId);
  });
});

/* ------------------------------------------- the one answer GymOS never picks */

function formDataOf(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('recording a patch-test observation', () => {
  /**
   * A test whose observation window has already closed — the state in which an
   * answer IS storable. That matters for what follows: if the app coerced an
   * unrecognised submission into "no reaction", it would be written here, so a row
   * that stays `pending` is a refusal and not the window guard talking.
   */
  function closedWindowTest(id: string): string {
    dbClient.db
      .insert(schema.patchTests)
      .values({
        id,
        userId: alice.userId,
        productId: alice.productId,
        startedAt: new Date(Date.now() - 48 * 3_600_000).toISOString(),
        checkAt: new Date(Date.now() - 3_600_000).toISOString(),
        outcome: 'pending',
      })
      .run();
    return id;
  }

  it('refuses an absent, empty or unrecognised answer, and stores the one the user chose', async () => {
    const id = closedWindowTest('closed-window-patch-test');
    const now = new Date().toISOString();
    const nothingChosen = new FormData();
    nothingChosen.set('testId', id);

    for (const data of [
      nothingChosen, // the field was never submitted
      formDataOf({ testId: id, outcome: '' }), // the placeholder option
      formDataOf({ testId: id, outcome: 'definitely_fine' }), // not one of the three
      formDataOf({ testId: id, outcome: 'NO_REACTION' }), // nearly right, still not it
      formDataOf({ testId: id, outcome: 'pending' }), // a row state, not an answer
      formDataOf({ testId: id, outcome: 'no_reaction ' }), // not an exact match either
    ]) {
      const state = await groomingActions.observePatchTestAction({}, data);
      const after = skincare.getPatchTest(alice.userId, id, now);
      expect(
        after.test.outcome,
        `"${String(data.get('outcome'))}" was recorded as something the user observed`,
      ).toBe('pending');
      expect(after.verdict.code).toBe('awaiting_your_observation');
      expect(state.success).toBeUndefined();
      expect(state.error).toMatch(/will not record "no reaction" for you/i);
    }

    // The same row takes the answer the moment the user actually gives one, which is
    // what makes every refusal above a refusal rather than a row that cannot be written.
    const chosen = formDataOf({
      testId: id,
      outcome: 'no_reaction',
      note: 'Nothing at the patch site.',
    });
    const recorded = await groomingActions.observePatchTestAction({}, chosen);
    expect(recorded.error).toBeUndefined();
    expect(recorded.success).toMatch(/recorded what you observed/i);
    const stored = skincare.getPatchTest(alice.userId, id, now);
    expect(stored.test.outcome).toBe('no_reaction');
    expect(stored.test.note).toBe('Nothing at the patch site.');
    expect(stored.verdict.code).toBe('no_reaction_observed');

    skincare.deletePatchTest(alice.userId, id);
  });

  it('offers no pre-selected answer, so an untouched form submits nothing to accept', () => {
    // The allow-list cannot catch this half of it: 'no_reaction' IS a value a user
    // may choose, so a select that starts on it would have GymOS answering for them
    // through a form nobody touched. There is no DOM harness in this suite, so the
    // component source is read instead of rendered.
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components', 'skincare-forms.tsx'),
      'utf8',
    );
    const select = /<Select name="outcome"[\s\S]*?<\/Select>/.exec(source)?.[0];
    expect(select, 'the outcome select is no longer in skincare-forms.tsx').toBeDefined();
    // Parsed something real, so a renamed field cannot turn this into a no-op.
    expect(select!).toContain('<option value="no_reaction">');
    // It starts on the placeholder, and on nothing else.
    expect(select!).toContain('defaultValue=""');
    expect(select!).toMatch(/<option value="">[^<]+<\/option>/);
    expect(select!).not.toMatch(/defaultValue="(?:no_reaction|reaction|unsure)"/);
    expect(select!).not.toMatch(/<option value="[^"]+"[^>]*\bselected\b/);
  });

  it('is refused at the service too, so a caller that skips the action cannot write it', () => {
    const id = closedWindowTest('closed-window-patch-test-bypassed');
    const now = new Date().toISOString();
    type Outcome = Parameters<typeof skincare.observePatchTest>[2]['outcome'];

    for (const raw of ['', '   ', 'definitely_fine', 'pending', 'No_Reaction']) {
      expect(() =>
        skincare.observePatchTest(alice.userId, id, {
          outcome: raw as unknown as Outcome,
          now,
        }),
      ).toThrowError(/will not record "no reaction" for you/i);
      expect(skincare.getPatchTest(alice.userId, id, now).test.outcome).toBe('pending');
    }

    skincare.observePatchTest(alice.userId, id, { outcome: 'no_reaction', now });
    expect(skincare.getPatchTest(alice.userId, id, now).test.outcome).toBe('no_reaction');
    skincare.deletePatchTest(alice.userId, id);
  });
});

describe('a tied order_index reads the same way everywhere', () => {
  it('shows the order a move operates on, so a press moves the step the user pointed at', () => {
    // Legacy rows: three steps all at order_index 0, written straight to the table in
    // an order that is NOT their id order. The reorder and delete paths break the tie
    // on `id`; a read that broke it differently (or not at all) would show the user
    // one order while a move walked another, so one press appeared to move a step
    // nobody pointed at.
    const routineId = grooming.createRoutine(alice.userId, 'pro', {
      name: 'Legacy tied order',
      slot: 'evening',
    });
    for (const row of [
      { id: 'tied-step-z', label: 'Zinc paste' },
      { id: 'tied-step-a', label: 'Aftershave' },
      { id: 'tied-step-m', label: 'Moisturise' },
    ]) {
      dbClient.db
        .insert(schema.groomingRoutineSteps)
        .values({ id: row.id, routineId, orderIndex: 0, label: row.label })
        .run();
    }

    const inIdOrder = ['Aftershave', 'Moisturise', 'Zinc paste'];
    // `listRoutines` is the read behind the up/down buttons; `getRoutine` is the read
    // behind the single-routine page. Both have to agree with the move.
    const fromList = grooming
      .listRoutines(alice.userId)
      .find((r) => r.id === routineId)!.steps;
    expect(fromList.map((s) => s.label)).toEqual(inIdOrder);
    expect(grooming.getRoutine(alice.userId, routineId).steps.map((s) => s.label)).toEqual(
      inIdOrder,
    );

    // Press "down" on the first step exactly as the page showed it.
    const first = fromList[0]!;
    grooming.moveRoutineStep(alice.userId, first.id, 'down');
    const after = grooming.getRoutine(alice.userId, routineId).steps;
    expect(after.map((s) => s.label)).toEqual(['Moisturise', 'Aftershave', 'Zinc paste']);
    expect(after.map((s) => s.orderIndex)).toEqual([0, 1, 2]);
    expect(after[1]!.id).toBe(first.id);

    grooming.deleteRoutine(alice.userId, routineId);
  });
});

describe('a patch-test window cannot be created already closed', () => {
  it('refuses a backdated start whose window would be over before the test exists', () => {
    // Otherwise a backdated start yields an immediately storable "no reaction" for a
    // window nobody watched — the one answer that could send someone back to a
    // product that hurt them.
    expect(() =>
      skincare.startPatchTest(alice.userId, {
        productId: alice.productId,
        startedAt: '2026-09-01T09:00:00.000Z',
        windowHours: 24,
        now: NOW,
      }),
    ).toThrowError(/already be closed/i);
  });

  it('refuses a start in the future', () => {
    expect(() =>
      skincare.startPatchTest(alice.userId, {
        productId: alice.productId,
        startedAt: '2026-12-01T09:00:00.000Z',
        now: NOW,
      }),
    ).toThrowError(/cannot start in the future/i);
  });

  it('accepts a start inside the window and leaves the test unobservable until it closes', () => {
    const testId = skincare.startPatchTest(alice.userId, {
      productId: alice.productId,
      startedAt: '2026-10-26T20:00:00.000Z',
      windowHours: 24,
      now: NOW,
    });
    const test = skincare.getPatchTest(alice.userId, testId, NOW);
    expect(test.test.checkAt).toBe('2026-10-27T20:00:00.000Z');
    expect(test.verdict.code).toBe('in_progress');
    expect(() =>
      skincare.observePatchTest(alice.userId, testId, { outcome: 'no_reaction', now: NOW }),
    ).toThrowError(/window has closed/i);
    skincare.deletePatchTest(alice.userId, testId);
  });
});
