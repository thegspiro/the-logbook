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

  test('an icon-only link a manager is shown stays square', async ({ page }) => {
    // The Elections settings link sits straight in the header and was styled
    // by hand, without btn-icon-sm; the rule above stretched it across the
    // row. Only managers see it, so a fixture without the grant never did.
    await open(page, '/elections', 390, ['elections.manage']);
    const settings = page.getByRole('link', { name: 'Election settings' });
    await expect(settings).toBeVisible();
    const rect = await settings.boundingBox();

    expect(Math.round(rect?.width ?? 0)).toBe(44);
    expect(Math.round(rect?.height ?? 0)).toBe(44);
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
