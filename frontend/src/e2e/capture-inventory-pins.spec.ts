import { test, expect, type Page } from '@playwright/test';

import { json, signIn } from './helpers';

/**
 * Captures the documentation images for the pinned shortlist on the items list.
 *
 * A capture utility, not a test: it asserts only enough to be sure it
 * photographed the right thing, and is excluded from the normal E2E run by the
 * `@screenshots` tag. Regenerate with
 *   npm run generate:screenshots
 *
 * It drives the real UI against the same mocked API the E2E suite uses, so the
 * images are the application actually rendering — not a mockup that will
 * quietly stop matching the screen the first time somebody moves a control.
 */

const OUT = '../docs/images/inventory-pins';
const WIDE = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

const UNIFORM_CATEGORY = {
  id: 'cat-uniform',
  organization_id: 'org-1',
  name: 'Class B Uniform',
  item_type: 'uniform',
  requires_assignment: false,
  requires_serial_number: false,
  requires_maintenance: false,
  nfpa_tracking_enabled: false,
  active: true,
};

interface ItemSeed {
  id: string;
  name: string;
  size?: string;
  status?: string;
  pin?: number;
}

const item = (seed: ItemSeed) => ({
  id: seed.id,
  organization_id: 'org-1',
  name: seed.name,
  category_id: 'cat-uniform',
  condition: 'good',
  status: seed.status ?? 'available',
  tracking_type: 'pool',
  quantity: 5,
  quantity_issued: 0,
  size: seed.size ?? null,
  standard_size: seed.size ?? null,
  color: 'Navy',
  storage_location: "Quartermaster's Storage",
  active: true,
  pin_position: seed.pin ?? null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

/** The stock a department actually keeps, in the order the API would return it. */
const UNPINNED = [
  item({ id: 'i-belt', name: 'Duty Belt' }),
  item({ id: 'i-cap', name: 'Job Shirt' }),
  item({ id: 'i-ls-l', name: 'Long Sleeve', size: 'l' }),
  item({ id: 'i-ls-m', name: 'Long Sleeve', size: 'm' }),
  item({ id: 'i-ls-xl', name: 'Long Sleeve', size: 'xl' }),
  item({ id: 'i-parade', name: 'Parade Jacket', status: 'maintenance' }),
  item({ id: 'i-ss-l', name: 'Short Sleeve', size: 'l' }),
  item({ id: 'i-ss-m', name: 'Short Sleeve', size: 'm' }),
];

/** The same shelf once the quartermaster has fronted their working set. */
const PINNED = [
  item({ id: 'i-ss-m', name: 'Short Sleeve', size: 'm', pin: 0 }),
  item({ id: 'i-ls-m', name: 'Long Sleeve', size: 'm', pin: 1 }),
  item({ id: 'i-belt', name: 'Duty Belt', pin: 2 }),
  ...UNPINNED.filter((i) => !['i-ss-m', 'i-ls-m', 'i-belt'].includes(i.id)),
];

/** Let fonts and entry animations settle so nothing is caught mid-fade. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

async function openInventory(page: Page, items: unknown[]) {
  await signIn(page, { permissions: ['inventory.view', 'inventory.manage', 'admin.access'] });
  await page.route('**/api/v1/inventory/categories**', (route) => route.fulfill(json([UNIFORM_CATEGORY])));
  // Order matters: Playwright matches the LAST registered route first, and
  // `items**` also matches `items/colors`. Registering the general one first
  // lets the specific one win — otherwise the colour filter receives the item
  // list object and the page renders nothing.
  await page.route('**/api/v1/inventory/items**', (route) => route.fulfill(json({ items, total: items.length })));
  await page.route('**/api/v1/inventory/items/colors**', (route) => route.fulfill(json(['Navy'])));
  // Without these the header stats render as bare labels with no figures,
  // which photographs as a broken page rather than as the feature.
  await page.route('**/api/v1/inventory/summary', (route) =>
    route.fulfill(
      json({
        total_items: items.length,
        non_medical_items: items.length,
        items_by_status: {},
        items_by_condition: {},
        items_by_type: {},
        total_value: 1275,
        active_checkouts: 0,
        overdue_checkouts: 0,
        maintenance_due_count: 0,
      })
    )
  );
  await page.route('**/api/v1/inventory/summary/by-location**', (route) => route.fulfill(json([])));
  await page.goto('/inventory/admin/items');
  await settle(page);
}

test.describe('@screenshots inventory pinned shortlist', () => {
  test.describe('desktop', () => {
    test.use({ viewport: WIDE });

    test('before — one flat alphabetical list', async ({ page }) => {
      await openInventory(page, UNPINNED);

      await expect(page.getByRole('heading', { name: /^Available$/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: /^Pinned$/ })).toHaveCount(0);
      await page.screenshot({ path: `${OUT}/01-before-flat-list.png` });
    });

    test('after — the working set fronted', async ({ page }) => {
      await openInventory(page, PINNED);

      // The point of the image: the three items this quartermaster actually
      // moves, above the rest of the shelf, in their own order.
      await expect(page.getByRole('heading', { name: /^Pinned$/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Unpin/ }).first()).toBeVisible();
      await page.screenshot({ path: `${OUT}/02-after-pinned-section.png` });
    });

    test('the reorder controls on a pinned row', async ({ page }) => {
      await openInventory(page, PINNED);

      const heading = page.getByRole('heading', { name: /^Pinned$/ });
      await expect(heading).toBeVisible();
      // Move up is disabled on the front row and enabled below it — the
      // affordance the image is meant to show.
      await expect(page.getByRole('button', { name: /Move .* up/i }).first()).toBeDisabled();
      await page
        .locator('table')
        .first()
        .screenshot({ path: `${OUT}/03-reorder-controls.png` });
    });

    test('the pin toggle on an unpinned row', async ({ page }) => {
      await openInventory(page, UNPINNED);

      const pin = page.getByRole('button', { name: /^Pin / }).first();
      await expect(pin).toBeVisible();
      await pin.hover();
      await settle(page);
      await page
        .locator('table')
        .first()
        .screenshot({ path: `${OUT}/04-pin-toggle.png` });
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: PHONE });

    test('pinned cards with the arrow controls', async ({ page }) => {
      // HTML5 drag events never fire on touch, so on a phone the arrows are
      // the only way to reorder — worth photographing on its own.
      await openInventory(page, PINNED);

      const heading = page.getByRole('heading', { name: /^Pinned$/ });
      await expect(heading).toBeVisible();
      // The filter stack is two screens tall on a phone, so an unscrolled
      // shot photographs the filters and none of the feature.
      await heading.scrollIntoViewIfNeeded();
      await settle(page);
      await page.screenshot({ path: `${OUT}/05-mobile-pinned.png` });
    });
  });
});
