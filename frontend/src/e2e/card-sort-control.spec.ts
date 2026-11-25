import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';

// A table showing as cards hides its <thead>, and the column headers are where
// sorting lives, so card mode gets its own "Sort by" control. It must show
// exactly while the headers are hidden: on a phone, and on a tablet for a
// tiered table whose card is still narrower than its tier. At a desktop width
// the table is a table and the headers are the only sort control.

const PHONE = { name: 'iPhone 390x844', width: 390, height: 844 };
const TABLET = { name: 'iPad portrait 820x1180', width: 820, height: 1180 };
const DESKTOP = { name: 'desktop 1920x1080', width: 1920, height: 1080 };

const sortBy = (page: Page) => page.getByRole('combobox', { name: 'Sort by' });

const header = (page: Page, name: string) => page.getByRole('columnheader', { includeHidden: true, name, exact: true });

async function sortDescendingBy(page: Page, label: string) {
  await sortBy(page).selectOption({ label });
  await page.getByRole('button', { name: 'Sort descending' }).click();
}

// The first row's cell for a column, by its card label; a row can open with a
// selection checkbox rather than the record's name.
async function expectFirstRow(table: Locator, label: string, text: RegExp) {
  await expect(table.locator('tbody tr').first().locator(`td[data-label="${label}"]`)).toHaveText(text);
}

// ── Members roster ──────────────────────────────────────────────────────────
const MEMBERS: [string, string][] = [
  ['Bartholomew', 'Kowalczyk'],
  ['Alexandra', 'Ayala'],
  ['Maximiliano', 'Fitzgerald'],
];
const ROSTER = MEMBERS.map(([first, last], i) => ({
  id: `member-${i}`,
  organization_id: 'org-1',
  username: `${first.toLowerCase()}.${last.toLowerCase()}`,
  email: `${first.toLowerCase()}@example.org`,
  first_name: first,
  last_name: last,
  rank: 'firefighter',
  membership_number: `M-00${i + 1}`,
  status: 'active',
  hire_date: `201${i + 2}-04-17`,
  roles: [],
  positions: [],
}));

async function openMembers(page: Page) {
  await signIn(page, { permissions: [...TEST_USER.permissions, 'members.manage_id_cards'] });
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => void route.fulfill(json(ROSTER))
  );
  await page.route('**/api/v1/users/contact-info-enabled**', (route) => void route.fulfill(json({ enabled: false })));
  await page.goto('/members');
  await expect(header(page, 'Member')).toBeAttached();
}

test.describe('Members roster sorts in card mode', () => {
  for (const viewport of [PHONE, TABLET]) {
    test(`/members — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openMembers(page);
      await sortDescendingBy(page, 'Member');
      await expect(header(page, 'Member')).toHaveAttribute('aria-sort', 'descending');
    });
  }

  test(`/members — ${DESKTOP.name} keeps sorting in the headers`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openMembers(page);
    await expect(header(page, 'Member')).toBeVisible();
    await expect(sortBy(page)).toBeHidden();
  });
});

// ── Applicant pipeline ──────────────────────────────────────────────────────
const APPLICANTS = ['Bianca', 'Aaron', 'Camila'].map((first, i) => ({
  id: `prospect-${i}`,
  first_name: first,
  last_name: 'Okafor',
  email: `${first.toLowerCase()}@example.org`,
  phone: '(555) 867-5309',
  status: 'active',
  pipeline_id: 'pipeline-1',
  pipeline_name: 'Membership Pipeline',
  current_step_id: 'step-1',
  current_step_name: 'Application Received',
  desired_membership_type: 'probationary',
  created_at: '2026-03-14T15:30:00Z',
  updated_at: '2026-09-22T18:45:00Z',
  stage_entered_at: '2026-08-01T12:00:00Z',
  days_in_stage: 10 + i,
  days_in_pipeline: 20 + i,
}));
const PIPELINE = {
  id: 'pipeline-1',
  organization_id: 'org-1',
  name: 'Membership Pipeline',
  description: null,
  is_template: false,
  is_default: true,
  is_active: true,
  auto_transfer_on_approval: false,
  inactivity_config: null,
  conversion_config: {},
  public_status_enabled: false,
  public_show_future_stages: false,
  report_stage_groups: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  steps: [
    {
      id: 'step-1',
      pipeline_id: 'pipeline-1',
      name: 'Application Received',
      description: null,
      step_type: 'action',
      action_type: null,
      is_first_step: true,
      is_final_step: false,
      sort_order: 1,
      email_template_id: null,
      required: true,
      config: null,
      notify_prospect_on_completion: false,
      public_visible: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  prospect_count: 3,
};

async function openPipeline(page: Page) {
  await signIn(page, {
    permissions: [...TEST_USER.permissions, 'prospective_members.view', 'prospective_members.manage'],
  });
  await page.route('**/api/v1/prospective-members/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/pipelines/pipeline-1')) return void route.fulfill(json(PIPELINE));
    if (path.endsWith('/pipelines')) return void route.fulfill(json([{ ...PIPELINE, step_count: 1 }]));
    if (path.endsWith('/prospects')) {
      return void route.fulfill(json({ items: APPLICANTS, total: APPLICANTS.length, limit: 25, offset: 0 }));
    }
    return void route.fulfill(json([]));
  });
  await page.goto('/prospective-members');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
}

const pipelineTable = (page: Page) => page.getByRole('table').filter({ has: header(page, 'Target Type') });

test.describe('Applicant pipeline sorts in card mode', () => {
  for (const viewport of [PHONE, TABLET]) {
    test(`/prospective-members — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openPipeline(page);
      const table = pipelineTable(page);
      await table.waitFor();
      await sortDescendingBy(page, 'Name');
      await expect(header(page, 'Name')).toHaveAttribute('aria-sort', 'descending');
      await expectFirstRow(table, 'Name', /Camila/);
    });
  }

  test(`/prospective-members — ${DESKTOP.name} keeps sorting in the headers`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openPipeline(page);
    await expect(header(page, 'Name')).toBeVisible();
    await expect(sortBy(page)).toBeHidden();
  });
});

