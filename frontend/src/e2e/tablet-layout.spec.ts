/**
 * Tablet layout regressions.
 *
 * A tablet is the width the viewport breakpoints guess wrong most often: the
 * sidebar is already expanded at 820px, so the content area is ~550px while
 * every `sm:`/`md:` rule believes it has the whole screen. These checks cover
 * what a tablet audit found that the unit suite cannot see, because they are
 * properties of the laid-out page.
 */

import { test, expect } from '@playwright/test';
import { mockApi, TEST_USER } from './helpers';
import { ROUTES, signInForRoute } from './mobile-routes';

const TABLETS = [
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad Pro portrait', width: 1024, height: 1366 },
];

test.describe('Reports page on a tablet', () => {
  for (const viewport of TABLETS) {
    // The reporting-period date inputs carry `w-full` from `form-input-sm` and
    // were `flex-none` from `sm` up, so each claimed the whole row and the end
    // date ran ~180px off the right edge of the screen.
    test(`does not scroll sideways — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockApi(page, { permissions: [...TEST_USER.permissions, 'reports.view'] });
      await page.goto('/login');
      await page.evaluate(() => {
        localStorage.setItem('has_session', '1');
      });

      await page.goto('/reports');
      await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({ timeout: 15_000 });
      const endDate = page.getByLabel('Reporting period end date');
      await expect(endDate).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `the page is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(0);

      const box = await endDate.boundingBox();
      if (!box) throw new Error('The end-date input has no bounding box');
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    });
  }
});

// Each of these scrolled sideways on a tablet while the phone and desktop
// passes were clean, because the sidebar leaves a tablet far less room than its
// viewport width suggests and every `sm:` rule believes it has the whole
// screen. The causes were a shared header whose title block refused to shrink,
// a wizard step bar that showed its labels from `sm`, steps that could not wrap
// their descriptions, and a `mobile-touch-target` label without `shrink-0`.
const TABLET_ROUTES = [
  '/medical-supplies',
  '/inventory/my-equipment',
  '/apparatus-basic',
  '/facilities',
  '/training/admin?page=setup&tab=pipelines',
  '/inventory/admin/setup',
  '/inventory/admin/pool',
];

test.describe('Pages do not scroll sideways on a tablet', () => {
  for (const viewport of TABLETS) {
    for (const path of TABLET_ROUTES) {
      test(`${path} — ${viewport.name}`, async ({ page }) => {
        const route = ROUTES.find((r) => r.path === path);
        if (!route) throw new Error(`${path} is not in the mobile route list`);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await signInForRoute(page, route, null);
        await page.goto(path);
        await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(400);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${path} is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(0);
      });
    }
  }
});
