import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const MEMBER_NAMES = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vanderbilt-Okonkwo',
  'Maximilian Hargreaves-Delacroix',
  'Jacqueline Fitzwilliam-Nakamura',
];

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

// One waiver is linked from a leave, so the Source column shows "Auto (LOA)"
// beside "Manual".
const leaves = [
  {
    id: 'leave-1',
    organization_id: 'org-1',
    user_id: 'member-1',
    leave_type: 'military',
    reason: REASON,
    start_date: '2026-09-15',
    end_date: '2027-02-28',
    granted_by: 'member-2',
    granted_at: '2026-09-14T10:00:00Z',
    active: true,
    exempt_from_training_waiver: false,
    linked_training_waiver_id: 'waiver-1',
    created_at: '2026-09-14T10:00:00Z',
    updated_at: '2026-09-14T10:00:00Z',
  },
];

// The training waivers list: member with rank, status, type, period, scope, a
// long reason and the waiver's source. About 1047px wide, so it overflows its
// card on a tablet and on both common laptop widths.
test.describe('Training waivers table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/training/admin?page=dashboard&tab=waivers — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'training.view', 'training.manage'] });
      await page.route('**/api/v1/training/waivers**', (route) => void route.fulfill(json(trainingWaivers)));
      await page.route('**/api/v1/users/leaves-of-absence**', (route) => void route.fulfill(json(leaves)));
      await page.route(/\/api\/v1\/users(\?.*)?$/, (route) => void route.fulfill(json(members)));
      await page.goto('/training/admin?page=dashboard&tab=waivers');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Scope', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Training waivers table');
    });
  }
});
