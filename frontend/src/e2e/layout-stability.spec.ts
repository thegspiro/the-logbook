/**
 * Pages do not jump while they load.
 *
 * Two kinds of check. The first, below, is the shell's footer.
 *
 * Every page is short while its code or data loads, and the shell is a
 * full-height flex column, so the footer used to sit at the bottom of the
 * screen until the content arrived and pushed it away. That was a layout shift
 * on every route, about 0.05-0.1 on a phone under 4G and all of /events' 0.12.
 * `main` is now at least a screen tall. A page short enough to end above the
 * fold is the case that shows it, loading or not.
 *
 * The second measures the layout shift a page accumulates from navigation to
 * settled, on the routes that jumped worst: under the 0.1 Google rates good,
 * where they measured 0.11-0.57 before. Three causes, one shape of fix each:
 * a card drawn only when data says so landing above the page (the admin hubs'
 * attention queue and module-built nav, the clocked-in card), so what is under
 * it waits invisibly for the answer (useFirstLoadHold); a stats row drawn only
 * once its figures arrive, now drawn from the start with placeholders; and a
 * full-screen spinner replaced wholesale, now the page's own header with the
 * spinner where the content goes.
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
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

// Path, and the viewport it jumped at. Each fails against the code before the
// fix on the dev server CI runs these against. Inventory's hub is not here: its
// nav waits on the enabled-modules lookup, which on the dev server answers
// before the page has rendered, so the case cannot fail here —
// AdminHubFrame.test covers that hold instead.
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const LOADS: { path: string; viewport: { width: number; height: number } }[] = [
  { path: '/scheduling/admin/settings/general', viewport: DESKTOP },
  { path: '/training/admin?page=setup&tab=metrics', viewport: PHONE },
  { path: '/inventory/admin/store?tab=orders', viewport: PHONE },
  { path: '/admin-hours', viewport: PHONE },
  { path: '/documents', viewport: PHONE },
  { path: '/events/1/monitoring', viewport: PHONE },
  { path: '/admin/analytics', viewport: PHONE },
  { path: '/admin/public-portal', viewport: PHONE },
  { path: '/scheduling', viewport: PHONE },
  { path: '/admin/audit-log', viewport: PHONE },
  { path: '/training/submit', viewport: PHONE },
  { path: '/training/compliance-config', viewport: PHONE },
];

// A response held back until the placeholder drawn for it is on screen, so the
// page is measured as it is when that answer is the last to arrive. On the dev
// server it usually lands before the frame's first-load hold lets the body be
// seen, so without holding it the case passes or fails on timing.
interface LateResponse {
  url: string;
  placeholder: (page: Page) => Locator;
}

const layoutShiftOf = async (
  page: Page,
  path: string,
  viewport: { width: number; height: number },
  late?: LateResponse
) => {
  const route = ROUTES.find((r) => r.path === path);
  if (!route) throw new Error(`${path} is not in the mobile route list`);
  await page.setViewportSize(viewport);
  await signInForRoute(page, route, null);
  let release: () => void = () => undefined;
  if (late) {
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(late.url, async (handler) => {
      await held;
      await handler.fallback();
    });
  }
  await page.addInitScript(() => {
    const w = window as unknown as { __layoutShift: number };
    w.__layoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) w.__layoutShift += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(path);
  if (late) {
    await expect(late.placeholder(page)).toBeVisible();
    release();
  }
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
  return page.evaluate(() => (window as unknown as { __layoutShift: number }).__layoutShift);
};

test.describe('A page does not jump while it loads on a phone', () => {
  test.use({ hasTouch: true });

  for (const { path, viewport } of LOADS.filter((load) => load.viewport === PHONE)) {
    test(path, async ({ page }) => {
      expect(await layoutShiftOf(page, path, viewport)).toBeLessThan(0.1);
    });
  }
});

test.describe('A page does not jump while it loads on a desktop', () => {
  for (const { path, viewport } of LOADS.filter((load) => load.viewport === DESKTOP)) {
    test(path, async ({ page }) => {
      expect(await layoutShiftOf(page, path, viewport)).toBeLessThan(0.1);
    });
  }
});

// The settings screen in a hub's body loads its own data after the hub has
// shown it. Its placeholder used to be reconciled into the loaded screen, so
// the placeholder's second bar became the preview column and leapt from the
// fold to 1,400px below it: 0.35 on a phone and 0.28 on a desktop, on the runs
// where the answer came after the hub's hold let go.
const LATE: (LateResponse & { path: string; viewport: { width: number; height: number } })[] = [
  {
    path: '/training/admin?page=setup&tab=metrics',
    viewport: PHONE,
    url: '**/api/v1/admin-hub/training/metrics',
    placeholder: (page) => page.getByTestId('admin-hub-body').locator('[aria-busy="true"]'),
  },
  {
    path: '/training/admin?page=setup&tab=metrics',
    viewport: DESKTOP,
    url: '**/api/v1/admin-hub/training/metrics',
    placeholder: (page) => page.getByTestId('admin-hub-body').locator('[aria-busy="true"]'),
  },
];

test.describe('A page does not jump when its own data arrives after it is shown on a phone', () => {
  test.use({ hasTouch: true });

  for (const { path, viewport, ...late } of LATE.filter((load) => load.viewport === PHONE)) {
    test(path, async ({ page }) => {
      expect(await layoutShiftOf(page, path, viewport, late)).toBeLessThan(0.1);
    });
  }
});

test.describe('A page does not jump when its own data arrives after it is shown on a desktop', () => {
  for (const { path, viewport, ...late } of LATE.filter((load) => load.viewport === DESKTOP)) {
    test(path, async ({ page }) => {
      expect(await layoutShiftOf(page, path, viewport, late)).toBeLessThan(0.1);
    });
  }
});
