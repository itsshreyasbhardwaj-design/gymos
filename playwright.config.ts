import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a production build with its own database file, so they
 * never touch the development data. The journey tests create their own accounts.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3210',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // The full journey is expensive, so it runs once on desktop. The public-site and
    // accessibility specs run on all three viewports.
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // Chromium-based tablet emulation: only Chromium is installed, so the WebKit
      // iPad profile is deliberately not used.
      name: 'tablet',
      testMatch: /public\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 834, height: 1112 },
        isMobile: false,
        hasTouch: true,
      },
    },
    {
      name: 'mobile',
      testMatch: /public\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npm run e2e:server',
    url: 'http://127.0.0.1:3210',
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
