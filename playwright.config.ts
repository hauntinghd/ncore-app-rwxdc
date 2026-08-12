import { defineConfig, devices } from 'playwright/test';

/**
 * NCore e2e smoke suite.
 *
 * Run against a local dev server:
 *   npm run dev            # in one terminal
 *   npm run test:e2e       # in another
 *
 * Or against a deployed environment:
 *   PLAYWRIGHT_BASE_URL=https://app.ncore.nyptidindustries.com npm run test:e2e
 *
 * For the auth test to execute (not skip), also export:
 *   NCORE_E2E_EMAIL=<test-account-email>
 *   NCORE_E2E_PASSWORD=<test-account-password>
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
