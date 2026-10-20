import { test, expect } from 'playwright/test';

/**
 * Smoke: the public landing page renders and reaches the DOM without a hard
 * JS error. Catches the "white screen of death" class of regressions where a
 * build ships but the React root crashes on mount.
 */
test('landing page loads', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto('/');

  // The brand appears somewhere above the fold. We intentionally match loosely
  // so landing-page copy changes don't break the smoke.
  await expect(page.locator('body')).toContainText(/NCore/i);

  expect(consoleErrors, `Runtime errors on landing: ${consoleErrors.join('\n')}`).toEqual([]);
});
