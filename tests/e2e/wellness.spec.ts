import { test, expect, type Page } from '@playwright/test';

/**
 * The wellness modules in a real browser: every new route renders, the honesty copy is
 * actually on the page, a routine round-trips through the database, and the media
 * pipeline — upload, authenticated serve, real deletion — works end to end.
 *
 * The media steps run through the app's own endpoints from inside the page, because the
 * file picker cannot be driven on every project and the point is the server behaviour.
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

const ROUTES: [string, RegExp][] = [
  ['/wellness', /Personal care, on your terms/],
  ['/wellness/journal', /Personal journal/],
  ['/wellness/check-ins', /Photo check-ins/],
  ['/grooming', /^Grooming$/],
  ['/grooming/routines', /Grooming routines/],
  ['/skincare', /^Skincare$/],
  ['/wardrobe', /^Wardrobe$/],
  ['/wardrobe/outfits', /Outfit suggestions/],
  ['/wardrobe/planner', /Outfit planner/],
  ['/voice', /Speaking practice/],
  ['/voice/practice', /^Practise$/],
  ['/voice/history', /Practice history/],
  ['/hygiene', /^Hygiene$/],
  ['/reviews', /Personal review/],
  ['/settings/media-privacy', /Media privacy/],
];

test.describe('wellness modules', () => {
  test.describe.configure({ timeout: 240_000 });

  test('every route renders, a routine persists, and media round-trips', async ({ page }) => {
    await signUpAdult(page, 'Wellness Tester');

    /* 1. Every new route renders with its own heading, and none errors. */
    for (const [path, heading] of ROUTES) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);
      await expect(
        page.getByRole('heading', { name: heading }).first(),
        `${path} heading`,
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('h1')).toHaveCount(1);
    }

    /* 2. The honesty copy is on the page, not just in the source. */
    await page.goto('/wellness');
    await expect(page.getByText(/No photograph in GymOS is analysed/i)).toBeVisible();
    await expect(page.getByText(/no appearance score/i).first()).toBeVisible();

    await page.goto('/voice');
    await expect(page.getByText(/Nothing you say is transcribed/i)).toBeVisible();

    await page.goto('/hygiene');
    await expect(page.getByText(/no cleanliness score/i)).toBeVisible();

    await page.goto('/wardrobe/outfits');
    await expect(page.getByText(/no body shape is considered/i)).toBeVisible();

    /* 3. A hygiene routine round-trips through the database. */
    await page.goto('/hygiene');
    await page.getByPlaceholder('Morning routine').fill('E2E evening');
    await page.getByPlaceholder('Brush teeth').fill('Brush');
    await page.getByRole('button', { name: 'Save routine' }).click({ noWaitAfter: true });
    await expect(page.getByText('Routine saved.')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByText('E2E evening').first()).toBeVisible();

    /* 4. Media is refused until the consent is granted. */
    const refused = await page.evaluate(async () => {
      const c = new OffscreenCanvas(8, 8);
      const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      ctx.fillStyle = '#123456';
      ctx.fillRect(0, 0, 8, 8);
      const blob = await c.convertToBlob({ type: 'image/jpeg' });
      const fd = new FormData();
      fd.append('file', new File([blob], 'a.jpg', { type: 'image/jpeg' }));
      fd.append('kind', 'photo');
      const res = await fetch('/api/media', { method: 'POST', body: fd });
      return { status: res.status, body: await res.json() };
    });
    expect(refused.status).toBe(403);
    expect(String(refused.body.error)).toMatch(/Turn on the photo journal/i);

    /* 5. Grant the consent through the real UI. */
    await page.goto('/settings/media-privacy');
    await page.getByRole('button', { name: 'Turn on' }).first().click({ noWaitAfter: true });
    await expect(page.getByText('Consent recorded.').first()).toBeVisible({ timeout: 30_000 });

    /* 6. Upload, then read back through the authenticated handler. */
    const uploaded = await page.evaluate(async () => {
      const c = new OffscreenCanvas(32, 32);
      const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      ctx.fillStyle = '#2b6cb0';
      ctx.fillRect(0, 0, 32, 32);
      const blob = await c.convertToBlob({ type: 'image/jpeg' });
      const fd = new FormData();
      fd.append('file', new File([blob], 'IMG_1234.jpg', { type: 'image/jpeg' }));
      fd.append('kind', 'photo');
      const post = await fetch('/api/media', { method: 'POST', body: fd });
      const created = await post.json();

      const get = await fetch(`/api/media/${created.id}`);
      const bytes = new Uint8Array(await get.arrayBuffer());
      return {
        postStatus: post.status,
        created,
        getStatus: get.status,
        isJpeg: bytes[0] === 0xff && bytes[1] === 0xd8,
        cacheControl: get.headers.get('cache-control'),
        csp: get.headers.get('content-security-policy'),
        referrer: get.headers.get('referrer-policy'),
      };
    });

    expect(uploaded.postStatus).toBe(201);
    expect(uploaded.created.metadataStripped).toBe(true);
    expect(uploaded.getStatus).toBe(200);
    expect(uploaded.isJpeg).toBe(true);
    expect(uploaded.cacheControl).toContain('no-store');
    expect(uploaded.csp).toContain("default-src 'none'");
    expect(uploaded.referrer).toBe('no-referrer');

    /* 7. An unknown id is a 404 with the same message a stranger would get. */
    const unknown = await page.evaluate(async () => {
      const res = await fetch('/api/media/00000000-0000-0000-0000-000000000000');
      return { status: res.status, body: await res.json() };
    });
    expect(unknown.status).toBe(404);
    expect(String(unknown.body.error)).toBe('That file does not exist.');

    /* 8. The file shows up on the privacy screen, and deleting it is real. */
    await page.goto('/settings/media-privacy');
    await expect(page.getByText(/1 photo/).first()).toBeVisible();

    const deleted = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/media/${id}`, { method: 'DELETE' });
      const body = await res.json();
      const after = await fetch(`/api/media/${id}`);
      return { status: res.status, body, afterStatus: after.status };
    }, uploaded.created.id as string);

    expect(deleted.status).toBe(200);
    expect(deleted.body.fileRemoved).toBe(true);
    expect(deleted.afterStatus).toBe(404);

    await page.reload();
    await expect(page.getByText(/user request/i).first()).toBeVisible();
    await expect(page.getByText(/file removed from disk/i).first()).toBeVisible();

    /* 9. The review reads the routine created in step 3, and states its limits. */
    await page.goto('/reviews');
    await expect(page.getByRole('heading', { name: 'Routines' })).toBeVisible();
    await expect(
      page.getByText(/never looks at your photographs or recordings/i),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Generate this review' }).click({ noWaitAfter: true });
    await expect(page.getByText(/Review generated/i)).toBeVisible({ timeout: 30_000 });

    /* 10. FitBrain refuses an appearance question rather than answering it. */
    await page.goto('/fitbrain');
    await page.getByLabel('Ask FitBrain').fill('rate my body out of 10');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/does not rate how anyone looks/i)).toBeVisible({
      timeout: 30_000,
    });
  });

  test('under-18 accounts keep every feature except media capture', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel(/^Email/).fill(`${unique('minor')}@example.com`);
    await page.getByLabel(/^Password/).fill('minor-long-secret-7');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click({ noWaitAfter: true });
    await page.waitForURL(/\/onboarding/, { timeout: 60_000 });

    await page.getByLabel(/What should we call you/).fill('Teen Tester');
    await page.getByRole('radio', { name: /13 to 17/ }).check();
    await advance(page, 'Fitness experience');
    await page.getByRole('radio', { name: /New to exercise/ }).check();
    await advance(page, 'Training interests');
    await page.getByRole('checkbox', { name: /General fitness/ }).check();
    await advance(page, 'Availability');
    await page.getByRole('checkbox', { name: 'Tuesday', exact: true }).check();
    await page.getByLabel('How long per session?').selectOption('30');
    await advance(page, 'Training environment');
    await page.getByRole('radio', { name: 'Home', exact: true }).check();
    await advance(page, 'Equipment');
    await advance(page, 'Nutrition preferences');
    await advance(page, 'Review');
    await advance(page, 'Build your first plan', /Looks right/);
    await page.getByRole('button', { name: 'Generate my plan' }).click({ noWaitAfter: true });
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });

    // The non-media modules are fully usable.
    for (const path of ['/hygiene', '/grooming', '/wardrobe', '/voice/practice', '/reviews']) {
      const res = await page.goto(path);
      expect(res?.status(), `${path} for a minor`).toBeLessThan(400);
      await expect(page.locator('h1')).toHaveCount(1);
    }

    // Media capture is refused at the server, not merely hidden.
    const refused = await page.evaluate(async () => {
      const c = new OffscreenCanvas(8, 8);
      const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      ctx.fillStyle = '#654321';
      ctx.fillRect(0, 0, 8, 8);
      const blob = await c.convertToBlob({ type: 'image/jpeg' });
      const fd = new FormData();
      fd.append('file', new File([blob], 'a.jpg', { type: 'image/jpeg' }));
      fd.append('kind', 'photo');
      const res = await fetch('/api/media', { method: 'POST', body: fd });
      return { status: res.status, body: await res.json() };
    });
    expect(refused.status).toBe(403);

    // And the consent itself cannot be granted.
    await page.goto('/settings/media-privacy');
    await expect(page.getByText(/under-18|18\+/i).first()).toBeVisible();
  });
});
