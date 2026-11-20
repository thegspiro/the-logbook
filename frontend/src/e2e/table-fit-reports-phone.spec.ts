import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';
import type {
  CertExpirationReport,
  EventAttendanceReport,
  MemberRosterReport,
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

// Nine columns with a long certification, agency and rank: the widest report.
test.describe('Certification expiration report table fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/reports certification expiration — ${viewport.name}`, async ({ page }) => {
      await openReport(page, viewport, 'Certification Expiration', certificationExpiration);
      const table = reportTable(page, 'Issuing Agency');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Certification expiration table');
    });
  }
});

// Eight columns with a long email address and a list of roles.
test.describe('Member roster report table fits its card', () => {
  for (const viewport of VIEWPORTS) {
    test(`/reports member roster — ${viewport.name}`, async ({ page }) => {
      await openReport(page, viewport, 'Member Roster', memberRoster);
      const table = reportTable(page, 'Member #');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Member roster table');
    });
  }
});
