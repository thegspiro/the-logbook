import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'inventory.view_medical', 'inventory.manage_medical'];

const CATEGORIES = [
  {
    id: 'mcat-1',
    organization_id: 'org-1',
    name: 'Advanced Life Support Airway Management & Ventilation',
    item_type: 'medical',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const SUPPLY_NAMES = [
  'Nitrile Examination Gloves Powder-Free Textured Fingertips',
  'Adult Bag-Valve-Mask Resuscitator with Oxygen Reservoir',
  'Combat Application Tourniquet Generation 7 Rescue Orange',
  'Intraosseous Vascular Access Needle Set 45mm Bariatric',
];

const TRUCK_PLACE = 'Medic 14 › Main Patient Compartment › Advanced Airway Jump Bag';

const SUPPLIES = SUPPLY_NAMES.map((name, i) => ({
  id: `supply-${i}`,
  organization_id: 'org-1',
  category_id: 'mcat-1',
  name,
  size: 'Extra Large',
  unit_of_measure: 'box of 100',
  condition: 'good',
  status: 'available',
  tracking_type: 'pool',
  quantity: 123456,
  quantity_issued: 0,
  reorder_point: 25,
  is_lot_stocked: true,
  lot_stock: 123456,
  apparatus_stock: 2345,
  apparatus_uncounted: 3,
  apparatus_count: 12,
  is_low_stock: i === 1,
  next_expiration_date: '2026-12-15',
  days_until_next_expiration: 40,
  next_expiration_location: i % 2 ? 'apparatus' : 'shelf',
  next_expiration_where: TRUCK_PLACE,
  storage_path: 'Station 14 Headquarters › EMS Supply Room › Shelf Unit 7B',
  apparatus_places: [TRUCK_PLACE, 'Engine 14 › Officer-Side Front Compartment › ALS Bag'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}));

const SUMMARY = {
  total_items: SUPPLIES.length,
  expiring_soon: 2,
  expired: 1,
  low_stock: 1,
  expiring_within_days: 60,
  uncounted_on_apparatus: 3,
};

// The medical supplies list: eight columns, two of which (On hand, Next
// expiry) stack a truck count and a storage path under the figure. It can
// overflow its card on a tablet or laptop with the side navigation open.
test.describe('Medical supplies — stock table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/medical-supplies?tab=stock — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/medical-supplies/summary**', (route) => {
        void route.fulfill(json(SUMMARY));
      });
      await page.route('**/api/v1/medical-supplies/categories**', (route) => {
        void route.fulfill(json(CATEGORIES));
      });
      await page.route('**/api/v1/medical-supplies/items?**', (route) => {
        void route.fulfill(json({ items: SUPPLIES, total: SUPPLIES.length, skip: 0, limit: 50 }));
      });
      await page.goto('/medical-supplies?tab=stock');
      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Reorder at' }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Medical supplies stock table');
    });
  }
});
