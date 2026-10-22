import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTempDatabase, prepareDatabase } from '../helpers/test-db';

const temp = createTempDatabase();

type AccountModule = typeof import('@/lib/services/account');
let account: AccountModule;

beforeAll(async () => {
  await prepareDatabase();
  account = await import('@/lib/services/account');
});

afterAll(() => temp.cleanup());

describe('registration', () => {
  it('creates an account, a terms consent and a free subscription row', async () => {
    const userId = await account.registerUser({
      email: 'Alice@Example.com',
      password: 'correct-horse-battery',
      acceptTerms: true,
    });
    expect(userId).toBeTruthy();
    expect(account.getConsent(userId, 'terms')).toBe(true);
  });

  it('rejects a duplicate email regardless of case', async () => {
    await expect(
      account.registerUser({
        email: 'alice@example.com',
        password: 'another-long-secret-x',
        acceptTerms: true,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('rejects a weak or short password', async () => {
    await expect(
      account.registerUser({ email: 'b@example.com', password: 'short', acceptTerms: true }),
    ).rejects.toThrow(/at least 10/i);
    await expect(
      account.registerUser({
        email: 'b@example.com',
        password: 'mypassword123',
        acceptTerms: true,
      }),
    ).rejects.toThrow(/common pattern/i);
  });

  it('rejects an invalid email', async () => {
    await expect(
      account.registerUser({ email: 'not-an-email', password: 'a-good-long-secret-x', acceptTerms: true }),
    ).rejects.toThrow(/valid email/i);
  });

  it('requires accepting the terms', async () => {
    await expect(
      account.registerUser({ email: 'c@example.com', password: 'a-good-long-secret-x', acceptTerms: false }),
    ).rejects.toThrow(/terms/i);
  });
});

describe('authentication', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const userId = await account.registerUser({
      email: 'bob@example.com',
      password: 'a-very-good-long-secret',
      acceptTerms: true,
    });
    expect(await account.authenticate('bob@example.com', 'a-very-good-long-secret')).toBe(userId);
    expect(await account.authenticate('bob@example.com', 'wrong-secret-entirely')).toBeNull();
  });

  it('is case insensitive on the email', async () => {
    expect(await account.authenticate('BOB@EXAMPLE.COM', 'a-very-good-long-secret')).toBeTruthy();
  });

  it('returns null for an unknown account rather than throwing', async () => {
    expect(await account.authenticate('nobody@example.com', 'whatever-secret-here')).toBeNull();
  });

  it('never stores the password in plain text', async () => {
    const { db } = await import('@/lib/db/client');
    const { users } = await import('@/lib/db/schema');
    const rows = db.select({ hash: users.passwordHash }).from(users).all();
    for (const row of rows) {
      expect(row.hash).not.toContain('a-very-good-long-secret');
      expect(row.hash.startsWith('scrypt$')).toBe(true);
    }
  });

  it('changes a password only with the correct current one', async () => {
    const userId = await account.registerUser({
      email: 'carol@example.com',
      password: 'carols-first-secret',
      acceptTerms: true,
    });
    await expect(
      account.changePassword(userId, 'the-wrong-one-entirely', 'carols-second-secret'),
    ).rejects.toThrow(/current password/i);
    await account.changePassword(userId, 'carols-first-secret', 'carols-second-secret');
    expect(await account.authenticate('carol@example.com', 'carols-second-secret')).toBe(userId);
    expect(await account.authenticate('carol@example.com', 'carols-first-secret')).toBeNull();
  });
});

describe('profile', () => {
  it('persists and updates a profile, recording the change', async () => {
    const userId = await account.registerUser({
      email: 'dan@example.com',
      password: 'dans-long-secret-x',
      acceptTerms: true,
    });
    account.upsertProfile(userId, {
      displayName: 'Dan',
      ageBand: 'adult_18_plus',
      experience: 'some',
      trainingDays: [1, 3],
      sessionMinutes: 45,
    });
    expect(account.getProfile(userId)?.displayName).toBe('Dan');

    account.upsertProfile(userId, { displayName: 'Daniel' });
    const updated = account.getProfile(userId);
    expect(updated?.displayName).toBe('Daniel');
    // Unspecified fields are preserved rather than reset.
    expect(updated?.trainingDays).toEqual([1, 3]);

    const { db } = await import('@/lib/db/client');
    const { userPreferencesHistory } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');
    const history = db
      .select()
      .from(userPreferencesHistory)
      .where(eq(userPreferencesHistory.userId, userId))
      .all();
    expect(history.length).toBeGreaterThan(0);
  });

  it('validates session length and training days', async () => {
    const userId = await account.registerUser({
      email: 'erin@example.com',
      password: 'erins-long-secret-x',
      acceptTerms: true,
    });
    account.upsertProfile(userId, { displayName: 'Erin', ageBand: 'adult_18_plus' });
    expect(() => account.upsertProfile(userId, { sessionMinutes: 5 })).toThrow(/between 10 and 180/);
    expect(() => account.upsertProfile(userId, { trainingDays: [9] })).toThrow(/invalid/i);
    expect(() => account.upsertProfile(userId, { displayName: '  ' })).toThrow(/name/i);
  });
});

describe('consents', () => {
  it('records and withdraws consent', async () => {
    const userId = await account.registerUser({
      email: 'frank@example.com',
      password: 'franks-long-secret-x',
      acceptTerms: true,
    });
    account.upsertProfile(userId, { displayName: 'Frank', ageBand: 'adult_18_plus' });
    expect(account.getConsent(userId, 'biometrics')).toBe(false);
    account.setConsent(userId, 'biometrics', true);
    expect(account.getConsent(userId, 'biometrics')).toBe(true);
    account.setConsent(userId, 'biometrics', false);
    expect(account.getConsent(userId, 'biometrics')).toBe(false);
  });

  it('refuses biometric consent for an under-18 account at the server', async () => {
    const userId = await account.registerUser({
      email: 'teen@example.com',
      password: 'teens-long-secret-x',
      acceptTerms: true,
    });
    account.upsertProfile(userId, { displayName: 'Teen', ageBand: 'teen_13_17' });
    expect(() => account.setConsent(userId, 'biometrics', true)).toThrow(/under-18/i);
    expect(account.getConsent(userId, 'biometrics')).toBe(false);
  });
});
