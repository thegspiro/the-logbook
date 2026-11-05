import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const MEMBER_NAMES = [
  'Alexandra Ayala-Montgomery',
  'Christopher Fitzgerald-Whitaker',
  'Maximiliana Rodriguez-Vandenberg',
  'Bartholomew Okonkwo-Henderson',
];

const attendanceDashboard = {
  generated_at: '2026-11-01T10:00:00Z',
  period_months: 12,
  meeting_type_filter: null,
  total_meetings_in_period: 24,
  members: MEMBER_NAMES.map((name, i) => ({
    user_id: `member-${i}`,
    name,
    membership_tier: 'active',
    tier_name: 'Active Firefighter (Life Member Eligible)',
    hire_date: '2010-01-01',
    attendance_pct: 87.5,
    meetings_attended: 21,
    meetings_waived: 2,
    meetings_on_leave: 1,
    meetings_absent: 10,
    total_meetings: 24,
    eligible_meetings: 24,
    voting_eligible: i % 2 === 0,
    voting_blocked_reason:
      i % 2 === 0 ? null : 'Attendance below the 60% required by the bylaws for voting at regular business meetings',
  })),
  summary: {
    total_members: 4,
    avg_attendance_pct: 87.5,
    voting_eligible_count: 2,
    voting_blocked_by_attendance: 2,
  },
};

// The meeting attendance dashboard: eight columns per member (name, tier,
// percentage, four counts, voting eligibility with its reason). It sits
// directly in an overflow-hidden card, so a table wider than the card on a
// tablet or laptop is clipped with no way to scroll to the cut-off columns.
test.describe('Meeting attendance table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/minutes/attendance — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'meetings.view', 'meetings.manage'] });
      await page.route(
        '**/api/v1/meetings/attendance/dashboard**',
        (route) => void route.fulfill(json(attendanceDashboard))
      );
      await page.goto('/minutes/attendance');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'On leave', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Meeting attendance table');
    });
  }
});
