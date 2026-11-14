import { test, expect, type Page } from '@playwright/test';

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

async function box(page: Page, name: string) {
  const target = page
    .getByRole('main')
    .getByRole('link', { name, exact: true })
    .or(page.getByRole('main').getByRole('button', { name, exact: true }));
  await expect(target.first()).toBeVisible();
  const rect = await target.first().boundingBox();
  if (!rect) throw new Error(`${name} has no box`);
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
}

async function open(page: Page, path: string, width: number, extra: string[] = []) {
  await page.setViewportSize({ width, height: 844 });
  await signIn(page, { permissions: [...PERMISSIONS, ...extra] });
  await page.goto(path);
}

test.describe('page header buttons on a phone', () => {
  test('two that fit share one row at exactly the same width', async ({ page }) => {
    await open(page, '/facilities', 390);
    const settings = await box(page, 'Facility Settings');
    const add = await box(page, 'Add Facility');

    expect(add.y).toBe(settings.y);
    expect(add.width).toBe(settings.width);
  });

  test('two that do not fit take a full-width row each', async ({ page }) => {
    await open(page, '/facilities', 320);
    const settings = await box(page, 'Facility Settings');
    const add = await box(page, 'Add Facility');

    expect(add.y).toBeGreaterThan(settings.y);
    expect(add.width).toBe(settings.width);
    expect(add.x).toBe(settings.x);
  });

  test('a label longer than half the row moves its partner to a row of its own', async ({ page }) => {
    // "Card Readers" needs more than half of a 320px screen's row; split
    // anyway, it sat 149px wide beside a 116px "Print All".
    await open(page, '/locations/qr-codes', 320);
    const readers = await box(page, 'Card Readers');
    const print = await box(page, 'Print All');

    expect(print.y).toBeGreaterThan(readers.y);
    expect(print.width).toBe(readers.width);
  });

  test('an icon-only button keeps its square beside a text button that fills the rest', async ({ page }) => {
    await open(page, '/inventory', 390);
    const admin = await box(page, 'Administration');
    const more = page.locator('.page-header-actions > .btn-icon-sm').first();
    await expect(more).toBeVisible();
    const icon = await more.boundingBox();

    expect(Math.round(icon?.width ?? 0)).toBe(44);
    expect(Math.round(icon?.y ?? -1)).toBe(admin.y);
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
    await expect(create).toBeVisible();
    await expect(help).toBeVisible();
    const createBox = await create.boundingBox();
    const helpBox = await help.boundingBox();
    const middle = (b: { y: number; height: number } | null) => (b ? b.y + b.height / 2 : -1);

    // The help icon sits on Create Election's row and Create Election takes
    // the rest of it.
    expect(Math.abs(middle(helpBox) - middle(createBox))).toBeLessThanOrEqual(2);
    expect(createBox?.width ?? 0).toBeGreaterThan(200);

    const pages = page.getByRole('navigation', { name: 'Elections pages' });
    await expect(pages.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(pages.getByRole('link', { name: 'Meeting Attendance' })).toBeVisible();
  });
});

test('on a laptop the buttons keep their own widths', async ({ page }) => {
  await open(page, '/facilities', 1280);
  const settings = await box(page, 'Facility Settings');
  const add = await box(page, 'Add Facility');

  // One row: the bordered secondary sits a pixel off the primary's top on a
  // laptop, where neither is stretched to the 44px touch height.
  expect(Math.abs(add.y - settings.y)).toBeLessThanOrEqual(1);
  expect(add.x).toBeGreaterThan(settings.x);
  expect(add.width).not.toBe(settings.width);
});
