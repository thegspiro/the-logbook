import { test, expect, type Page } from '@playwright/test';

import { TEST_USER, signIn } from './helpers';

/**
 * The buttons in the evaluation pages' header. On a phone they stack, and each
 * takes the full width so the pair reads as one block — before, each kept its
 * own width and "New review period" sat beside nothing, shorter than "New
 * template" under it. From `sm` up they return to their own width, side by
 * side. jsdom lays nothing out, so only a browser can measure this.
 */

const PERMISSIONS = [
  ...TEST_USER.permissions,
  'evaluations.manage',
  'evaluations.configure',
  'evaluations.conduct',
  'evaluations.view_all',
];

const PAGES = [
  { path: '/reports/evaluations', buttons: ['New review period', 'New template'] },
  { path: '/reports/evaluations/conduct', buttons: ['Draft a review period', 'New evaluation'] },
];

async function widths(page: Page, names: string[]): Promise<number[]> {
  return Promise.all(
    names.map(async (name) => {
      const button = page.getByRole('button', { name, exact: true }).first();
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      return Math.round(box?.width ?? 0);
    })
  );
}

for (const { path, buttons } of PAGES) {
  test.describe(path, () => {
    for (const width of [320, 390]) {
      test(`header buttons share one width on a ${width}px phone`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await signIn(page, { permissions: PERMISSIONS });
        await page.goto(path);

        const [first, second] = await widths(page, buttons);
        expect(first).toBeGreaterThan(0);
        expect(first).toBe(second);
      });
    }

    test('header buttons keep their own width beside each other on a laptop', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await signIn(page, { permissions: PERMISSIONS });
      await page.goto(path);

      const [first, second] = await widths(page, buttons);
      expect(first).not.toBe(second);
      // Side by side: the second starts above where the first ends. Their tops
      // need not match to the pixel — a primary and a secondary button differ
      // by a border.
      const [a, b] = await Promise.all(
        buttons.map((name) => page.getByRole('button', { name, exact: true }).first().boundingBox())
      );
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(b?.y ?? Infinity).toBeLessThan((a?.y ?? 0) + (a?.height ?? 0));
      expect(b?.x ?? 0).toBeGreaterThan(a?.x ?? 0);
    });
  });
}
