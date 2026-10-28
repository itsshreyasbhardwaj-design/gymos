import { test, expect, type Page } from '@playwright/test';

/**
 * The grouped navigation, on all three viewports.
 *
 * The personal-care modules would have made a flat fourteen-item list, so the sidebar is
 * grouped and the four-slot mobile bottom bar stays on training — the thing people open
 * the app to do. That is a responsive decision, so it is tested responsively.
 */

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function advance(page: Page, nextHeading: RegExp | string, label = 'Continue') {
  await page.getByRole('button', { name: label }).click({ noWaitAfter: true });
  await expect(page.getByRole('heading', { name: nextHeading })).toBeVisible({ timeout: 30_000 });
}

/** Register and onboard as an adult, which is the shortest path to a usable account. */
async function signUpAdult(page: Page, name: string): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel(/^Email/).fill(`${unique('wellness')}@example.com`);
  await page.getByLabel(/^Password/).fill('wellness-long-secret-7');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click({ noWaitAfter: true });
  await page.waitForURL(/\/onboarding/, { timeout: 60_000 });

  await page.getByLabel(/What should we call you/).fill(name);
  await page.getByRole('radio', { name: /18 or over/ }).check();
  await advance(page, 'Fitness experience');
  await page.getByRole('radio', { name: /Some experience/ }).check();
  await advance(page, 'Training interests');
  await page.getByRole('checkbox', { name: /General fitness/ }).check();
  await advance(page, 'Availability');
  for (const day of ['Monday', 'Thursday']) {
    await page.getByRole('checkbox', { name: day, exact: true }).check();
  }
  await page.getByLabel('How long per session?').selectOption('45');
  await advance(page, 'Training environment');
  await page.getByRole('radio', { name: 'Commercial gym' }).check();
  await advance(page, 'Equipment');
  await page.getByRole('button', { name: /Full commercial gym/ }).click();
  await expect(page.getByText(/\d+ selected/).first()).toBeVisible();
  await advance(page, 'Nutrition preferences');
  await page.getByRole('radio', { name: 'Vegetarian', exact: true }).check();
  await advance(page, 'Review');
  await advance(page, 'Build your first plan', /Looks right/);
  await page.getByRole('button', { name: 'Generate my plan' }).click({ noWaitAfter: true });
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
}


test.describe('navigation', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the personal-care group is reachable', async ({ page }) => {
    await signUpAdult(page, 'Nav Tester');

    // On a narrow viewport the sidebar is replaced by a menu, so open it if it is there.
    const menu = page.getByRole('button', { name: 'Open menu' });
    if (await menu.isVisible()) await menu.click();

    const nav = page.getByRole('navigation', { name: /Main|All sections/ }).first();
    await expect(nav.getByText('Personal care', { exact: true })).toBeVisible();

    for (const label of ['Wellness', 'Grooming', 'Skincare', 'Wardrobe', 'Voice', 'Hygiene', 'Reviews']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    // Training stays in the four-slot bottom bar on mobile; personal care does not
    // compete for it.
    const bottom = page.getByRole('navigation', { name: 'Primary' });
    if (await bottom.isVisible()) {
      await expect(bottom.getByRole('link', { name: 'Workouts' })).toBeVisible();
      await expect(bottom.getByRole('link', { name: 'Grooming' })).toHaveCount(0);
    }

    // The link actually goes somewhere.
    await nav.getByRole('link', { name: 'Wellness', exact: true }).click();
    await page.waitForURL(/\/wellness$/);
    await expect(page.getByRole('heading', { name: /Personal care, on your terms/ })).toBeVisible();
  });

});
