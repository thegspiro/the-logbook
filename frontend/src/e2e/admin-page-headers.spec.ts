import { test, expect, type Page } from '@playwright/test';
import { json, signIn, openNavigation } from './helpers';

/**
 * Every page in the Administration menu draws the shared admin header: an
 * "Administration" eyebrow, one <h1> carrying the page's menu name, and the
 * header controls beside it. The unit tests prove the component; this proves
 * each page actually renders it, in a browser, under its real route.
 */

const ADMIN_PERMISSIONS = [
  'settings.manage',
  'members.manage',
  'members.manage_id_cards',
  'members.check_in',
  'users.view',
  'users.view_consents',
  'prospective_members.manage',
  'medical_screening.view',
  'medical_screening.manage',
  'events.manage',
  'training.manage',
  'scheduling.manage',
  'inventory.manage',
  'storefront.manage',
  'admin_hours.manage',
  'notifications.manage',
  'suggestions.manage',
  'forms.manage',
  'reports.view',
  'analytics.view',
  'audit.view',
  'positions.manage_permissions',
  'organization.update_settings',
  'inventory.check_manage',
  'elections.manage',
  'minutes.manage',
  'facilities.manage',
  'finance.manage',
  'finance.configure_approvals',
  'history.manage',
  'compliance.manage',
];

/** [path, the <h1> the page must carry] */
const PAGES: [string, string][] = [
  ['/setup', 'Department Setup'],
  ['/prospective-members', 'Prospective Members'],
  ['/prospective-members/settings', 'Pipeline Settings'],
  ['/members/admin', 'Members Administration'],
  ['/members/scan', 'Scan Member ID'],
  ['/members/admin/waivers', 'Waivers'],
  ['/medical-screening', 'Medical Screening'],
  ['/events/admin', 'Events Administration'],
  ['/training/admin', 'Training Administration'],
  ['/scheduling/admin', 'Scheduling Administration'],
  ['/inventory/admin', 'Inventory Administration'],
  ['/admin-hours/manage', 'Admin Hours'],
  ['/communications/email-templates', 'Email Templates'],
  ['/communications/member-emails', 'Member Emails & Texts'],
  ['/communications/messages', 'Department Messages'],
  ['/communications/suggestion-boxes', 'Suggestion Boxes'],
  ['/communications/photo-use-consent', 'Photo Use Consent'],
  ['/forms', 'Forms'],
  ['/integrations', 'Integrations'],
  ['/reports', 'Reports'],
  ['/settings', 'Organization Settings'],
  ['/settings/roles', 'Role Management'],
  ['/admin/public-portal', 'Public Portal'],
  ['/admin/platform-analytics', 'Platform Analytics'],
  ['/admin/analytics', 'QR Code Analytics'],
  ['/admin/audit-log', 'Audit Log'],
  ['/admin/security-alerts', 'Security Alerts'],
  ['/admin/errors', 'Error Monitor'],
  ['/testing', 'Testing Home'],
  // Sub-pages: hub pages render the hub's own <h1>; settings screens their own.
  ['/members/admin/settings/visibility', 'Members Settings'],
  ['/inventory/admin/checklists/settings', 'Inventory Administration'],
  ['/inventory/admin/checklists/catalog-links', 'Inventory Administration'],
  ['/training/compliance-config', 'Compliance Settings'],
  ['/elections/settings', 'Election Settings'],
  ['/minutes/settings', 'Minutes Settings'],
  ['/facilities/settings', 'Facility Settings'],
  ['/finance/settings', 'Finance Settings'],
  ['/finance/settings/approval-chains', 'Approval Chains'],
  ['/finance/settings/quickbooks', 'QuickBooks Export'],
  ['/history/settings', 'Titles and Clearance'],
];

/**
 * Pages whose title does not start at the gutter, by design: a centred
 * narrow column (the setup checklist, the camera view) or the settings-screen
 * layout, which centres a 960px column and puts its icon tile before the title.
 */
const NARROW_COLUMN = new Set([
  '/setup',
  '/members/scan',
  '/settings',
  '/communications/email-templates',
  '/members/admin/settings/visibility',
  '/history/settings',
]);

const shotDir = process.env.ADMIN_HEADER_SHOTS;

