import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Every route must survive a degraded API and fit a phone.
 *
 * The mock in helpers.ts answers unmatched endpoints with a permissive
 * catch-all, so each page here is rendering against payloads that do not match
 * what its service layer declares. That is the point: `api.get<T[]>` asserts a
 * wire format rather than verifying it, and a page that maps or measures the
 * result unchecked dies through the ErrorBoundary instead of rendering empty.
 * On a phone that failure is realistic — a captive portal on station Wi-Fi or a
 * carrier interception page answers HTTP 200 with an HTML body.
 *
 * Ten routes were crashing when this was written. Adding a route here is the
 * cheapest way to keep a whole page from silently regressing to a dead screen.
 */
const ROUTES = [
  '/dashboard',
  '/events',
  '/members',
  '/members/admin',
  '/documents',
  '/training/my-training',
  '/training/submit',
  '/training/courses',
  '/training/programs',
  '/scheduling',
  '/scheduling/reports',
  '/admin-hours',
  '/notifications?tab=inbox',
  '/inventory',
  '/inventory/my-equipment',
  '/apparatus',
  '/apparatus-basic',
  '/locations',
  '/facilities',
  '/elections',
  '/minutes',
  '/action-items',
  '/forms',
  '/store',
  '/prospective-members',
  '/analytics',
  '/messages',
  '/settings',
  '/profile',
];

test.describe('mobile resilience', () => {
  test('every route renders on a phone without crashing or overflowing', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 390, height: 844 }); // iPhone 14/15 class
    await signIn(page);

    const crashed: string[] = [];
    const overflowed: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(400);

      const result = await page.evaluate(() => {
        const doc = document.documentElement;
        return {
          crashed: document.body.innerText.includes('Oops! Something went wrong'),
          // A horizontally scrolling page on a phone means something is wider
          // than the viewport — a fixed pixel width, an unwrapped row, a table
          // with no scroll container.
          overflow: doc.scrollWidth > doc.clientWidth + 1,
        };
      });

      if (result.crashed) crashed.push(route);
      if (result.overflow) overflowed.push(route);
    }

    expect(crashed, 'routes that hit the ErrorBoundary').toEqual([]);
    expect(overflowed, 'routes wider than a 390px viewport').toEqual([]);
  });
});
