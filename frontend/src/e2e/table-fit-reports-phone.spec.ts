import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';
import type {
  CertExpirationReport,
  EventAttendanceReport,
  MemberRosterReport,
  PositionHoursReport,
  TrainingSummaryReport,
} from '../modules/reports/types';

const GENERATED_AT = '2026-10-14T15:30:00Z';
const PERIOD = { period_start: '2026-01-01', period_end: '2026-12-31' };

const MEMBER_NAMES = [
  'Alexandria Montgomery-Fitzgerald',
  'Bartholomew Christopherson-Vandenberg',
  'Maximiliana Rodriguez-Castellanos',
  'Jonathan Kowalczyk-Abernathy',
];

const trainingSummary: TrainingSummaryReport = {
  report_type: 'training_summary',
  generated_at: GENERATED_AT,
  ...PERIOD,
  total_courses: 4,
  total_records: 96,
  completion_rate: 87,
  entries: MEMBER_NAMES.map((name, i) => ({
    member_id: `member-${i}`,
    member_name: name,
    total_courses: 24,
    completed_courses: 21,
    total_hours: 1284.75,
    compliance_percentage: 88,
  })),
  course_breakdown: [],
  requirement_breakdown: [],
};

const eventAttendance: EventAttendanceReport = {
  report_type: 'event_attendance',
  generated_at: GENERATED_AT,
  ...PERIOD,
  total_events: 4,
  average_attendance_rate: 82.5,
  events: [0, 1, 2, 3].map((i) => ({
    event_id: `event-${i}`,
    event_title: 'Quarterly Business Meeting and Officer Election with Pension Board Presentation',
    event_date: '2026-09-30',
    total_rsvps: 148,
    attended: 122,
    attendance_rate: 82.4,
  })),
};

const certificationExpiration: CertExpirationReport = {
  report_type: 'certification_expiration',
  generated_at: GENERATED_AT,
  total_certifications: 4,
  expired_count: 1,
  expiring_soon_count: 1,
  valid_count: 2,
  no_expiry_count: 0,
  entries: MEMBER_NAMES.map((name, i) => ({
    member_id: `member-${i}`,
    member_name: name,
    rank: 'Battalion Chief of Training and Professional Development',
    course_name: 'NFPA 1001 Firefighter II Certification with Hazardous Materials Operations',
    certification_number: `PA-FF2-2024-00187${30 + i}`,
    issuing_agency: 'Pennsylvania State Fire Academy, Office of the State Fire Commissioner',
    completion_date: '2024-09-30',
    expiration_date: '2027-09-30',
    days_until_expiry: 349,
    expiry_status: i === 0 ? 'expiring_soon' : 'valid',
    source: 'The Logbook',
  })),
};

const memberRoster: MemberRosterReport = {
  report_type: 'member_roster',
  generated_at: GENERATED_AT,
  total_members: 4,
  active_members: 4,
  inactive_members: 0,
  members: MEMBER_NAMES.map((name, i) => ({
    id: `member-${i}`,
    first_name: name.split(' ')[0] ?? name,
    last_name: name.split(' ')[1] ?? name,
    email: `${(name.split(' ')[0] ?? name).toLowerCase()}.longsurname@northwestvolunteerfirecompany.org`,
    membership_number: `NWVFC-2019-0${410 + i}`,
    rank: 'Battalion Chief of Training and Professional Development',
    status: 'active',
    station: 'Station 14 - Northwest Headquarters Annex',
    joined_date: '2019-03-15',
    roles: ['Training Officer', 'Safety Committee Chair', 'Apparatus Committee'],
  })),
};

const positionHours: PositionHoursReport = {
  report_type: 'position_hours',
  generated_at: GENERATED_AT,
  ...PERIOD,
  summary: {
    total_hours: 2568,
    total_shifts: 214,
    total_calls: 512,
    members: 4,
    by_position: [{ position: 'Rescue Technician / Heavy Rescue', hours: 2568, shifts: 214, calls: 512, members: 4 }],
  },
  entries: MEMBER_NAMES.map((name) => ({
    member_name: name,
    position: 'Rescue Technician / Heavy Rescue',
    hours: 642.25,
    shifts: 53,
    calls: 128,
  })),
};