/**
 * Shapes for the pages the shared fixtures do not cover. The catch-all
 * answers `{}`, which these pages read as a list and crash on before drawing
 * their header -- the same on the code before this header existed, so the gap
 * is in the fixtures, not the pages. Registered after `signIn`, so they take
 * precedence over the catch-all.
 */
const EMPTY_BY_PATH: Record<string, unknown> = {
  '/api/v1/organization/setup-checklist': { items: [], completed_count: 0, total_count: 0, enabled_modules: [] },
  '/api/v1/messages': { messages: [], total: 0 },
  '/api/v1/messages/roles': [],
  '/api/v1/platform-analytics': {
    totalUsers: 0,
    activeUsers: 0,
    inactiveUsers: 0,
    newUsersLast30Days: 0,
    adoptionRate: 0,
    loginTrend: [],
    modules: [],
    totalEvents: 0,
    eventsLast30Days: 0,
    totalCheckIns: 0,
    trainingHoursLast30Days: 0,
    formsSubmittedLast30Days: 0,
    errorsLast7Days: 0,
    errorTrend: [],
    topErrorTypes: {},
    totalDocuments: 0,
    documentsLast30Days: 0,
    generatedAt: '2026-11-05T12:00:00Z',
  },
  '/api/v1/errors': { errors: [], total: 0 },
  '/api/v1/errors/stats': { total: 0, by_type: {}, recent_errors: [] },
  '/api/v1/errors/codes': { codes: [] },
  '/api/v1/equipment-checks/inventory-link-report': {
    coverage: { linkable: 0, linked: 0, unlinked: 0 },
    templateCount: 0,
    groups: [],
  },
};

async function mockUncoveredPages(page: Page) {
  await page.route(
    (url) => url.pathname in EMPTY_BY_PATH,
    (route) => route.fulfill(json(EMPTY_BY_PATH[new URL(route.request().url()).pathname]))
  );
}

async function expectAdminHeader(page: Page, path: string, title: string) {
  await page.goto(path);
  const h1 = page.locator('h1:visible');
  await expect(h1.first()).toHaveText(title, { timeout: 15_000 });
  await expect(h1).toHaveCount(1);
  // The eyebrow sits directly above the title in the same header block.
  const header = h1.first().locator('xpath=..');
  await expect(header.getByText('Administration', { exact: true })).toBeVisible();
  if (!NARROW_COLUMN.has(path)) {
    // The title starts at the layout's own gutter. A page that pads its own
    // wrapper as well doubles the gutter and its header sits 32px further in
    // than its neighbours'.
    const gutterLeft = await page.locator('[data-page-layout="application"]').evaluate((el) => {
      const box = el.getBoundingClientRect();
      return box.left + parseFloat(getComputedStyle(el).paddingLeft);
    });
    const titleLeft = (await h1.first().boundingBox())?.x ?? -1;
    expect(Math.abs(titleLeft - gutterLeft), `${path} header inset`).toBeLessThanOrEqual(2);
  }
  if (shotDir) {
    await page.screenshot({ path: `${shotDir}/${path.replace(/\//g, '_').replace(/^_/, '')}.png` });
  }
}

test.describe('administration page headers', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, { permissions: ADMIN_PERMISSIONS });
    await mockUncoveredPages(page);
  });

  for (const [path, title] of PAGES) {
    test(`${path} carries the shared header titled "${title}"`, async ({ page }) => {
      await expectAdminHeader(page, path, title);
    });
  }

  test('Manage Events opens the Events Administration hub', async ({ page }) => {
    await page.goto('/dashboard');
    await openNavigation(page);
    await page.locator('aside, nav').getByRole('button', { name: 'Manage Events' }).first().click();
    await expect(page).toHaveURL(/\/events\/admin$/);
    await expect(page.locator('h1:visible')).toHaveText('Events Administration');
  });
});

test.describe('administration menu for a narrow grant', () => {
  test('an audit.view holder finds Audit Log in the side menu', async ({ page }) => {
    await signIn(page, { permissions: ['audit.view'] });
    await page.goto('/dashboard');
    await openNavigation(page);
    const nav = page.locator('aside, nav');
    await nav.getByRole('button', { name: 'Organization Settings' }).first().click();
    await nav.getByRole('button', { name: 'Audit Log' }).first().click();
    await expect(page).toHaveURL(/\/admin\/audit-log$/);
    await expect(page.locator('h1:visible')).toHaveText('Audit Log');
  });
});
