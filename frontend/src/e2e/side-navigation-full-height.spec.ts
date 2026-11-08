/**
 * The side navigation reaches the footer.
 *
 * The nav is `fixed` and sized to the viewport, so on a page taller than the
 * window the column beneath it, beside the footer, showed the page gradient:
 * the sidebar stopped short of the footer in a full-page capture. AppLayout
 * now paints the nav's background down the whole page at the width the nav
 * renders (`--side-nav-rail-width`).
 *
 * Paint cannot be read from the DOM, so this samples a full-page screenshot:
 * decoded on a canvas in the page, which needs no image library.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn } from './helpers';

const VIEWPORT = { width: 1280, height: 600 };

type Rgb = [number, number, number];

const pixelsAt = async (page: Page, points: { x: number; y: number }[]): Promise<Rgb[]> => {
  const png = (await page.screenshot({ fullPage: true })).toString('base64');
  return page.evaluate(
    async ({ data, pts }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      return pts.map(({ x, y }) => {
        const [r = 0, g = 0, b = 0] = ctx.getImageData(x, y, 1, 1).data;
        return [r, g, b] as [number, number, number];
      });
    },
    { data: png, pts: points }
  );
};

const navBackground = (page: Page): Promise<Rgb> =>
  page.evaluate(() => {
    const nav = document.getElementById('side-navigation');
    if (!nav) throw new Error('side navigation not rendered');
    const match = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(nav).backgroundColor);
    return [Number(match?.[1] ?? -1), Number(match?.[2] ?? -1), Number(match?.[3] ?? -1)] as [number, number, number];
  });

const footerRow = async (page: Page) => {
  const { docHeight, footerTop } = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    footerTop: (document.querySelector('footer')?.getBoundingClientRect().top ?? 0) + window.scrollY,
  }));
  // Without this the test passes vacuously: a page no taller than the window
  // has no column beneath the nav to leave unpainted.
  expect(docHeight).toBeGreaterThan(VIEWPORT.height);
  expect(footerTop).toBeGreaterThanOrEqual(VIEWPORT.height);
  return Math.round((footerTop + docHeight) / 2);
};

const close = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - (b[i] ?? -999)) <= 2);

test.describe('Side navigation beside the footer', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await signIn(page);
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
    await expect(page.locator('#side-navigation')).toBeVisible();
  });

  test('the expanded sidebar runs down to the footer', async ({ page }) => {
    const y = await footerRow(page);
    const nav = await navBackground(page);
    const [inRail] = await pixelsAt(page, [{ x: 40, y }]);
    expect(close(inRail ?? [0, 0, 0], nav), `beside footer ${String(inRail)}, nav ${String(nav)}`).toBe(true);
  });

  test('the collapsed rail runs down to the footer, and no wider than the rail', async ({ page }) => {
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.locator('#side-navigation')).toHaveAttribute('data-collapsed', 'true');
    const y = await footerRow(page);
    const nav = await navBackground(page);
    // 5rem rail: x=40 is inside it, x=160 is past it in the gap before the
    // content column, where the page gradient still shows.
    const [inRail, pastRail] = await pixelsAt(page, [
      { x: 40, y },
      { x: 160, y },
    ]);
    expect(close(inRail ?? [0, 0, 0], nav), `in rail ${String(inRail)}, nav ${String(nav)}`).toBe(true);
    expect(close(pastRail ?? [0, 0, 0], nav), `past rail ${String(pastRail)}`).toBe(false);
  });
});
