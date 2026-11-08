import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'scheduling.view', 'scheduling.manage'];

const MEMBERS = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vanderbilt-Okonkwo',
  'Maximiliano Fitzgerald-Hernandez',
  'Bartholomew Kowalczyk-Richardson',
];

const HISTORY_IMPORT_ROWS = MEMBERS.map((member, i) => ({
  id: `row-${i}`,
  line_number: 1240 + i,
  raw: {},
  values: {
    member_name: member,
    unit: `Engine ${i + 21} Advanced Life Support Tanker Unit`,
    agency: 'Greater Northfield-Oakville Township Fire & Rescue',
    date: `2024-0${i + 3}-17`,
    start_time: '07:00',
    end_time: '19:30',
  },
  excluded: i === 3,
  keep_separate: i === 1,
  match_decision: i === 1 ? 'accept' : null,
  skipped_reason: i === 2 ? 'Cancelled before the shift began (status column reads "CXL")' : null,
  errors: [],
}));

const HISTORY_IMPORT_DETAIL = {
  import: {
    id: 'import-1',
    status: 'draft',
    source_filename: 'northfield-oakville-shift-history-2019-2024-export.csv',
    timezone: 'America/New_York',
    row_count: HISTORY_IMPORT_ROWS.length,
  },
  headers: ['Member', 'Unit', 'Date', 'Start', 'End'],
  column_mapping: {},
  fields: ['member_name', 'unit', 'agency', 'date', 'start_time', 'end_time'],
  member_mappings: {},
  unit_mappings: {},
  position_mappings: {},
  existing_shift_decisions: {},
  analysis: {
    can_commit: false,
    blocking_issue_count: 2,
    counts: {
      rows: HISTORY_IMPORT_ROWS.length,
      excluded: 1,
      skipped: 1,
      with_errors: 1,
      new_shifts: 2,
      existing_shifts: 1,
      attendances: 3,
      external_entries: 0,
      duplicates: 0,
    },
    rows: HISTORY_IMPORT_ROWS,
    members: [],
    units: [],
    positions: [],
    shifts: [],
    external: [],
    issues: [
      {
        code: 'member_unmatched',
        message: 'The member "Alexandra Ayala-Montgomery" matches no one on the department roster',
        blocking: true,
        row_ids: ['row-0'],
      },
      {
        code: 'unit_unmatched',
        message: 'The unit "Engine 21 Advanced Life Support Tanker Unit" matches no apparatus',
        blocking: true,
        row_ids: ['row-0'],
      },
    ],
    options: { members: [], units: [], seats: [] },
  },
};

// The shift history import's Rows tab lists every line of the uploaded file
// with its member, unit, times and why it blocks the commit. Seven columns of
// free text from a spreadsheet can overflow the review card on a tablet or a
// laptop, hiding the Exclude button at the end of each row.
test.describe('Shift history import — rows table', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/scheduling/admin/history-import/:id — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/scheduling/history-import/import-1**', (route) => {
        void route.fulfill(json(HISTORY_IMPORT_DETAIL));
      });
      await page.goto('/scheduling/admin/history-import/import-1');

      await page.getByRole('tab', { name: /^Rows/ }).click();
      await page.getByRole('button', { name: /^All \(/ }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Line' }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Shift history import rows table');
    });
  }
});

const MEMBER_HOURS_REPORT = {
  members: MEMBERS.map((member, i) => {
    const [firstName = '', lastName = ''] = member.split(' ');
    return {
      user_id: `member-${i}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@northfield-oakville-fire.example.org`,
      first_name: firstName,
      last_name: lastName,
      shifts_attended: 141 + i,
      worked_minutes: 101_340 + i * 60,
      worked_hours: 1689.25 + i,
      shifts_scheduled: 144 + i,
      scheduled_minutes: 103_680,
      scheduled_hours: 1728.5 + i,
      external_shifts: 13,
      external_minutes: 9_360,
      external_hours: 156.75,
    };
  }),
  period_start: '2026-01-01',
  period_end: '2026-10-31',
  total_members: MEMBERS.length,
};

const SHIFT_COMPLIANCE_REPORT = {
  reference_date: '2026-11-08',
  total_requirements: 1,
  requirements: [
    {
      requirement_id: 'requirement-1',
      requirement_name: 'Minimum Monthly Duty Crew Shift Commitment for Volunteer Firefighters',
      requirement_type: 'shifts',
      required_value: 4,
      frequency: 'monthly',
      period_start: '2026-11-01',
      period_end: '2026-11-30',
      members: MEMBERS.map((member, i) => {
        const [firstName = '', lastName = ''] = member.split(' ');
        return {
          user_id: `member-${i}`,
          first_name: firstName,
          last_name: lastName,
          full_name: member,
          rank: ['battalion_chief', 'captain', 'lieutenant', 'firefighter'][i] ?? 'firefighter',
          completed_value: 3,
          percentage: [100, 75, 50, 25][i] ?? 0,
          compliant: i === 0,
          shift_count: 112 + i,
          total_hours: 1344.5,
          external_shift_count: 12,
          external_hours: 144.25,
          catch_up_deadline: i === 3 ? '2026-12-15' : null,
        };
      }),
      total_members: MEMBERS.length,
      compliant_count: 1,
      non_compliant_count: 3,
      compliance_rate: 25,
    },
  ],
};

// The member hours report sets each member's name and email beside six figure
// columns; on a tablet with the side navigation open that is wider than the
// report card, which hid the difference and per-shift average off to the right.
test.describe('Scheduling reports — member hours table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/scheduling/admin/reports — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/scheduling/reports/member-hours**', (route) => {
        void route.fulfill(json(MEMBER_HOURS_REPORT));
      });
      await page.goto('/scheduling/admin/reports');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Avg Per Shift', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Member hours table');
    });
  }
});

// A shift compliance requirement expands into a table of its members with rank,
// shifts, hours, a progress bar and a status badge — wider than the expanded
// panel on a phone, where the status that answers the question was cut off.
test.describe('Scheduling reports — shift compliance members table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/scheduling/admin/reports (Shift Compliance) — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/scheduling/reports/compliance**', (route) => {
        void route.fulfill(json(SHIFT_COMPLIANCE_REPORT));
      });
      await page.goto('/scheduling/admin/reports');

      await page.getByRole('tab', { name: /Shift Compliance/ }).click();
      await page.getByText('Minimum Monthly Duty Crew Shift Commitment').first().click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Progress', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Shift compliance members table');
    });
  }
});
