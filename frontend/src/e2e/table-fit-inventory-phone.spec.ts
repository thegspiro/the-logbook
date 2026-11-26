import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const VIEWPORTS = [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS];
const CREATED = '2026-10-14T15:30:00Z';

const SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'];
const COLOURS = ['Hi-Vis Lime Yellow', 'Midnight Navy Blue', 'Charcoal Heather Grey', 'Station Red'];

const variantItems = SIZES.flatMap((size, s) =>
  COLOURS.map((color, c) => ({
    id: `item-${size}-${c}`,
    organization_id: 'org-1',
    name: 'Class 3 Reflective Duty Jacket',
    standard_size: size,
    color,
    quantity: (s + c) % 5 === 0 ? 0 : s + c + 3,
    quantity_issued: 2,
    status: 'available',
    active: true,
    created_at: CREATED,
    updated_at: CREATED,
  }))
);

const variantGroup = {
  id: 'group-1',
  organization_id: 'org-1',
  name: 'Class 3 Reflective Duty Jacket',
  description: 'Department-issue high visibility jacket for roadway incidents',
  active: true,
  created_at: CREATED,
  updated_at: CREATED,
  items: variantItems,
};

const CHECKLIST_CSV = [
  'Compartment,Name,Check Type,Expected Qty,Count Unit,Min to Pass,Critical Min',
  ...[1, 2, 3, 4].map(
    (i) => `Driver Side Rear Compartment D${i},Hurst eDRAULIC Combination Spreader-Cutter SC 357 E3,count,12,each,10,8`
  ),
].join('\n');

const INVENTORY_CSV = [
  'name,category,item type,serial number,status,quantity,tracking type',
  ...[1, 2, 3, 4].map(
    (i) =>
      `MSA G1 Self-Contained Breathing Apparatus 4500 PSI,Respiratory Protection Equipment,equipment,MSA-G1-2026-NORTHWEST-00${i}48213,available,1,individual`
  ),
].join('\n');

const plannerMembers = [1, 2, 3].map((i) => ({
  user_id: `member-${i}`,
  full_name: 'Maximiliano Vandenberghe-Okonkwo',
  membership_number: `FF-2026-10${i}`,
  rank: 'lieutenant',
  station: 'Station 14 - Northwest Headquarters Annex',
  status: 'active',
  needed_size: 'xxl',
  has_size_on_file: true,
  has_related_item: false,
  needs_replacement: false,
  over_allowance: true,
  related_item_names: [],
  email: `maximiliano.vandenberghe-okonkwo${i}@northwestfirerescue.org`,
  phone: '(555) 867-5309',
}));

const plannerOptions = {
  statuses: [{ value: 'active', label: 'Active' }],
  membership_types: [],
  ranks: [{ value: 'lieutenant', label: 'Lieutenant' }],
  stations: [],
  positions: [],
  categories: [{ id: 'cat-1', name: 'Structural Firefighting Turnout Coats', item_type: 'uniform' }],
  size_fields: [{ value: 'jacket', label: 'Jacket' }],
};

const plannerResult = {
  total_members: 3,
  members_with_related_item: 0,
  members_needing_item: 3,
  members_needing_replacement: 0,
  members_missing_sizes: 0,
  members_over_allowance: 3,
  replacement_aware: false,
  allowance_aware: true,
  size_field: 'jacket',
  size_breakdown: [{ size: 'xxl', total: 3, needing: 3 }],
  stock_checked: false,
  cost_estimated: false,
  members: plannerMembers,
};

const tableWithHeader = (page: Page, name: string) =>
  page.getByRole('table').filter({ has: page.getByRole('columnheader', { includeHidden: true, name, exact: true }) });

async function openSignedIn(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await signIn(page, { permissions: [...TEST_USER.permissions, 'inventory.check_manage'] });
}

