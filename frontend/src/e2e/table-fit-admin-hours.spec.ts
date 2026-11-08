import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const MEMBER_NAMES = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vandenberghe-Whitfield',
  'Maria-Guadalupe Fernandez-Castellanos',
  'Jonathan Okonkwo-Richardson',
];

const STATUSES = ['approved', 'pending', 'rejected', 'withdrawn'];

const entries = MEMBER_NAMES.map((userName, i) => ({
  id: `entry-${i}`,
  organizationId: 'org-1',
  userId: `user-${i}`,
  categoryId: 'category-1',
  clockInAt: '2026-10-14T13:00:00Z',
  clockOutAt: '2026-10-14T19:45:00Z',
  durationMinutes: 405,
  description: 'Annual SCBA flow testing and cylinder hydrostatic inspection',
  entryMethod: i === 0 ? 'event_attendance' : 'manual',
  status: STATUSES[i] ?? 'approved',
  approvedBy: 'user-9',
  approvedAt: '2026-10-15T12:00:00Z',
  rejectionReason: null,
  sourceEventId: i === 0 ? 'event-1' : null,
  sourceRsvpId: null,
  createdAt: '2026-10-14T13:00:00Z',
  updatedAt: '2026-10-15T12:00:00Z',
  categoryName: 'Apparatus Maintenance and Equipment Inventory Administration',
  categoryColor: '#2563eb',
  userName,
  approverName: 'Captain Bartholomew Szczepanski-Lindqvist',
  sourceEventName: 'Quarterly Hazardous Materials Operations Refresher',
}));

// The All Entries tab: member, category, date, duration, method with its
// source event, status and reviewer.
test.describe('Admin hours entries table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/admin-hours/manage All Entries — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'admin_hours.view', 'admin_hours.manage'] });
      await page.route('**/api/v1/admin-hours/entries?**', (route) =>
        route.fulfill(json({ entries, total: entries.length, skip: 0, limit: 25 }))
      );
      await page.goto('/admin-hours/manage');
      await page.getByRole('button', { name: 'All Entries', exact: true }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Reviewed By', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Admin hours entries table');
    });
  }
});
