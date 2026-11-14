import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const APPLICANT_NAMES: [string, string][] = [
  ['Alexandra', 'Ayala-Montgomery'],
  ['Christopher', 'Vandenberghe-Whitfield'],
  ['Maria-Guadalupe', 'Fernandez-Castellanos'],
  ['Jonathan', 'Okonkwo-Richardson'],
];

const prospects = (status: string) =>
  APPLICANT_NAMES.map(([firstName, lastName], i) => ({
    id: `prospect-${status}-${i}`,
    first_name: firstName,
    last_name: lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@oakville-volunteer-fire.org`,
    phone: '(555) 867-5309',
    status,
    pipeline_id: 'pipeline-1',
    pipeline_name: 'Volunteer Firefighter Membership Pipeline',
    current_step_id: 'step-2',
    current_step_name: 'Background Check and Driving Record Review',
    desired_membership_type: 'probationary',
    created_at: '2026-03-14T15:30:00Z',
    updated_at: '2026-09-22T18:45:00Z',
    stage_entered_at: '2026-08-01T12:00:00Z',
    days_in_stage: 128,
    days_in_pipeline: 239,
    days_since_activity: 112,
    inactivity_alert_level: 'critical',
    inactivity_timeout_days: 90,
    target_role_name: 'Probationary Interior Firefighter',
    deactivated_at: '2026-09-30T12:00:00Z',
    withdrawn_at: '2026-10-02T12:00:00Z',
    withdrawal_reason:
      'Accepted a full-time position with a neighbouring career department and relocated out of district',
    contact_change_pending: false,
    my_roles: [],
  }));

const step = (id: string, name: string, sortOrder: number) => ({
  id,
  pipeline_id: 'pipeline-1',
  name,
  description: null,
  step_type: 'manual_approval',
  action_type: null,
  is_first_step: sortOrder === 1,
  is_final_step: sortOrder === 3,
  sort_order: sortOrder,
  email_template_id: null,
  required: true,
  config: null,
  inactivity_timeout_days: null,
  notify_prospect_on_completion: false,
  public_visible: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const pipeline = {
  id: 'pipeline-1',
  organization_id: 'org-1',
  name: 'Volunteer Firefighter Membership Pipeline',
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
    step('step-1', 'Application Received', 1),
    step('step-2', 'Background Check and Driving Record Review', 2),
    step('step-3', 'Membership Vote', 3),
  ],
  prospect_count: 4,
};

const pipelineList = [
  {
    id: 'pipeline-1',
    name: pipeline.name,
    description: null,
    is_template: false,
    is_default: true,
    is_active: true,
    auto_transfer_on_approval: false,
    step_count: 3,
    prospect_count: 4,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const stats = {
  pipeline_id: 'pipeline-1',
  total_prospects: 20,
  active_count: 4,
  on_hold_count: 0,
  inactive_count: 4,
  approved_count: 0,
  rejected_count: 4,
  withdrawn_count: 4,
  transferred_count: 4,
  by_step: [],
  avg_days_to_transfer: 40,
  conversion_rate: 20,
};

async function openPipeline(page: Page) {
  await signIn(page, {
    permissions: [...TEST_USER.permissions, 'prospective_members.view', 'prospective_members.manage'],
  });
  await page.route('**/api/v1/prospective-members/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/stats')) return void route.fulfill(json(stats));
    if (path.endsWith('/pipelines/pipeline-1')) return void route.fulfill(json(pipeline));
    if (path.endsWith('/pipelines')) return void route.fulfill(json(pipelineList));
    if (path.endsWith('/prospects')) {
      const items = prospects(url.searchParams.get('status') ?? 'active');
      return void route.fulfill(json({ items, total: items.length, limit: 25, offset: 0 }));
    }
    return void route.fulfill(json([]));
  });
  await page.goto('/prospective-members');
}

const tableWithHeader = (page: Page, header: string) =>
  page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: header, exact: true }) });

// The active pipeline's table view: selection, name, email, stage, status,
// days in stage, target type, applied date and a row menu.
test.describe('Applicant pipeline table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/prospective-members table view — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openPipeline(page);
      await page.getByRole('button', { name: 'Table', exact: true }).click();

      const table = tableWithHeader(page, 'Target Type');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Applicant pipeline table');
    });
  }
});

// The four archive tabs: each a name, email, stage and two date or reason
// columns plus an action, with long emails and stage names.
const ARCHIVE_TABS = [
  { tab: 'Inactive Applications', header: 'Inactive Since' },
  { tab: 'Rejected', header: 'Stage Reached' },
  { tab: 'Withdrawn', header: 'Withdrawn Date' },
  { tab: 'Converted', header: 'Final Stage' },
];

for (const { tab, header } of ARCHIVE_TABS) {
  test.describe(`${tab} applicants table fits its card`, () => {
    for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
      test(`/prospective-members ${tab} — ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openPipeline(page);
        await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();

        const table = tableWithHeader(page, header);
        await table.waitFor();
        await expectTableFitsItsCard(table, `${tab} applicants table`);
      });
    }
  });
}