// The size x colour stock matrix in the variant group's View dialog. It is a
// cross-reading grid, so it keeps its columns: where it is wider than the
// dialog it must say so with the scroll cue, and the Size column stays pinned.
test.describe('Variant group stock matrix scrolls with a cue and a pinned Size column', () => {
  for (const viewport of VIEWPORTS) {
    test(`/inventory/admin/variant-groups — ${viewport.name}`, async ({ page }) => {
      await openSignedIn(page, viewport);
      await page.route('**/api/v1/inventory/variant-groups?**', (route) => void route.fulfill(json([variantGroup])));
      await page.route('**/api/v1/inventory/variant-groups/group-1', (route) => void route.fulfill(json(variantGroup)));
      await page.goto('/inventory/admin/variant-groups');
      await page.getByRole('button', { name: `View ${variantGroup.name}`, exact: true }).click();

      const table = tableWithHeader(page, 'Midnight Navy Blue');
      await expect(table.locator('tbody tr').first()).toBeVisible();

      const sizeHeader = table.getByRole('columnheader', { name: 'Size', exact: true });
      expect(await sizeHeader.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
      const sizeCell = table.getByRole('rowheader').first();
      expect(await sizeCell.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

      // No expectContentStaysInCard: the table's card resolves to its parent,
      // the ScrollCueRow scroller, which is narrower than the grid on purpose.
      const { overflows } = await table.evaluate((el) => {
        const scroller = el.parentElement;
        return { overflows: scroller ? scroller.scrollWidth > scroller.clientWidth + 2 : false };
      });
      if (viewport.width === 390) {
        expect(overflows, 'the matrix should be wider than a phone dialog with these colours').toBe(true);
      }
      // Wherever columns are out of sight, the cue says so.
      if (overflows) await expect(page.getByTestId('modal-content').getByTestId('scroll-cue-right')).toBeVisible();
    });
  }
});

// The CSV import preview on a new checklist template: compartment, item, type
// and three quantity columns, in a dialog. A record preview, so it reflows to
// cards when the dialog is narrow.
test.describe('Checklist CSV import preview fits its dialog', () => {
  for (const viewport of VIEWPORTS) {
    test(`/inventory/admin/checklists/templates/new — ${viewport.name}`, async ({ page }) => {
      await openSignedIn(page, viewport);
      await page.goto('/inventory/admin/checklists/templates/new');
      await page.locator('input[type="file"][accept=".csv"]').setInputFiles({
        name: 'checklist.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(CHECKLIST_CSV),
      });

      const table = tableWithHeader(page, 'Critical Min');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Checklist CSV preview');
    });
  }
});

// The inventory import preview: the first rows of the uploaded file, seven
// columns with a long name, category and serial number.
test.describe('Inventory import preview fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/inventory/import — ${viewport.name}`, async ({ page }) => {
      await openSignedIn(page, viewport);
      // The preview asks the server to check every row (a dry run) and shows
      // its report beside the table; answer it with one, long messages and all.
      await page.route('**/api/v1/inventory/items/import**', (route) =>
        route.fulfill(
          json({
            imported: 3,
            failed: 1,
            total_rows: 4,
            errors: [
              {
                row: 5,
                error:
                  "Serial number 'MSA-G1-2026-NORTHWEST-00448213' is already in use by another item in this organization",
              },
            ],
            warnings: ["Row 2: Category 'Respiratory Protection Equipment' not found — item imported without category"],
            dry_run: true,
          })
        )
      );
      await page.goto('/inventory/import');
      await page.getByTestId('csv-file-input').setInputFiles({
        name: 'inventory.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(INVENTORY_CSV),
      });

      const table = tableWithHeader(page, 'Tracking');
      await table.waitFor();
      await expect(page.getByText('3 of 4 rows will import. 1 will be skipped:')).toBeVisible();
      await expectTableFitsItsCard(table, 'Inventory import preview');
    });
  }
});

// The impact planner's member list: member with number and allowance badge,
// rank and station, size, the existing-item badge and a long email. It sits
// in the results column beside the filters, narrow even on a tablet.
test.describe('Impact planner member list fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/inventory/admin/impact-planner — ${viewport.name}`, async ({ page }) => {
      await openSignedIn(page, viewport);
      await page.route(
        '**/api/v1/inventory/impact-planner/options',
        (route) => void route.fulfill(json(plannerOptions))
      );
      await page.route('**/api/v1/inventory/impact-planner/plans', (route) => void route.fulfill(json([])));
      await page.route('**/api/v1/inventory/impact-planner', (route) => void route.fulfill(json(plannerResult)));
      await page.goto('/inventory/admin/impact-planner');
      await page.getByRole('combobox', { name: 'Related category' }).selectOption('cat-1');
      await page.getByRole('button', { name: /Analyze Impact/i }).click();

      const table = tableWithHeader(page, 'Contact');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Impact planner member list');
    });
  }
});