// ── Member training status ──────────────────────────────────────────────────
const MEMBER_STATUS = {
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  generated_at: '2026-11-01T10:00:00Z',
  members: [
    ['Bianca Okafor', 5],
    ['Aaron Lindqvist', 40],
    ['Camila Reyes', 12],
  ].map(([name, trainings], i) => ({
    user_id: `member-${i}`,
    member_name: name,
    trainings_completed: trainings,
    hours_completed: 10 * (i + 1),
    last_activity: '2026-09-14',
    compliance_status: 'green',
    requirements_met: 12,
    requirements_total: 14,
  })),
};

async function openTrainingStatus(page: Page) {
  await signIn(page, { permissions: ['*'] });
  await page.route('**/api/v1/training/records/member-status**', (route) => void route.fulfill(json(MEMBER_STATUS)));
  await page.goto('/training/admin?page=records&tab=member-status');
}

const statusTable = (page: Page) =>
  page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: /^Last activity/ }) });

test.describe('Member training status sorts in card mode', () => {
  for (const viewport of [PHONE, TABLET]) {
    test(`/training member status — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openTrainingStatus(page);
      const table = statusTable(page);
      await table.waitFor();
      await sortDescendingBy(page, 'Trainings');
      await expect(header(page, 'Trainings')).toHaveAttribute('aria-sort', 'descending');
      await expectFirstRow(table, 'Member', /Aaron Lindqvist/);
    });
  }

  test(`/training member status — ${DESKTOP.name} keeps sorting in the headers`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openTrainingStatus(page);
    await statusTable(page).waitFor();
    await expect(header(page, 'Trainings')).toBeVisible();
    await expect(sortBy(page)).toBeHidden();
  });
});

// ── Report table ────────────────────────────────────────────────────────────
const CERT_REPORT = {
  report_type: 'certification_expiration',
  generated_at: '2026-10-14T15:30:00Z',
  total_certifications: 3,
  expired_count: 0,
  expiring_soon_count: 0,
  valid_count: 3,
  no_expiry_count: 0,
  entries: ['Bianca Okafor', 'Aaron Lindqvist', 'Camila Reyes'].map((name, i) => ({
    member_id: `member-${i}`,
    member_name: name,
    rank: 'Captain',
    course_name: 'Firefighter II',
    certification_number: `FF2-${i}`,
    issuing_agency: 'State Fire Academy',
    completion_date: '2024-09-30',
    expiration_date: '2027-09-30',
    days_until_expiry: 300 + i,
    expiry_status: 'valid',
    source: 'The Logbook',
  })),
};

async function openCertReport(page: Page) {
  await signIn(page, { permissions: ['*'] });
  await page.route('**/api/v1/reports/generate', (route) => void route.fulfill(json(CERT_REPORT)));
  await page.goto('/reports');
  await page
    .getByRole('heading', { name: 'Certification Expiration', exact: true })
    .locator('..')
    .getByRole('button', { name: 'Generate Report' })
    .click();
}

const certTable = (page: Page) =>
  page
    .getByRole('dialog')
    .getByRole('table')
    .filter({ has: header(page, 'Issuing Agency') });

test.describe('Report table sorts in card mode', () => {
  test(`/reports certification expiration — ${PHONE.name}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openCertReport(page);
    const table = certTable(page);
    await table.waitFor();
    await sortDescendingBy(page, 'Member');
    await expect(header(page, 'Member')).toHaveAttribute('aria-sort', 'descending');
    await expectFirstRow(table, 'Member', /Camila Reyes/);
  });

  test(`/reports certification expiration — ${DESKTOP.name} keeps sorting in the headers`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openCertReport(page);
    await certTable(page).waitFor();
    await expect(header(page, 'Member')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Sort by' })).toBeHidden();
  });
});
