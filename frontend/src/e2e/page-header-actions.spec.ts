import { test, expect, type Locator, type Page } from '@playwright/test';

import { signIn } from './helpers';

/**
 * The page header's buttons on a phone, as the `page-header-actions` utility
 * in index.css lays them out: text buttons and links share each row equally,
 * two to a row when both labels fit in half of it, otherwise one to a row,
 * filling it. An icon-only button keeps its square. jsdom lays nothing out,
 * so only a browser can measure any of this.
 *
 * Facilities pairs a bordered secondary button with a borderless primary one,
 * which is the case a zero flex-basis got 2px wrong.
 */

const PERMISSIONS = ['inventory.manage', 'facilities.manage'];

function named(page: Page, name: string): Locator {
  return page
    .getByRole('main')
    .getByRole('link', { name, exact: true })
    .or(page.getByRole('main').getByRole('button', { name, exact: true }))
    .first();
}

/**
 * The boxes of several elements, read in one pass inside the page.
 *
 * Each test here compares two elements' positions, and two `boundingBox()`
 * calls are two moments. On 2026-11-22 the inventory header moved down a row
 * between them in Mobile Safari (run 45042745609): the text button read
 * y=240, the icon beside it y=296, and the same test passed on its retry,
 * which fails the job. Read together, both boxes come from one layout, so a
 * page that is still settling moves both or neither.
 */
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxes(page: Page, first: Locator, second: Locator): Promise<[Box, Box]> {
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const handles = [await first.elementHandle(), await second.elementHandle()] as const;
  return page.evaluate(([a, b]) => {
    const measure = (element: SVGElement | HTMLElement | null): Box => {
      if (!element) throw new Error('an element left the page before it was measured');
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: rect.height };
    };
    return [measure(a), measure(b)] as [Box, Box];
  }, handles);
}

async function open(page: Page, path: string, width: number, extra: string[] = []) {
  await page.setViewportSize({ width, height: 844 });
  await signIn(page, { permissions: [...PERMISSIONS, ...extra] });
  await page.goto(path);
}

test.describe('page header buttons on a phone', () => {
  test('two that fit share one row at exactly the same width', async ({ page }) => {
    await open(page, '/facilities', 390);
    const [settings, add] = await boxes(page, named(page, 'Facility Settings'), named(page, 'Add Facility'));

    expect(add.y).toBe(settings.y);
    expect(add.width).toBe(settings.width);
  });

  test('two that do not fit take a full-width row each', async ({ page }) => {
    await open(page, '/facilities', 320);
    const [settings, add] = await boxes(page, named(page, 'Facility Settings'), named(page, 'Add Facility'));

    expect(add.y).toBeGreaterThan(settings.y);
    expect(add.width).toBe(settings.width);
    expect(add.x).toBe(settings.x);
  });

  test('a label longer than half the row moves its partner to a row of its own', async ({ page }) => {
    // "Card Readers" needs more than half of a 320px screen's row; split
    // anyway, it sat 149px wide beside a 116px "Print All".
    await open(page, '/locations/qr-codes', 320);
    const [readers, print] = await boxes(page, named(page, 'Card Readers'), named(page, 'Print All'));

    expect(print.y).toBeGreaterThan(readers.y);
    expect(print.width).toBe(readers.width);
  });

  test('an icon-only button keeps its square beside a text button that fills the rest', async ({ page }) => {
    await open(page, '/inventory', 390);
    const more = page.locator('.page-header-actions > .btn-icon-sm').first();
    const [admin, icon] = await boxes(page, named(page, 'Administration'), more);

    expect(icon.width).toBe(44);
    expect(icon.y).toBe(admin.y);
    expect(admin.width).toBeGreaterThan(200);
  });

  test("a manager's Elections header keeps Create Election beside help, with the pages in their own row", async ({
    page,
  }) => {
    // Settings and attendance were buttons here — the first an unlabelled gear
    // officers missed. They are now named links in the Elections pages row, so
    // the header is the help icon and Create Election alone. Only managers see
    // either, so the grant is what puts them on the page at all.
    await open(page, '/elections', 390, ['elections.manage']);
    const create = page.getByRole('main').getByRole('button', { name: 'Create Election' });
    const help = page.getByRole('main').getByRole('button', { name: 'Help: elections' });
    const [createBox, helpBox] = await boxes(page, create, help);
    const middle = (b: Box) => b.y + b.height / 2;

    // The help icon sits on Create Election's row and Create Election takes
    // the rest of it.
    expect(Math.abs(middle(helpBox) - middle(createBox))).toBeLessThanOrEqual(2);
    expect(createBox.width).toBeGreaterThan(200);

    const pages = page.getByRole('navigation', { name: 'Elections pages' });
    await expect(pages.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(pages.getByRole('link', { name: 'Meeting Attendance' })).toBeVisible();
  });
});

test('on a laptop the buttons keep their own widths', async ({ page }) => {
  await open(page, '/facilities', 1280);
  const [settings, add] = await boxes(page, named(page, 'Facility Settings'), named(page, 'Add Facility'));

  // One row: the bordered secondary sits a pixel off the primary's top on a
  // laptop, where neither is stretched to the 44px touch height.
  expect(Math.abs(add.y - settings.y)).toBeLessThanOrEqual(1);
  expect(add.x).toBeGreaterThan(settings.x);
  expect(add.width).not.toBe(settings.width);
});
