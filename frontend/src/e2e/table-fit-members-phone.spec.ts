import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const VIEWPORTS = [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS];

const MEMBERS_CSV = [
  'firstName,lastName,membershipNumber,email,primaryPhone,emergencyName1,emergencyRelationship1,emergencyPhone1',
  ...[1, 2, 3, 4].map(
    (i) =>
      `Maximiliano${i},Vandenberghe-Okonkwo,FF-2026-10${i},maximiliano.vandenberghe-okonkwo${i}@northwestfirerescue.org,(555) 867-530${i},Alejandra Vandenberghe-Okonkwo,Spouse,(555) 867-531${i}`
  ),
].join('\n');

const assignedItems = [1, 2, 3].map((i) => ({
  assignment_id: `assignment-${i}`,
  item_id: `item-${i}`,
  item_name: 'Self-Contained Breathing Apparatus Scott Air-Pak X3 Pro 4500 PSI',
  serial_number: `SCBA-2026-NORTHWEST-00${i}48213`,
  condition: 'Excellent',
  assigned_date: '2026-03-14T12:00:00Z',
}));

const tableWithHeader = (page: Page, name: string) =>
  page.getByRole('table').filter({ has: page.getByRole('columnheader', { includeHidden: true, name, exact: true }) });

// The member import preview: the first valid rows of the uploaded roster —
// name, member number, a long email, phone and the first emergency contact.
test.describe('Member import preview fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/members/admin?tab=import — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'users.create'] });
      await page.goto('/members/admin?tab=import');
      await page.getByTestId('csv-file-input').setInputFiles({
        name: 'members.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(MEMBERS_CSV),
      });

      const table = tableWithHeader(page, 'Emergency Contact');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Member import preview');
    });
  }
});

// The Assigned Inventory card on a member's profile, as a quartermaster sees
// it: a long item name, a long serial, category, condition badge and date.
// Signed in with only the grants that show it, so the profile's other
// officer-only sections stay out of the way.
test.describe('Assigned inventory on the member profile fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/members/:userId — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { memberRecord: true, permissions: ['members.view', 'inventory.view', 'inventory.manage'] });
      await page.route(
        '**/api/v1/organization/modules',
        (route) => void route.fulfill(json({ enabled_modules: ['inventory'], module_settings: {} }))
      );
      await page.route(
        '**/api/v1/inventory/users/*/inventory',
        (route) =>
          void route.fulfill(json({ permanent_assignments: assignedItems, active_checkouts: [], issued_items: [] }))
      );
      await page.goto('/members/member-2');

      const table = tableWithHeader(page, 'Item #');
      await table.waitFor();
      await expect(table.locator('tbody tr').first()).toBeVisible();
      // Measured as the scroll wrapper's overflow rather than with
      // expectTableFitsItsCard: this card is two thirds of a three-column grid,
      // so its width is fractional (529.33px on a 1280px laptop), and a table
      // filling it exactly rounds up to one pixel past the card's rounded
      // clientWidth. scrollWidth and clientWidth are snapped alike, so this
      // still fails on a single real pixel of sideways scroll.
      const { scrollWidth, clientWidth } = await table.evaluate((el) => {
        const wrapper = el.closest('.rwd-table-container') ?? el.parentElement;
        return { scrollWidth: wrapper?.scrollWidth ?? 0, clientWidth: wrapper?.clientWidth ?? 0 };
      });
      expect(scrollWidth, `Assigned inventory scrolls ${scrollWidth - clientWidth}px sideways`).toBeLessThanOrEqual(
        clientWidth
      );
    });
  }
});
