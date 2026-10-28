/**
 * The shell's footer starts below the fold.
 *
 * Every page is short while its code or data loads, and the shell is a
 * full-height flex column, so the footer used to sit at the bottom of the
 * screen until the content arrived and pushed it away. That was a layout shift
 * on every route, about 0.05-0.1 on a phone under 4G and all of /events' 0.12.
 * `main` is now at least a screen tall. A page short enough to end above the
 * fold is the case that shows it, loading or not.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROUTES, signInForRoute } from './mobile-routes';

// The not-found screen renders inside the shell and is a few lines long, so it
// ends above the fold at every size, whatever the mocked data holds.
const SHORT_PAGE = '/this-page-does-not-exist';

const footerTop = async (page: Page, viewport: { width: number; height: number }) => {
  const route = ROUTES.find((r) => r.path === '/dashboard');
  if (!route) throw new Error('/dashboard is not in the mobile route list');
  await page.setViewportSize(viewport);
  await signInForRoute(page, route, null);
  await page.goto(SHORT_PAGE);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
  const box = await page.getByRole('contentinfo').boundingBox();
  if (!box) throw new Error('the shell rendered no footer');
  return box.y;
};

test.describe('The footer starts below the fold', () => {
  test.use({ hasTouch: true });

  test('phone', async ({ page }) => {
    expect(await footerTop(page, { width: 390, height: 844 })).toBeGreaterThanOrEqual(844);
  });
});

test.describe('The footer starts below the fold with a mouse', () => {
  test('desktop', async ({ page }) => {
    expect(await footerTop(page, { width: 1440, height: 900 })).toBeGreaterThanOrEqual(900);
  });
});
