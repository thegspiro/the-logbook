import { test, expect, type Page } from '@playwright/test';

import { json, signIn } from './helpers';

/**
 * Captures the training-document images for the garment style axes.
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

const OUT = '../docs/images/inventory-style-axes';
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

const POLO = {
  id: 'item-polo',
  organization_id: 'org-1',
  name: "Dept Polo — M — Navy — Men's Long Sleeve Polo",
  category_id: 'cat-uniform',
  condition: 'good',
  status: 'available',
  tracking_type: 'pool',
  quantity: 6,
  quantity_issued: 1,
  size: 'm',
  standard_size: 'm',
  color: 'Navy',
  style: 'polo',
  style_attributes: ['long_sleeve', 'mens', 'polo'],
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/** Let fonts and entry animations settle so nothing is caught mid-fade. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

/** The modal panel, so the shots are the dialog rather than the whole page. */
const dialog = (page: Page) => page.locator('[role="dialog"], .modal-panel-scroll').first();

/** Sign in with a uniform category and one generated polo on the shelf. */
async function openInventory(page: Page) {
  await signIn(page, { permissions: ['inventory.view', 'inventory.manage', 'admin.access'] });
  await page.route('**/api/v1/inventory/categories**', (route) => route.fulfill(json([UNIFORM_CATEGORY])));
  // Order matters: Playwright matches the LAST registered route first, and
  // `items**` also matches `items/colors`. Registering the general one first
  // lets the specific one win — otherwise the colour filter receives the item
  // list object and the page renders nothing.
  await page.route('**/api/v1/inventory/items**', (route) => route.fulfill(json({ items: [POLO], total: 1 })));
  await page.route('**/api/v1/inventory/items/colors**', (route) => route.fulfill(json(['Navy', 'White'])));
  await page.goto('/inventory/admin/items');
  await settle(page);
}

/** Open Add Item and fill in the parts every shot shares. */
async function openAddItem(page: Page) {
  await page
    .getByRole('button', { name: /Add Item/i })
    .first()
    .click();
  // Scoped to the dialog throughout: the list page behind it has its own
  // Category filter, and an unscoped `.first()` picks that one instead —
  // silently filtering the list while leaving the form's category unset, so
  // the item type never resolves to a garment and the style rows never render.
  const d = dialog(page);
  await d.getByLabel('Name').first().fill('Dept Polo');
  await d.getByLabel('Category').selectOption('cat-uniform');
  await settle(page);
}

/** Open Add Item and switch on variant generation. */
async function openGenerator(page: Page) {
  await openAddItem(page);
  await dialog(page)
    .getByRole('switch', { name: /Generate Sizes & Styles/i })
    .click();
  await settle(page);
}

test.describe('@screenshots inventory style axes', () => {
  test.use({ viewport: WIDE });

  test('one pick per axis creates one item', async ({ page }) => {
    await openInventory(page);
    await openGenerator(page);

    await page.getByRole('group', { name: 'Garment' }).getByRole('button', { name: 'M', exact: true }).click();
    await page.getByRole('group', { name: 'Sleeve' }).getByRole('button', { name: 'Long Sleeve', exact: true }).click();
    await page.getByRole('group', { name: 'Fit' }).getByRole('button', { name: "Men's", exact: true }).click();
    await page.getByRole('group', { name: 'Neckline' }).getByRole('button', { name: 'Polo', exact: true }).click();
    await settle(page);

    // The whole point of the image: three chips, one item.
    await expect(page.getByRole('button', { name: /Create 1 Item/ })).toBeVisible();
    await dialog(page).screenshot({ path: `${OUT}/01-one-garment-one-item.png` });
  });

  test('a second pick in one axis creates a second item', async ({ page }) => {
    await openInventory(page);
    await openGenerator(page);

    await page.getByRole('group', { name: 'Garment' }).getByRole('button', { name: 'M', exact: true }).click();
    await page.getByRole('group', { name: 'Sleeve' }).getByRole('button', { name: 'Long Sleeve', exact: true }).click();
    await page.getByRole('group', { name: 'Fit' }).getByRole('button', { name: "Men's", exact: true }).click();
    await page.getByRole('group', { name: 'Fit' }).getByRole('button', { name: "Women's", exact: true }).click();
    await page.getByRole('group', { name: 'Neckline' }).getByRole('button', { name: 'Polo', exact: true }).click();
    await settle(page);

    await expect(page.getByRole('button', { name: /Create 2 Items/ })).toBeVisible();
    await dialog(page).screenshot({ path: `${OUT}/02-two-fits-two-items.png` });
  });

  test('the size chips offer boots and waists', async ({ page }) => {
    await openInventory(page);
    await openGenerator(page);

    await expect(page.getByRole('group', { name: 'Boot / Glove' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Waist' })).toBeVisible();
    await dialog(page).screenshot({ path: `${OUT}/03-size-groups.png` });
  });

  test('a single item records its style too', async ({ page }) => {
    // The same picker outside the generator. Until now this form had no style
    // control at all, so a generated garment could never be corrected.
    await openInventory(page);
    await openAddItem(page);
    // The Physical fieldset only exists once the category resolves to a
    // garment type, so wait for it rather than racing the re-render.
    await expect(page.getByRole('group', { name: 'Fit' })).toBeVisible();

    await page.getByRole('group', { name: 'Fit' }).getByRole('button', { name: "Women's", exact: true }).click();
    await page.getByRole('group', { name: 'Neckline' }).getByRole('button', { name: 'Polo', exact: true }).click();
    await settle(page);

    await expect(page.getByRole('group', { name: 'Sleeve' })).toBeVisible();
    await dialog(page).screenshot({ path: `${OUT}/04-single-item-style.png` });
  });

  test('the list reads the whole garment', async ({ page }) => {
    // The capsule and the axis-grouped filter, which is where a quartermaster
    // sees the result of all of the above.
    await openInventory(page);

    await expect(page.getByText("Men's Long Sleeve Polo").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/05-list-and-filters.png` });
  });
});
