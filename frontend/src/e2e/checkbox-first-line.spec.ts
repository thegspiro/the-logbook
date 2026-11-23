/**
 * A checkbox sits beside its label's first line, and a one-line row is unmoved.
 *
 * Choice rows are `<label class="flex items-center">` with the checkbox first.
 * Centring put the box between the lines once the text wrapped: "Notify members
 * when they become non-compliant" wraps at 390px and its box sat 11px below the
 * first line; the Create Form dialog's options, a bold title over a
 * description, were 18px off on a laptop. index.css now pins the box to the
 * first line (see "A checkbox or radio sits beside its label's first line").
 *
 * The third case holds the other half of that rule: a row that fits on one line
 * must look exactly as it did, centred in its 44px touch-target label on a
 * phone and level with its text everywhere.
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ALL_ROUTES, signInForRoute } from './mobile-routes';

const PHONE = { width: 390, height: 844 };
const LAPTOP = { width: 1280, height: 900 };

const open = async (page: Page, path: string, viewport: { width: number; height: number }) => {
  const route = ALL_ROUTES.find((r) => r.path === path);
  if (!route) throw new Error(`${path} is not in the mobile route list`);
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInForRoute(page, route, null);
  await page.goto(path);
};

/** Vertical centres, in px: the checkbox, the row's first text line, the row box, and its line count. */
const measure = (label: Locator) =>
  label.evaluate((el) => {
    const box = el.querySelector('input[type="checkbox"], input[type="radio"]');
    if (!box) throw new Error('row holds no checkbox');
    const lines: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('.sr-only')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      lines.push(...[...range.getClientRects()].filter((r) => r.width > 1));
    }
    const first = lines[0];
    if (!first) throw new Error('row has no visible text');
    const tops = new Set(lines.map((r) => Math.round(r.top)));
    const centre = (r: DOMRect) => (r.top + r.bottom) / 2;
    return {
      box: centre(box.getBoundingClientRect()),
      firstLine: centre(first),
      label: centre(el.getBoundingClientRect()),
      lines: tops.size,
    };
  });

test.describe('Checkbox beside the first line of its label', () => {
  test('a label that wraps on a phone', async ({ page }) => {
    await open(page, '/training/compliance-config', PHONE);
    const label = page.locator('label', { hasText: 'Notify members when they become non-compliant' });
    await label.scrollIntoViewIfNeeded();
    const m = await measure(label);
    // Without a wrap there is nothing to test: centring and first-line alignment agree.
    expect(m.lines, 'the label no longer wraps at 390px').toBeGreaterThan(1);
    expect(Math.abs(m.box - m.firstLine), `box ${m.box}, first line ${m.firstLine}`).toBeLessThanOrEqual(2);
  });

  test('a bold title over a description, on a laptop', async ({ page }) => {
    await open(page, '/forms', LAPTOP);
    await page.getByRole('button', { name: 'Create Form' }).first().click();
    const dialog = page.getByRole('dialog');
    // Public Form's checkbox is a sibling of its <label for>, inside one row.
    const rows = {
      'Public Form': dialog.locator('div:has(> #is_public)'),
      'One submission per person': dialog.locator('label[for="create-one-per-person"]'),
    };
    for (const [title, row] of Object.entries(rows)) {
      const m = await measure(row);
      expect(m.lines, `${title} has no description line`).toBeGreaterThan(1);
      expect(Math.abs(m.box - m.firstLine), `${title}: box ${m.box}, title ${m.firstLine}`).toBeLessThanOrEqual(2);
    }
  });

  for (const [name, viewport] of [
    ['phone', PHONE],
    ['laptop', LAPTOP],
  ] as const) {
    test(`a one-line row is unmoved — ${name}`, async ({ page }) => {
      await open(page, '/action-items', viewport);
      const label = page.locator('label', { hasText: 'Assigned to me' });
      await label.scrollIntoViewIfNeeded();
      const m = await measure(label);
      expect(m.lines).toBe(1);
      expect(Math.abs(m.box - m.firstLine), `box ${m.box}, text ${m.firstLine}`).toBeLessThanOrEqual(1);
      // Centred in the label, which is 44px tall on a phone for its touch target.
      expect(Math.abs(m.firstLine - m.label), `text ${m.firstLine}, label ${m.label}`).toBeLessThanOrEqual(1);
    });
  }
});
