import { test, expect } from '@playwright/test';

test.describe('public site', () => {
  const routes = [
    ['/', 'Fitness that fits real life.'],
    ['/features', 'Everything GymOS does, and what it does not'],
    ['/how-it-works', 'Plan around the week you actually have'],
    ['/equipment-intelligence', 'Your equipment decides which exercises exist'],
    ['/workout-planning', 'A planner you can audit'],
    ['/nutrition-planning', 'Meal planning, not dieting'],
    ['/pricing', 'Two plans, no surprises'],
    ['/faq', 'Questions worth a straight answer'],
    ['/contact', 'Getting in touch'],
    ['/privacy', 'Privacy policy'],
    ['/terms', 'Terms of service'],
  ] as const;

  for (const [route, heading] of routes) {
    test(`renders ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    });
  }

  test('the homepage preview runs the real generator', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Example output')).toBeVisible();
    await expect(page.getByText(/Generated live by the real GymOS planner/)).toBeVisible();
    // Wait for the first generated session to appear.
    await expect(page.locator('ol li').first()).toBeVisible({ timeout: 15_000 });

    // Switching to bodyweight must surface an honest gap rather than a fake substitute.
    await page.getByLabel('What you have').selectOption('bodyweight_home');
    await expect(
      page.getByText(/movement pattern.? could not be filled/).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(/leaves the slot out rather than pretending/).first(),
    ).toBeVisible();
  });

  test('states plainly that payments are not enabled', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/Payments are not enabled/).first()).toBeVisible();
  });

  test('never claims a wearable integration is connected', async ({ page }) => {
    await page.goto('/features');
    await expect(
      page.getByText(/HealthKit and Health Connect have a data shape/).first(),
    ).toBeVisible();
    await expect(page.getByText(/No licensed media ships/).first()).toBeVisible();
  });

  test('signed-out users are redirected away from the app', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a missing page returns a 404', async ({ page }) => {
    const response = await page.goto('/not-a-real-page');
    expect(response?.status()).toBe(404);
  });
});

test.describe('accessibility basics', () => {
  test('every page has one h1 and a skip link', async ({ page }) => {
    for (const route of ['/', '/features', '/pricing', '/login']) {
      await page.goto(route);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeAttached();
    }
  });

  test('form controls are labelled', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('is usable in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});
