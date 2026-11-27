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

// ── Medical supplies stock table ────────────────────────────────────────────
const SUPPLIES = ['Gloves', 'Bandages', 'Tourniquets'].map((name, i) => ({
  id: `supply-${i}`,
  organization_id: 'org-1',
  category_id: 'mcat-1',
  name,
  size: null,
  unit_of_measure: 'each',
  condition: 'good',
  status: 'available',
  tracking_type: 'pool',
  quantity: 10 * (i + 1),
  quantity_issued: 0,
  reorder_point: 5,
  is_lot_stocked: true,
  lot_stock: 10 * (i + 1),
  apparatus_stock: 0,
  apparatus_uncounted: 0,
  apparatus_count: 0,
  is_low_stock: false,
  next_expiration_date: '2026-12-15',
  days_until_next_expiration: 40,
  next_expiration_location: 'shelf',
  next_expiration_where: 'EMS Supply Room',
  storage_path: 'EMS Supply Room',
  apparatus_places: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}));

async function openMedicalSupplies(page: Page) {
  await signIn(page, { permissions: [...TEST_USER.permissions, 'inventory.view_medical', 'inventory.manage_medical'] });
  await page.route(
    '**/api/v1/medical-supplies/summary**',
    (route) =>
      void route.fulfill(
        json({
          total_items: 3,
          expiring_soon: 0,
          expired: 0,
          low_stock: 0,
          expiring_within_days: 60,
          uncounted_on_apparatus: 0,
        })
      )
  );
  await page.route(
    '**/api/v1/medical-supplies/categories**',
    (route) =>
      void route.fulfill(
        json([
          {
            id: 'mcat-1',
            organization_id: 'org-1',
            name: 'Basic Life Support',
            item_type: 'medical',
            is_active: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ])
      )
  );
  await page.route(
    '**/api/v1/medical-supplies/items?**',
    (route) => void route.fulfill(json({ items: SUPPLIES, total: SUPPLIES.length, skip: 0, limit: 50 }))
  );
  await page.goto('/medical-supplies?tab=stock');
  await expect(header(page, 'Reorder at')).toBeAttached();
}

test.describe('Medical supplies stock table sorts in card mode', () => {
  for (const viewport of [PHONE, TABLET]) {
    test(`/medical-supplies — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openMedicalSupplies(page);
      await sortDescendingBy(page, 'On hand');
      await expect(header(page, 'On hand')).toHaveAttribute('aria-sort', 'descending');
    });
  }

  test(`/medical-supplies — ${DESKTOP.name} keeps sorting in the headers`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openMedicalSupplies(page);
    await expect(header(page, 'On hand')).toBeVisible();
    await expect(sortBy(page)).toBeHidden();
  });
});

// ── Impact planner member list ──────────────────────────────────────────────
// A narrow tier (32rem): a tablet gives its card more than that, so only a
// phone shows it as cards.
const PLANNER_MEMBERS = ['Bianca Okafor', 'Aaron Lindqvist', 'Camila Reyes'].map((name, i) => ({
  user_id: `member-${i}`,
  full_name: name,
  membership_number: `FF-${i}`,
  rank: 'lieutenant',
  station: 'Station 14',
  status: 'active',
  needed_size: 'xl',
  has_size_on_file: true,
  has_related_item: false,
  needs_replacement: false,
  over_allowance: false,
  related_item_names: [],
  email: `${name.split(' ')[0]?.toLowerCase() ?? 'member'}@example.org`,
  phone: '(555) 867-5309',
}));

async function openImpactPlanner(page: Page) {
  await signIn(page, { permissions: [...TEST_USER.permissions, 'inventory.check_manage'] });
  await page.route(
    '**/api/v1/inventory/impact-planner/options',
    (route) =>
      void route.fulfill(
        json({
          statuses: [{ value: 'active', label: 'Active' }],
          membership_types: [],
          ranks: [{ value: 'lieutenant', label: 'Lieutenant' }],
          stations: [],
          positions: [],
          categories: [{ id: 'cat-1', name: 'Turnout Coats', item_type: 'uniform' }],
          size_fields: [{ value: 'jacket', label: 'Jacket' }],
        })
      )
  );
  await page.route('**/api/v1/inventory/impact-planner/plans', (route) => void route.fulfill(json([])));
  await page.route(
    '**/api/v1/inventory/impact-planner',
    (route) =>
      void route.fulfill(
        json({
          total_members: 3,
          members_with_related_item: 0,
          members_needing_item: 3,
          members_needing_replacement: 0,
          members_missing_sizes: 0,
          members_over_allowance: 0,
          replacement_aware: false,
          allowance_aware: false,
          size_field: 'jacket',
          size_breakdown: [{ size: 'xl', total: 3, needing: 3 }],
          stock_checked: false,
          cost_estimated: false,
          members: PLANNER_MEMBERS,
        })
      )
  );
  await page.goto('/inventory/admin/impact-planner');
  await page.getByRole('combobox', { name: 'Related category' }).selectOption('cat-1');
  await page.getByRole('button', { name: /Analyze Impact/i }).click();
}

const plannerTable = (page: Page) => page.getByRole('table').filter({ has: header(page, 'Contact') });

test.describe('Impact planner member list sorts in card mode', () => {
  test(`/inventory/admin/impact-planner — ${PHONE.name}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openImpactPlanner(page);
    const table = plannerTable(page);
    await table.waitFor();
    await sortDescendingBy(page, 'Member');
    await expect(header(page, 'Member')).toHaveAttribute('aria-sort', 'descending');
    await expectFirstRow(table, 'Member', /Camila Reyes/);
  });

  test(`/inventory/admin/impact-planner — ${DESKTOP.name} keeps sorting in the headers`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openImpactPlanner(page);
    await plannerTable(page).waitFor();
    await expect(header(page, 'Member')).toBeVisible();
    await expect(sortBy(page)).toBeHidden();
  });
});

