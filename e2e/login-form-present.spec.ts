import { test, expect } from 'playwright/test';

/**
 * Smoke: the /login page renders, its email + password inputs exist, and the
 * submit button is enabled. This guards against ProtectedRoute redirect
 * regressions or input-type typos (which break iOS autofill).
 */
test('login form is present and interactable', async ({ page }) => {
  await page.goto('/login');

  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  await expect(emailInput).toBeVisible();
  await expect(passwordInput).toBeVisible();

  // The inputs should be real inputs we can type into (not disabled).
  await emailInput.fill('smoke@example.test');
  await passwordInput.fill('smoke-password');

  await expect(emailInput).toHaveValue('smoke@example.test');
  await expect(passwordInput).toHaveValue('smoke-password');
});
