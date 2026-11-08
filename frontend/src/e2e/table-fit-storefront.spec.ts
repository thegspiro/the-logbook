import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const storeWindow = {
  id: 'window-1',
  organizationId: 'org-1',
  name: 'Fall 2026 Class A Uniform and Station Wear Order',
  status: 'closed',
  opensAt: '2026-09-01T12:00:00Z',
  closesAt: '2026-09-30T23:00:00Z',
  autoOpen: false,
  autoClose: false,
  includeAllProducts: true,
  notifyOnOpen: false,
  orderCount: 42,
  totalSales: '128450.00',
  outstandingBalance: '14320.00',
  offerings: [],
};

const PRODUCTS = [
  { name: 'Embroidered Quarter-Zip Pullover Fleece Jacket', method: 'embroidery', thread: 'gold' },
  { name: 'Engraved Brass Helmet Shield Front Plate', method: 'engraving', thread: null },
  { name: 'Heavyweight Station Uniform Work Shirt (Navy)', method: 'embroidery', thread: 'silver' },
  { name: 'Embroidered Softshell Duty Jacket with Reflective Trim', method: 'embroidery', thread: 'white' },
];

const summary = {
  windowId: 'window-1',
  windowName: storeWindow.name,
  status: 'closed',
  orderCount: 42,
  memberCount: 38,
  grossSales: '128450.00',
  collected: '114130.00',
  outstanding: '14320.00',
  unpaidOrderCount: 3,
  pendingVerificationCount: 1,
  paymentPolicy: 'none',
  sizeTotals: [],
  heldTotals: [],
  heldOrderCount: 0,
  tallies: PRODUCTS.map((product, i) => ({
    productId: `product-${i}`,
    productName: product.name,
    variantLabel: "Men's Extra-Large Tall / Navy Blue",
    sku: `SKU-${i}`,
    personalizationText: 'LIEUTENANT A. AYALA-MONTGOMERY — ENGINE COMPANY 7',
    personalizationThreadColor: product.thread,
    personalizationMethod: product.method,
    quantity: 12,
    unitPrice: '10450.00',
    lineTotal: '125400.00',
  })),
};

// The order window tally's line detail: item, option, personalization,
// method, thread, quantity and total. The modal caps it at 622px, so it only
// overflows on a phone.
test.describe('Store window tally line detail fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/inventory/admin/store?tab=windows Tally — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'storefront.view', 'storefront.manage'] });
      await page.route('**/api/v1/store/windows**', (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill(json(path.endsWith('/summary') ? summary : [storeWindow]));
      });
      await page.route('**/api/v1/store/products**', (route) => route.fulfill(json([])));
      await page.goto('/inventory/admin/store?tab=windows');
      await page.getByRole('button', { name: 'Tally' }).click();

      const table = page.getByRole('table').filter({
        has: page.getByRole('columnheader', { includeHidden: true, name: 'Personalization', exact: true }),
      });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Store window tally line detail');
    });
  }
});