// ── Grant applications ──────────────────────────────────────────────────────
// Sorted on the server, always by some column: the control asks the API for
// the chosen column and order, and offers no "Default order".
const GRANTS = ['Bravo', 'Alpha', 'Charlie'].map((name, i) => ({
  id: `grant-${i}`,
  organizationId: 'org-1',
  opportunityId: null,
  grantProgramName: `${name} Program`,
  grantAgency: 'FEMA',
  applicationStatus: 'submitted',
  amountRequested: 1000 * (i + 1),
  amountAwarded: null,
  matchAmount: null,
  matchSource: null,
  applicationDeadline: '2026-12-31',
  submittedDate: null,
  awardDate: null,
  grantStartDate: null,
  grantEndDate: null,
  projectDescription: null,
  narrativeSummary: null,
  budgetSummary: null,
  keyContacts: null,
  federalAwardId: null,
  nfirsCompliant: null,
  performancePeriodMonths: null,
  reportingFrequency: null,
  nextReportDue: null,
  finalReportDue: null,
  assignedTo: null,
  priority: 'high',
  linkedCampaignId: null,
  notes: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}));

async function openGrants(page: Page) {
  await signIn(page, {
    permissions: [...TEST_USER.permissions, 'fundraising.view', 'fundraising.manage', 'grants.view', 'grants.manage'],
  });
  await page.route('**/api/v1/grants/applications**', (route) => void route.fulfill(json(GRANTS)));
  await page.goto('/grants/applications');
  // The page opens on its pipeline view; the table is the other one.
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(header(page, 'Amount Requested')).toBeAttached();
}

test.describe('Grant applications sort in card mode', () => {
  for (const viewport of [PHONE, TABLET]) {
    test(`/grants/applications — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openGrants(page);
      await expect(page.getByRole('option', { name: 'Default order' })).toHaveCount(0);
      const sorted = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === '/api/v1/grants/applications' &&
          url.searchParams.get('sort') === 'amountRequested' &&
          url.searchParams.get('order') === 'desc'
        );
      });
      await sortDescendingBy(page, 'Amount Requested');
      await sorted;
    });
  }

  test(`/grants/applications — ${DESKTOP.name} keeps sorting in the headers`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openGrants(page);
    await expect(header(page, 'Amount Requested')).toBeVisible();
    await expect(sortBy(page)).toBeHidden();
  });
});

// ── Inventory items ─────────────────────────────────────────────────────────
// Its own "Sort:" control sits above up to three xwide-tier tables (Pinned,
// Available, Unavailable) and drives the server's sort. It must show wherever
// those tables are cards: on a phone, and on a tablet or a laptop with the
// side navigation open, where their card is under 78rem.
const INVENTORY_ITEMS = ['Radio', 'Helmet', 'Thermal camera'].map((name, i) => ({
  id: `item-${i}`,
  organization_id: 'org-1',
  category_id: 'cat-1',
  name,
  manufacturer: null,
  model_number: null,
  serial_number: `SN-${i}`,
  asset_tag: `AT-${i}`,
  barcode: null,
  purchase_price: null,
  storage_location: 'Station 14',
  size: null,
  color: null,
  style: null,
  condition: 'good',
  status: 'available',
  tracking_type: 'individual',
  quantity: 1,
  quantity_issued: 0,
  unit_of_measure: 'each',
  reorder_point: null,
  pin_position: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}));

async function openInventory(page: Page) {
  await signIn(page, { permissions: [...TEST_USER.permissions, 'inventory.view', 'inventory.manage'] });
  await page.route(
    '**/api/v1/inventory/items?**',
    (route) => void route.fulfill(json({ items: INVENTORY_ITEMS, total: INVENTORY_ITEMS.length, skip: 0, limit: 50 }))
  );
  await page.route(
    '**/api/v1/inventory/categories**',
    (route) =>
      void route.fulfill(
        json([
          {
            id: 'cat-1',
            organization_id: 'org-1',
            name: 'Equipment',
            item_type: 'equipment',
            is_active: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ])
      )
  );
  await page.goto('/inventory/admin/items');
  await page.getByRole('table', { name: 'Available' }).waitFor();
}

const inventorySort = (page: Page) => page.getByRole('combobox', { name: 'Sort:' });

test.describe('Inventory items sort in card mode', () => {
  for (const viewport of [PHONE, TABLET, { name: 'iPad Pro portrait 1024x1366', width: 1024, height: 1366 }]) {
    test(`/inventory/admin/items — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openInventory(page);
      const sorted = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return (
          url.pathname === '/api/v1/inventory/items' &&
          url.searchParams.get('sort_by') === 'condition' &&
          url.searchParams.get('sort_order') === 'desc'
        );
      });
      await inventorySort(page).selectOption({ label: 'Condition' });
      await page.getByRole('button', { name: 'Sort descending' }).click();
      await sorted;
    });
  }

  test(`/inventory/admin/items — ${DESKTOP.name} keeps sorting in the headers`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openInventory(page);
    await expect(page.getByRole('table', { name: 'Available' }).locator('thead')).toBeVisible();
    await expect(inventorySort(page)).toBeHidden();
  });
});