async function openReport(
  page: Page,
  viewport: { width: number; height: number },
  title: string,
  report: unknown
): Promise<void> {
  await page.setViewportSize(viewport);
  await signIn(page, { permissions: ['*'] });
  await page.route('**/api/v1/reports/generate', (route) => void route.fulfill(json(report)));
  await page.goto('/reports');
  await page
    .getByRole('heading', { name: title, exact: true })
    .locator('..')
    .getByRole('button', { name: 'Generate Report' })
    .click();
}

function reportTable(page: Page, header: string) {
  return page
    .getByRole('dialog')
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: header, exact: true }) });
}

const VIEWPORTS = [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS];

/**
 * A report too wide for the dialog is a table from 768px up, as every report
 * was before the reflow: sorting lives in its column headers, which card mode
 * hides, so it scrolls sideways rather than lose them. The scroll area takes
 * focus because nothing else in the table does, or a keyboard could not reach
 * the columns past its edge.
 */
async function expectSortableTable(page: Page, table: ReturnType<typeof reportTable>, firstHeader: string) {
  await expect(
    table.getByRole('columnheader', { name: firstHeader, exact: true }),
    'the headers are hidden'
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('region', { name: 'Report results' }),
    'the sideways-scrolling table cannot be reached from the keyboard'
  ).toHaveAttribute('tabindex', '0');
}

// The shared report table, four columns: the training summary's member tab.
test.describe('Training summary report table fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/reports training summary — ${viewport.name}`, async ({ page }) => {
      await openReport(page, viewport, 'Training & Program Progress Summary', trainingSummary);
      const table = reportTable(page, 'Total Courses');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Training summary table');
    });
  }
});

// Five columns: a long event title, its date and three numbers.
test.describe('Event attendance report table fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/reports event attendance — ${viewport.name}`, async ({ page }) => {
      await openReport(page, viewport, 'Event Attendance', eventAttendance);
      const table = reportTable(page, 'Attendance Rate');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Event attendance table');
    });
  }
});

// Five columns: a member, a long department-named seat and three numbers.
test.describe('Hours by position report table fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/reports hours by position — ${viewport.name}`, async ({ page }) => {
      await openReport(page, viewport, 'Hours by Position', positionHours);
      const table = reportTable(page, 'Position');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Hours by position table');
    });
  }
});

// Nine columns with a long certification, agency and rank: the widest report.
test.describe('Certification expiration report: cards on a phone, a sortable table from 768px', () => {
  for (const viewport of VIEWPORTS) {
    test(`/reports certification expiration — ${viewport.name}`, async ({ page }) => {
      await openReport(page, viewport, 'Certification Expiration', certificationExpiration);
      const table = reportTable(page, 'Issuing Agency');
      await table.waitFor();
      if (viewport.width < 768) {
        await expectTableFitsItsCard(table, 'Certification expiration table');
        return;
      }
      await expectSortableTable(page, table, 'Member');
      // Sorted from the keyboard: the header is a button, and Enter on it is
      // what a keyboard or switch user does.
      const firstMember = table.locator('tbody tr').first().locator('td').first();
      const sortByMember = table.getByRole('button', { name: 'Member', exact: true });
      await sortByMember.focus();
      await page.keyboard.press('Enter');
      await expect(firstMember, 'sorting by member did not reorder the rows').toHaveText(/^Alexandria/);
      await page.keyboard.press('Enter');
      await expect(firstMember, 'sorting by member did not reverse').toHaveText(/^Maximiliana/);
    });
  }
});

// Eight columns with a long email address and a list of roles.
test.describe('Member roster report: cards on a phone, a sortable table from 768px', () => {
  for (const viewport of VIEWPORTS) {
    test(`/reports member roster — ${viewport.name}`, async ({ page }) => {
      await openReport(page, viewport, 'Member Roster', memberRoster);
      const table = reportTable(page, 'Member #');
      await table.waitFor();
      if (viewport.width < 768) {
        await expectTableFitsItsCard(table, 'Member roster table');
        return;
      }
      await expectSortableTable(page, table, 'Name');
    });
  }
});
