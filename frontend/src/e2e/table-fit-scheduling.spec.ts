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
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
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
