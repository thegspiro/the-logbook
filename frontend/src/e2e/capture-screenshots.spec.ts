import { test } from '@playwright/test';

import { gotoDashboard, signIn } from './helpers';

/**
 * Captures the `screenshots` images referenced by the web app manifest.
 *
 * These are what Android shows in the richer install dialog instead of the
 * minimal card. The manifest needs at least one `narrow` (phone) and one `wide`
 * (desktop) entry, and each declared size must match the file exactly.
 *
 * This is a capture utility, not a test: it asserts nothing and is excluded
 * from the normal E2E run by the `@screenshots` tag. Regenerate with
 *   npx playwright test --grep @screenshots
 * and commit the resulting PNGs. It drives the real UI against the same mocked
 * API the E2E suite uses, so the images show the actual application rendering
 * the project's existing demo fixtures rather than a mockup.
 */

// Relative to the Playwright cwd (frontend/). Deliberately avoids node's
// `path`/`url`, which are not in this project's tsconfig `types`.
const OUT = 'public/screenshots';

// Must match the manifest entries in vite.config.ts.
const NARROW = { width: 390, height: 844 }; // iPhone 14/15 class
const WIDE = { width: 1280, height: 800 };

/** Let fonts, icons and entry animations settle so nothing is caught mid-fade. */
async function settle(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

test.describe('@screenshots manifest capture', () => {
  test('narrow — dashboard', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await gotoDashboard(page);
    await settle(page);
    await page.screenshot({ path: `${OUT}/narrow-dashboard.png` });
  });

  test('narrow — training', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await signIn(page);
    await page.goto('/training/my-training');
    await settle(page);
    await page.screenshot({ path: `${OUT}/narrow-training.png` });
  });

  test('wide — dashboard', async ({ page }) => {
    await page.setViewportSize(WIDE);
    await gotoDashboard(page);
    await settle(page);
    await page.screenshot({ path: `${OUT}/wide-dashboard.png` });
  });
});
