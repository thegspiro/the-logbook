/**
 * A tab's label sits in the vertical centre of the tab.
 *
 * Underline tabs draw their active state as a bottom border, and padding on
 * one side only left the label high: Skills Testing's "Available Tests" and
 * "My Results" (pb-3 alone) sat 7.5px above centre on a laptop and in their
 * 44px touch box on a phone, unlike the Events tabs beside them in the app.
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ALL_ROUTES, signInForRoute } from './mobile-routes';

const LAPTOP = { viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };

const open = async (page: Page, path: string) => {
  const route = ALL_ROUTES.find((r) => r.path === path);
  if (!route) throw new Error(`${path} is not in the mobile route list`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInForRoute(page, route, null);
  await page.goto(path);
};

/** The label's vertical centre against the centre of the tab's border box, less its underline. */
const labelOffset = (tab: Locator) =>
  tab.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const top = Math.min(...text.map((r) => r.top));
    const bottom = Math.max(...text.map((r) => r.bottom));
    const box = el.getBoundingClientRect();
    const underline = parseFloat(getComputedStyle(el).borderBottomWidth);
    return (top + bottom) / 2 - (box.top + box.bottom - underline) / 2;
  });

for (const [name, device] of [
  ['laptop', LAPTOP],
  ['phone', PHONE],
] as const) {
  test.describe(`Underline tab labels are centred — ${name}`, () => {
    test.use(device);

    test('Skills Testing', async ({ page }) => {
      await open(page, '/training/skills-testing');
      for (const label of ['Available Tests', 'My Results']) {
        const tab = page.getByRole('navigation', { name: 'Skills Testing Tabs' }).getByRole('button', { name: label });
        await expect(tab).toBeVisible();
        expect(Math.abs(await labelOffset(tab)), label).toBeLessThanOrEqual(1);
      }
    });
  });
}
