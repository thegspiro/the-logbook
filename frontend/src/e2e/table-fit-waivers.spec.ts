import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const MEMBER_NAMES = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vanderbilt-Okonkwo',
  'Maximilian Hargreaves-Delacroix',
  'Jacqueline Fitzwilliam-Nakamura',
];

const LEAVE_TYPES = ['leave_of_absence', 'medical', 'military', 'personal'];
const WAIVER_TYPES = ['medical', 'military', 'personal', 'administrative'];

const REASON =
  'Extended medical leave following shoulder surgery and the physical therapy rehabilitation the department physician required before returning to duty';

const members = MEMBER_NAMES.map((fullName, i) => ({
  id: `member-${i}`,
  organization_id: 'org-1',
  username: fullName.toLowerCase().replace(/[^a-z]/g, ''),
  full_name: fullName,
  email: `member-${i}@example.com`,
  rank: 'Lieutenant Battalion Training Coordinator',
  status: 'active',
}));

// Dated to run from 2026-09 through 2027-03 so every row counts as active on
// the Active tab as well as appearing in the history.
const leaves = MEMBER_NAMES.map((_, i) => ({
  id: `leave-${i}`,
  organization_id: 'org-1',
  user_id: `member-${i}`,
  leave_type: LEAVE_TYPES[i] ?? 'leave_of_absence',
  reason: REASON,
  start_date: '2026-09-01',
  end_date: '2027-03-31',
  granted_by: 'member-1',
  granted_at: '2026-08-30T10:00:00Z',
  active: true,
  exempt_from_training_waiver: i % 2 === 0,
  linked_training_waiver_id: null,
  created_at: '2026-08-30T10:00:00Z',
  updated_at: '2026-08-30T10:00:00Z',
}));

const trainingWaivers = MEMBER_NAMES.map((_, i) => ({
  id: `waiver-${i}`,
  organization_id: 'org-1',
  user_id: `member-${i}`,
  waiver_type: WAIVER_TYPES[i] ?? 'medical',
  reason: REASON,
  start_date: '2026-09-15',
  end_date: '2027-02-28',
  requirement_ids: ['req-1', 'req-2', 'req-3'],
  granted_by: 'member-2',
  granted_at: '2026-09-14T10:00:00Z',
  active: true,
  created_at: '2026-09-14T10:00:00Z',
  updated_at: '2026-09-14T10:00:00Z',
}));

const WAIVER_PERMISSIONS = [...TEST_USER.permissions, 'members.manage'];

async function mockWaivers(page: Page): Promise<void> {
  await page.route('**/api/v1/users/leaves-of-absence**', (route) => void route.fulfill(json(leaves)));
  await page.route('**/api/v1/training/waivers**', (route) => void route.fulfill(json(trainingWaivers)));
  await page.route(/\/api\/v1\/users(\?.*)?$/, (route) => void route.fulfill(json(members)));
}

// The active waivers list: member, type, the areas waived, period, a long
// reason and Edit/Deactivate actions. Overflows its card on a tablet.
test.describe('Active waivers table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/members/admin/waivers?tab=active — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: WAIVER_PERMISSIONS });
      await mockWaivers(page);
      await page.goto('/members/admin/waivers?tab=active');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Applies To', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Active waivers table');
    });
  }
});

// Every waiver, current or not: the active list's columns plus a status badge.
// Overflows its card on a tablet and on a 1280px laptop.
test.describe('All waivers table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/members/admin/waivers?tab=history — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: WAIVER_PERMISSIONS });
      await mockWaivers(page);
      await page.goto('/members/admin/waivers?tab=history');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Status', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'All waivers table');
    });
  }
});
