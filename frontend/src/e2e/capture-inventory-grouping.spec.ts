import { test, expect, type Page } from '@playwright/test';

import { json, signIn } from './helpers';

/**
 * Captures the documentation images for grouping the inventory items list.
 *
 * A capture utility, not a test: it asserts only enough to be sure it
 * photographed the right thing, and is excluded from the normal E2E run by the
 * `@screenshots` tag. Regenerate with
 *   npm run generate:screenshots
 *
 * It drives the real UI against the same mocked API the E2E suite uses, so the
 * images are the application actually rendering — not a mockup that will
 * quietly stop matching the screen.
 */

const GROUP_OUT = '../docs/images/inventory-grouping';
const WIDE = { width: 1280, height: 900 };

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
}

const item = (seed: ItemSeed) => ({
  id: seed.id,
  organization_id: 'org-1',
  name: seed.name,
  category_id: 'cat-uniform',
  condition: 'good',
  status: 'available',
  tracking_type: 'pool',
  quantity: 5,
  quantity_issued: 0,
  size: seed.size ?? null,
  standard_size: seed.size ?? null,
  color: 'Navy',
  storage_location: "Quartermaster's Storage",
  active: true,
  pin_position: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

/** Let fonts and entry animations settle so nothing is caught mid-fade. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

const CLASS_A = {
  id: 'cat-a',
  organization_id: 'org-1',
  name: 'Class A Uniform',
  item_type: 'uniform',
  requires_assignment: false,
  requires_serial_number: false,
  requires_maintenance: false,
  nfpa_tracking_enabled: false,
  active: true,
};

/** Two categories and a colour spread, so grouping has something to show. */
const MIXED = [
  { ...item({ id: 'a-coat', name: 'Dress Coat' }), category_id: 'cat-a' },
  { ...item({ id: 'a-trousers', name: 'Dress Trousers' }), category_id: 'cat-a' },
  { ...item({ id: 'b-ls-m', name: 'Long Sleeve', size: 'm' }), category_id: 'cat-uniform' },
  { ...item({ id: 'b-ls-l', name: 'Long Sleeve', size: 'l' }), category_id: 'cat-uniform' },
  { ...item({ id: 'b-ss-m', name: 'Short Sleeve', size: 'm' }), category_id: 'cat-uniform' },
];

const MIXED_GROUPS = [
  { key: 'cat-a', label: 'Class A Uniform', available_count: 2, unavailable_count: 0 },
  { key: 'cat-uniform', label: 'Class B Uniform', available_count: 3, unavailable_count: 0 },
];

test.describe('@screenshots inventory grouping', () => {
  test.use({ viewport: WIDE });

  async function openGrouped(page: Page) {
    await signIn(page, { permissions: ['inventory.view', 'inventory.manage', 'admin.access'] });
    await page.route('**/api/v1/inventory/categories**', (route) => route.fulfill(json([UNIFORM_CATEGORY, CLASS_A])));
    await page.route('**/api/v1/inventory/items**', (route) => {
      const grouped = route.request().url().includes('group_by=');
      return route.fulfill(json({ items: MIXED, total: MIXED.length, groups: grouped ? MIXED_GROUPS : [] }));
    });
    await page.route('**/api/v1/inventory/items/colors**', (route) => route.fulfill(json(['Navy'])));
    await page.route('**/api/v1/inventory/summary', (route) =>
      route.fulfill(
        json({
          total_items: MIXED.length,
          non_medical_items: MIXED.length,
          items_by_status: {},
          items_by_condition: {},
          items_by_type: {},
          total_value: 940,
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

  test('grouped by category', async ({ page }) => {
    await openGrouped(page);
    await page.getByLabel('Group by:').selectOption('category');
    await settle(page);

    await expect(page.getByRole('button', { name: /Class A Uniform/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Class B Uniform/ })).toBeVisible();
    await page.screenshot({ path: `${GROUP_OUT}/01-grouped-by-category.png` });
  });

  test('a collapsed group still states its total', async ({ page }) => {
    await openGrouped(page);
    await page.getByLabel('Group by:').selectOption('category');
    await settle(page);

    await page.getByRole('button', { name: /Class A Uniform/ }).click();
    await settle(page);
    // The header must keep its count while collapsed — that is the whole
    // point of counting server-side rather than tallying loaded rows.
    await expect(page.getByRole('button', { name: /Class A Uniform/ })).toHaveAttribute('aria-expanded', 'false');
    await page.screenshot({ path: `${GROUP_OUT}/02-collapsed-group.png` });
  });
});
