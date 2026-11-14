/**
 * Layout defects found by sweeping every route at sixteen phone, tablet and
 * desktop viewports, portrait and landscape. Each one rendered cleanly at the
 * widths the other passes measure (390, 320, 844x390) and broke only at a size
 * between them, so each is pinned here at the size where it broke.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROUTES, signInForRoute } from './mobile-routes';

const open = async (page: Page, path: string) => {
  const route = ROUTES.find((r) => r.path === path);
  if (!route) throw new Error(`${path} is not in the mobile route list`);
  await signInForRoute(page, route, null);
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
};

test.describe('Locations header on an iPad in portrait', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test('keeps the header actions inside the viewport', async ({ page }) => {
    await open(page, '/locations');
    // With the sidebar open the content column is ~510px. The header went to a
    // row at `sm:` with an unshrinkable action group, which pushed "Card
    // Readers" 14px past the edge.
    const readers = page.getByRole('link', { name: 'Card Readers' });
    await expect(readers).toBeVisible();
    const box = await readers.boundingBox();
    if (!box) throw new Error('Card Readers link has no bounding box');
    expect(box.x + box.width, 'right edge of Card Readers').toBeLessThanOrEqual(768);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, 'horizontal page overflow').toBeLessThanOrEqual(0);
  });
});

test.describe('Finance KPI tiles on the narrowest phone', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });

  test('gives each label room to clear the chevron', async ({ page }) => {
    await open(page, '/finance');
    // Two tiles share 320px; beside the icon and chevron a label had ~30px and
    // "Budgeted" ran underneath the chevron. Measured as: no label's text box
    // overlaps its own tile's chevron.
    const overlaps = await page.evaluate(() => {
      const hits: string[] = [];
      for (const label of ['Total Budgeted', 'Total Spent', 'Dues Collection']) {
        const p = Array.from(document.querySelectorAll('p')).find((el) => el.textContent?.trim() === label);
        const tile = p?.closest('.card');
        const chevron = tile?.querySelector('svg.lucide-chevron-right');
        if (!p || !chevron) {
          hits.push(`${label}: not rendered`);
          continue;
        }
        const range = document.createRange();
        range.selectNodeContents(p);
        const text = range.getBoundingClientRect();
        const icon = chevron.getBoundingClientRect();
        const apart =
          text.right <= icon.left || icon.right <= text.left || text.bottom <= icon.top || icon.bottom <= text.top;
        if (!apart) hits.push(label);
      }
      return hits;
    });
    expect(overlaps).toEqual([]);
  });
});
