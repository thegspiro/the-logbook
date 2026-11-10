/**
 * The side navigation reaches the footer, and the content meets it.
 *
 * The nav is `fixed` and sized to the viewport, so on a page taller than the
 * window the column beneath it, beside the footer, showed the page gradient:
 * the sidebar stopped short of the footer in a full-page capture. AppLayout
 * now paints the nav's background down the whole page at `--side-nav-width`,
 * the width the nav occupies, and offsets the content column by the same
 * variable, so collapsing the rail no longer leaves a stripe beside it.
 *
 * Paint cannot be read from the DOM, so this samples a full-page screenshot:
 * decoded on a canvas in the page, which needs no image library.
 *
 * Each block declares its device rather than resizing whichever project runs
 * it. Under the Mobile Safari project (an iPhone 12 profile) a desktop-sized
 * `setViewportSize` still laid the page out at phone width in WebKit, so the
 * rail's toggle never rendered; and that profile's 3x device scale put a
 * CSS-pixel sample on the wrong part of a device-scale screenshot. A mouse-
 * driven desktop context, and a `scale: 'css'` screenshot, hold on every
 * project and engine.
 *
 * Layout is measured settled, under reduced motion, as mobile-presentation.spec.ts
 * does for the same nav's slide. Under WebKit the rail's 300ms width transition
 * was still reporting the expanded 256px edge five seconds after the collapse,
 * and the Expand toggle inside it never counted as stable enough to click. The
 * global reduced-motion rule in index.css only shortens a transition to
 * 0.01ms, and WebKit did not finish even that one on the rail, so the rail now
 * drops its transition under reduced motion (`motion-reduce:transition-none`),
 * as the content column beside it already did. styles/sideNavInset.test.ts pins
 * both.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signIn } from './helpers';

const VIEWPORT = { width: 1280, height: 600 };
const PHONE = { width: 390, height: 844 };

type Rgb = [number, number, number];

const pixelsAt = async (page: Page, points: { x: number; y: number }[]): Promise<Rgb[]> => {
  const png = (await page.screenshot({ fullPage: true, scale: 'css' })).toString('base64');
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

const contentLeft = (page: Page) =>
  page.evaluate(() => document.getElementById('main-content')?.getBoundingClientRect().left ?? -1);

test.describe('Side navigation beside the footer', () => {
  test.use({ viewport: VIEWPORT, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
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

  test('the collapsed rail runs down to the footer, and the content meets it', async ({ page }) => {
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect(page.locator('#side-navigation')).toHaveAttribute('data-collapsed', 'true');

    // The content column starts where the 5rem rail ends — not at the 16rem
    // the expanded nav needs, which left an empty stripe beside the rail. Polled
    // so a slow runner's style recalculation is not mistaken for a failure.
    const edges = () =>
      page.evaluate(() => ({
        rail: document.getElementById('side-navigation')?.getBoundingClientRect().right ?? -1,
        content: document.getElementById('main-content')?.getBoundingClientRect().left ?? -1,
      }));
    await expect.poll(async () => (await edges()).rail).toBe(80);
    await expect.poll(async () => (await edges()).content).toBe(80);

    const y = await footerRow(page);
    const nav = await navBackground(page);
    // The strip's width is the same variable as the content offset checked
    // above, so sampling inside the rail is what is left to prove.
    const [inRail] = await pixelsAt(page, [{ x: 40, y }]);
    expect(close(inRail ?? [0, 0, 0], nav), `in rail ${String(inRail)}, nav ${String(nav)}`).toBe(true);
  });

  test('expanding the rail again gives the content back its 16rem offset', async ({ page }) => {
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect.poll(() => contentLeft(page)).toBe(256);
  });
});

test.describe('Side navigation on a phone', () => {
  // Below 768px the nav is an off-canvas drawer: the content runs edge to edge
  // and no strip is painted, collapsed state or not.
  test.use({ viewport: PHONE, hasTouch: true });

  test('the content is not offset and no strip is reserved', async ({ page }) => {
    await signIn(page);
    await page.goto('/scheduling');
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
    await expect(page.locator('#main-content')).toBeVisible();
    expect(await contentLeft(page)).toBe(0);
    const inset = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.has-side-nav') ?? document.body)
        .getPropertyValue('--side-nav-width')
        .trim()
    );
    expect(inset).toBe('0px');
  });
});
