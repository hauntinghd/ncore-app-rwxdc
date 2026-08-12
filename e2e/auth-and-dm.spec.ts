import { test, expect } from 'playwright/test';

const EMAIL = process.env.NCORE_E2E_EMAIL;
const PASSWORD = process.env.NCORE_E2E_PASSWORD;

/**
 * Smoke: a real login lands on /app/dm. Skips when credentials aren't set so
 * CI stays green without secrets; set NCORE_E2E_EMAIL + NCORE_E2E_PASSWORD
 * locally or in CI secrets to exercise the full path.
 */
test.describe('authenticated DM flow', () => {
  test.skip(!EMAIL || !PASSWORD, 'NCORE_E2E_EMAIL / NCORE_E2E_PASSWORD not set');

  test('login lands on /app/dm', async ({ page }) => {
    await page.goto('/login');

    await page.locator('input[type="email"]').first().fill(EMAIL!);
    await page.locator('input[type="password"]').first().fill(PASSWORD!);

    // Submit either via Enter or the primary button — whichever the form exposes.
    await page.locator('input[type="password"]').first().press('Enter');

    await page.waitForURL(/\/app\/dm/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/app\/dm/);
  });
});
