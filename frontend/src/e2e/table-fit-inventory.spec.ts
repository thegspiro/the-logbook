import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

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

const REORDER_ITEM_NAMES = [
  'Scott Air-Pak X3 Pro Self-Contained Breathing Apparatus Cylinder 4500 PSI',
  'Globe G-Xtreme Structural Turnout Pants Size 44 Regular Inseam',
  'Nitrile Examination Gloves Extra Large Powder-Free Box of 100',
  'Hurst eDRAULIC Combination Spreader-Cutter SC 357 Battery Pack',
];
const REORDER_STATUSES = ['pending', 'ordered', 'approved', 'partially_received'];
const REORDER_URGENCIES = ['critical', 'high', 'normal', 'low'];
const VENDOR_NAME = 'Municipal Emergency Services Northeast Distribution Center';

const REORDER_REQUESTS = [0, 1, 2, 3].map((i) => ({
  id: `rr-${i}`,
  organization_id: 'org-1',
  item_name: REORDER_ITEM_NAMES[i] ?? '',
  quantity_requested: 1250,
  ...(i === 3 ? { quantity_received: 600, actual_unit_cost: 1012.34 } : {}),
  quantity_outstanding: 1250,
  version: 1,
  vendor: VENDOR_NAME,
  ...(i % 2 ? { vendor_id: 'vendor-1', vendor_name: VENDOR_NAME } : {}),
  estimated_unit_cost: 987.65,
  purchase_order_number: 'PO-2026-0048213-FIRE',
  status: REORDER_STATUSES[i] ?? 'pending',
  urgency: REORDER_URGENCIES[i] ?? 'normal',
  requester_name: 'Alexandra Ayala-Montgomery',
  created_at: '2026-10-14T15:30:00Z',
  updated_at: '2026-10-14T15:30:00Z',
}));

const VENDORS = [{ id: 'vendor-1', organization_id: 'org-1', name: VENDOR_NAME, is_active: true }];

async function openItemsPage(page: Page): Promise<void> {
  await signIn(page, { permissions: PERMISSIONS });
  await page.route('**/api/v1/inventory/items?**', (route) => {
    void route.fulfill(json({ items: ITEMS, total: ITEMS.length, skip: 0, limit: 50 }));
  });
  await page.route('**/api/v1/inventory/categories**', (route) => {
    void route.fulfill(json(CATEGORIES));
  });
  await page.goto('/inventory/admin/items');
}

// The inventory items list renders up to three copies of one wide table
// (Pinned, Available, Unavailable). Pinned adds an Order column and Unavailable
// adds Status, so those two are the widest and can overflow their card on a
// tablet or laptop with the side navigation open.
test.describe('Inventory items — Pinned table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/inventory/admin/items — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openItemsPage(page);
      const table = page.getByRole('table', { name: 'Pinned' });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Pinned items table');
    });
  }
});

test.describe('Inventory items — Unavailable table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/inventory/admin/items — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openItemsPage(page);
      const table = page.getByRole('table', { name: 'Unavailable' });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Unavailable items table');
    });
  }
});

// Reorder requests: eight columns including vendor, cost and a row of workflow
// buttons, inside a card that clips below md — it can overflow on a tablet or
// laptop.
test.describe('Reorder requests table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/inventory/admin/reorder — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/inventory/reorder-requests**', (route) => {
        void route.fulfill(json(REORDER_REQUESTS));
      });
      await page.route('**/api/v1/inventory/vendors**', (route) => {
        void route.fulfill(json(VENDORS));
      });
      await page.goto('/inventory/admin/reorder');
      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Urgency' }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Reorder requests table');
    });
  }
});
