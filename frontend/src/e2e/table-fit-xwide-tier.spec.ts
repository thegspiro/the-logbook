import { expect, test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';

const PERMISSIONS = [...TEST_USER.permissions, 'inventory.view', 'inventory.manage'];

const CATEGORIES = [
  {
    id: 'cat-1',
    organization_id: 'org-1',
    name: 'Self-Contained Breathing Apparatus & Respiratory Protection',
    item_type: 'equipment',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'cat-2',
    organization_id: 'org-1',
    name: 'Structural Firefighting Personal Protective Equipment',
    item_type: 'uniform',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const ITEM_NAMES = [
  'Scott Air-Pak X3 Pro Self-Contained Breathing Apparatus 45-Minute',
  'Globe G-Xtreme 3.0 Structural Turnout Coat with Drag Rescue Device',
  'Motorola APX NEXT P25 Portable Radio with Remote Speaker Microphone',
  'MSA G1 Thermal Imaging Camera Integrated Module Replacement Kit',
];
const CONDITIONS = ['excellent', 'needs_repair', 'fair', 'good'];

const inventoryItem = (i: number, status: string, pinPosition: number | null) => ({
  id: `item-${i}`,
  organization_id: 'org-1',
  category_id: i % 2 ? 'cat-1' : 'cat-2',
  name: ITEM_NAMES[i % ITEM_NAMES.length] ?? '',
  manufacturer: 'Mine Safety Appliances Company',
  model_number: 'G1-SCBA-2026-XLR',
  serial_number: `SN-2026-00${i}48213-ALPHA`,
  asset_tag: `OFD-AT-${100000 + i}`,
  barcode: `0123456789${i}`,
  purchase_price: 123456.78,
  storage_location: 'Station 14 Headquarters › Apparatus Bay Mezzanine › Shelf Unit 7B Top Rack',
  size: 'XXL Tall',
  color: 'Hi-Visibility Lime Yellow',
  style: 'Long Sleeve Relaxed Fit',
  condition: CONDITIONS[i % CONDITIONS.length] ?? 'good',
  status,
  tracking_type: 'pool',
  quantity: 123456,
  quantity_issued: 2345,
  unit_of_measure: 'each',
  reorder_point: 25,
  pin_position: pinPosition,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

// Pinned rows carry the reorder column; unpinned unavailable rows fill the
// Unavailable table, which also shows Status.
const ITEMS = [
  inventoryItem(0, 'available', 0),
  inventoryItem(1, 'in_maintenance', 1),
  inventoryItem(2, 'assigned', 2),
  inventoryItem(3, 'available', 3),
  inventoryItem(4, 'in_maintenance', null),
  inventoryItem(5, 'assigned', null),
  inventoryItem(6, 'out_of_service', null),
];

// The tier must sit below the widest card the app's capped page column can
// give a table. That column leaves a card about 1278px wide however large the
// screen, so a tier at 80rem (1280px) showed every xwide table as cards even
// on a 1920px desktop, where the Pinned table (about 1044px with WebKit
// headroom) fits as a table. Its header row is visible only in table layout.
test.describe('xwide tier keeps the table layout on a desktop', () => {
  for (const viewport of [{ name: 'desktop 1920x1080', width: 1920, height: 1080 }]) {
    test(`/inventory/admin/items — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/inventory/items?**', (route) => {
        void route.fulfill(json({ items: ITEMS, total: ITEMS.length, skip: 0, limit: 50 }));
      });
      await page.route('**/api/v1/inventory/categories**', (route) => {
        void route.fulfill(json(CATEGORIES));
      });
      await page.goto('/inventory/admin/items');
      const table = page.getByRole('table', { name: 'Pinned' });
      await table.waitFor();
      await expect(table.locator('thead')).toBeVisible();
    });
  }
});
