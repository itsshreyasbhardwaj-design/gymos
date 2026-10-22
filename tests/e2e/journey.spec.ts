import { test, expect, type Page } from '@playwright/test';

/**
 * The full real-world journey from the GymOS brief, in order:
 * register → onboard → equipment → plan → exercise → workout → log → complete →
 * progress → switch equipment → adapt → reduce time → adapt → diet → allergy →
 * meal plan → swap → grocery → progress → settings → export → logout → protected
 * routes stay protected.
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function register(page: Page, email: string, password: string) {
  await page.goto('/signup');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click({ noWaitAfter: true });
  await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
}

/**
 * Clicking a submit button that triggers a Server Action redirect races with the
 * navigation, so every step uses noWaitAfter and then waits for the next heading.
 */
async function advance(page: Page, nextHeading: RegExp | string, label = 'Continue') {
  await page.getByRole('button', { name: label }).click({ noWaitAfter: true });
  await expect(page.getByRole('heading', { name: nextHeading })).toBeVisible({ timeout: 30_000 });
}

async function completeOnboarding(page: Page, name: string) {
  // Step 1 — basic profile
  await expect(page.getByRole('heading', { name: 'Basic profile' })).toBeVisible();
  await page.getByLabel(/What should we call you/).fill(name);
  await page.getByRole('radio', { name: /18 or over/ }).check();
  await advance(page, 'Fitness experience');

  // Step 2 — experience
  await page.getByRole('radio', { name: /Some experience/ }).check();
  await advance(page, 'Training interests');

  // Step 3 — interests
  await page.getByRole('checkbox', { name: /General fitness/ }).check();
  await page.getByRole('checkbox', { name: /Strength skills/ }).check();
  await advance(page, 'Availability');

  // Step 4 — availability
  for (const day of ['Monday', 'Wednesday', 'Friday']) {
    await page.getByRole('checkbox', { name: day, exact: true }).check();
  }
  await page.getByLabel('How long per session?').selectOption('45');
  await advance(page, 'Training environment');

  // Step 5 — environment
  await page.getByRole('radio', { name: 'Commercial gym' }).check();
  await advance(page, 'Equipment');

  // Step 6 — equipment
  await page.getByRole('button', { name: /Full commercial gym/ }).click();
  await expect(page.getByText(/\d+ selected/).first()).toBeVisible();
  await advance(page, 'Nutrition preferences');

  // Step 7 — nutrition
  await page.getByRole('radio', { name: 'Vegetarian', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Peanut' }).check();
  await advance(page, 'Review');

  // Step 8 — review
  await expect(page.getByText(name).first()).toBeVisible();
  await advance(page, 'Build your first plan', /Looks right/);

  // Step 9 — generate
  await page.getByRole('button', { name: 'Generate my plan' }).click({ noWaitAfter: true });
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
}

test.describe('full user journey', () => {
  test.describe.configure({ timeout: 180_000 });

  test('register, train, adapt, eat, review and leave', async ({ page }) => {
    const email = `${unique('journey')}@example.com`;
    const password = 'journey-long-secret-9';
    const name = 'Journey Tester';

    /* 1-4. Register and onboard, including equipment selection. */
    await register(page, email, password);
    await completeOnboarding(page, name);
    await expect(
      page.getByRole('heading', { name: /Good (morning|afternoon|evening), Journey/ }),
    ).toBeVisible();

    /* 5. Open an exercise from the library. */
    await page.goto('/exercises');
    await expect(page.getByRole('heading', { name: 'Exercise library' })).toBeVisible();
    await page.getByPlaceholder('Search by name, muscle or movement…').fill('goblet squat');
    await page.getByRole('link', { name: /Goblet squat/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Goblet squat' })).toBeVisible();
    await expect(page.getByText('How to do it').first()).toBeVisible();
    // Honesty: no fabricated demonstration media.
    await expect(page.getByText('No demonstration media').first()).toBeVisible();

    /* 6-8. Start a workout, record activity, complete it. */
    await page.goto('/workouts');
    await expect(page.getByRole('heading', { name: 'Workouts' })).toBeVisible();
    await page.getByRole('link', { name: /Monday/ }).first().click();
    await page.waitForURL(/\/workouts\/session\//);

    const startButton = page.getByRole('button', { name: 'Start workout' });
    if (await startButton.isVisible()) {
      await startButton.click();
      await expect(startButton).toBeHidden({ timeout: 20_000 });
    }

    await expect(page.getByRole('button', { name: /Log set 1/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /Log set 1/ }).click();
    await expect(page.getByText('Sets logged: 1').first()).toBeVisible();
    // Skip the rest timer (distinct from the "Skip this set" control).
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('button', { name: /Log set 2/ }).click();
    await expect(page.getByText('Sets logged: 2').first()).toBeVisible();

    await page.getByRole('button', { name: /Finish (workout|early)/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Finish this workout' })).toBeVisible();
    await page.getByRole('button', { name: 'About right' }).click();
    await page.getByRole('button', { name: 'Save and finish' }).click();

    /* 9. Progress reflects the completed session. */
    await expect(page.getByText('Session saved').first()).toBeVisible();
    await page.goto('/progress');
    await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
    await expect(page.getByText('Sets logged', { exact: true }).first()).toBeVisible();

    /* 10. The free plan limit is enforced on the server, then Pro unlocks it. */
    await page.goto('/equipment');
    await expect(
      page.getByText(/free plan includes 1 equipment profiles/i).first(),
    ).toBeVisible();

    // Development plan switch — there is no payment path in this build.
    await page.goto('/settings/subscription');
    await expect(page.getByText(/Payments are not enabled/).first()).toBeVisible();
    await page.getByLabel('Development plan').selectOption('pro');
    await page.getByRole('button', { name: 'Switch' }).click();
    await expect(page.getByText(/switched to pro/i).first()).toBeVisible();

    await page.goto('/equipment');
    await page.getByLabel(/^Name/).first().fill('Travel');
    await page.getByLabel('Start from').selectOption('travel');
    await page.getByRole('button', { name: 'Create profile' }).click();
    await expect(page.getByText('Equipment profile created.').first()).toBeVisible();

    /* 11-13. RealitySync: shorten an upcoming session and read its reasoning. */
    await page.goto('/workouts');
    const scheduled = page
      .locator('a[href^="/workouts/session/"]')
      .filter({ hasText: /scheduled/i })
      .first();
    await expect(scheduled).toBeVisible();
    await scheduled.click();
    await page.waitForURL(/\/workouts\/session\//);

    await page.getByRole('button', { name: /Today's different/ }).click();
    await expect(page.getByText('RealitySync').first()).toBeVisible();
    await expect(page.getByText(/Nothing changes until you accept it/).first()).toBeVisible();
    await page.getByRole('button', { name: /I have less time today/ }).click();
    await expect(page.getByText(/Shortened to about|already fits/).first()).toBeVisible();
    await expect(page.getByText('What GymOS considered').first()).toBeVisible();

    // Apply it, and confirm the session is marked as adapted rather than silently changed.
    const apply = page.getByRole('button', { name: /Apply this change/ });
    if (await apply.isEnabled()) {
      await apply.click();
      await expect(page.getByText(/Adapted by RealitySync/).first()).toBeVisible({
        timeout: 20_000,
      });
    }

    /* 14-16. Dietary preferences and allergy are respected. */
    await page.goto('/nutrition');
    await expect(page.getByRole('heading', { name: 'Nutrition' })).toBeVisible();
    await expect(page.getByText(/Allergens are applied as a hard rule/).first()).toBeVisible();

    await page.goto('/nutrition/meal-plan');
    const planButton = page.getByRole('button', { name: /Plan my meals|Regenerate/ }).first();
    await planButton.click();
    await expect(page.getByText(/Week of/).first()).toBeVisible();
    await expect(page.getByText(/Allergen filtering is active/).first()).toBeVisible();

    /* 17. Swap a meal. */
    await page.getByRole('button', { name: 'Swap' }).first().click();
    await expect(page.getByText(/re-checked against your allergens/).first()).toBeVisible();

    /* 18. Grocery list follows the plan. */
    await page.goto('/nutrition/groceries');
    const buildList = page.getByRole('button', { name: /Build from meal plan|Build my list/ }).first();
    if (await buildList.isVisible()) await buildList.click();
    await expect(page.getByText(/ticked off/).first()).toBeVisible();
    // Honesty: no invented prices.
    await expect(page.getByText(/No cost estimate|estimate covers/).first()).toBeVisible();

    /* 19. Review progress. */
    await page.goto('/progress');
    await expect(page.getByText(/What GymOS will not show you/).first()).toBeVisible();

    /* 20. Update profile settings. */
    await page.goto('/settings/profile');
    await page.getByLabel(/^Display name/).fill('Journey Updated');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.').first()).toBeVisible();

    /* 21. Export data. */
    await page.goto('/settings/privacy');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export everything as JSON/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toContain('gymos-export');

    /* 22. Log out. */
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out' }).click({ noWaitAfter: true });
    await page.waitForURL('/', { timeout: 30_000 });

    /* 23. Protected routes stay protected. */
    for (const route of ['/dashboard', '/workouts', '/nutrition', '/progress', '/settings']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});

test.describe('cross-user isolation in the browser', () => {
  test.describe.configure({ timeout: 180_000 });

  test('another signed-in user cannot open the first user\'s records', async ({ page, context }) => {
    const emailA = `${unique('iso-a')}@example.com`;
    const emailB = `${unique('iso-b')}@example.com`;
    const password = 'isolation-long-secret-9';

    await register(page, emailA, password);
    await completeOnboarding(page, 'User A');

    await page.goto('/workouts');
    await page.getByRole('link', { name: /Monday/ }).first().click();
    await page.waitForURL(/\/workouts\/session\//);
    const sessionUrl = page.url();
    expect(sessionUrl).toContain('/workouts/session/');

    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out' }).click({ noWaitAfter: true });
    await page.waitForURL('/', { timeout: 30_000 });
    await context.clearCookies();

    await register(page, emailB, password);
    await completeOnboarding(page, 'User B');

    // User B tries User A's session URL directly.
    const response = await page.goto(sessionUrl);
    expect(response?.status()).toBe(404);
  });
});
