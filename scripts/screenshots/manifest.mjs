/**
 * Declarative list of documentation screenshots.
 *
 * Each entry ties one placeholder in `docs/training/*.md` to the application
 * state that fills it:
 *
 *   id       output filename (without .png) and the key `apply_placeholders.py`
 *            matches on — keep it stable once a shot has been applied
 *   doc      training guide the placeholder lives in
 *   line     1-based line number of the `> **Screenshot ...` marker as of the
 *            time the entry was written; the applier re-verifies the marker is
 *            still there before rewriting anything
 *   alt      alt text written into the markdown image tag
 *   route    path to visit, relative to the dev server root
 *   auth     'anonymous' to shoot a signed-out page in a separate context
 *   prepare  optional async (page) => void that drives the UI into the pictured
 *            state (open a modal, switch a tab, expand a panel)
 *   selector optional CSS/locator to clip to instead of the full viewport
 *   fullPage capture the whole scroll height rather than the viewport
 *   viewport 'mobile' to shoot at phone width instead of desktop
 *
 * Entries are grouped by guide and ordered by the placeholder's position in it.
 * This file covers the placeholders a plain route visit satisfies; the ones
 * that picture a modal, a specific tab, or a hover state still need `prepare`
 * steps and are tracked in `docs/training/SCREENSHOT_STATUS.md`.
 */

export const DEMO_CREDENTIALS = {
  username: 'chief',
  password: 'DemoP@ssw0rd!2026',
};

/** Click a tab/button by its visible label, tolerating pages that lack it. */
export function clickByName(name) {
  return async (page) => {
    const target = page.getByRole('button', { name }).or(page.getByRole('tab', { name }));
    await target.first().click({ timeout: 5_000 });
  };
}

export const SHOTS = [
  // ── 00 Getting Started ──────────────────────────────────────────────
  {
    id: '00-01-login-page',
    doc: '00-getting-started.md',
    line: 28,
    alt: 'The Logbook login page with username and password fields',
    route: '/login',
    auth: 'anonymous',
  },
  {
    id: '00-04-dashboard-overview',
    // the empty 'My Upcoming Shifts' panel is incidental; the rest of the dashboard is populated
    allowEmptyState: true,
    doc: '00-getting-started.md',
    line: 79,
    alt: 'Dashboard showing the sidebar navigation, main content, and header',
    route: '/dashboard',
  },
  {
    id: '00-07-dashboard-panels',
    // same — the shot is about the panel layout, not the shift list
    allowEmptyState: true,
    doc: '00-getting-started.md',
    line: 155,
    alt: 'Dashboard stats cards, notifications, upcoming events, and upcoming shifts',
    route: '/dashboard',
    fullPage: true,
  },
  {
    id: '00-09-account-settings',
    doc: '00-getting-started.md',
    line: 206,
    alt: 'Account Settings page with profile, notification preferences, and password sections',
    route: '/settings/account',
    fullPage: true,
  },

  // ── 01 Membership ───────────────────────────────────────────────────
  {
    id: '01-01-member-directory',
    doc: '01-membership.md',
    line: 37,
    alt: 'Member directory listing members with rank, status, and contact columns',
    route: '/members',
  },
  {
    id: '01-05-add-member-form',
    doc: '01-membership.md',
    line: 128,
    alt: 'Add Member form with personal information and role assignment fields',
    route: '/members/add',
    fullPage: true,
  },
  {
    id: '01-06-import-members',
    doc: '01-membership.md',
    line: 152,
    alt: 'Import Members page with the file upload area and template download link',
    route: '/members/import',
    fullPage: true,
  },
  {
    id: '01-10-prospective-pipeline',
    doc: '01-membership.md',
    line: 265,
    alt: 'Prospective members kanban board with pipeline stages as columns',
    route: '/prospective-members',
  },
  {
    id: '01-22-member-lifecycle',
    doc: '01-membership.md',
    line: 567,
    alt: 'Member Lifecycle Management page with its tab bar and archived member list',
    route: '/members/admin',
  },

  // ── 02 Training ─────────────────────────────────────────────────────
  {
    id: '02-01-my-training',
    doc: '02-training.md',
    line: 53,
    alt: 'My Training page with stat cards and the personal training record list',
    route: '/training/my-training',
    fullPage: true,
  },
  {
    id: '02-04-course-library',
    doc: '02-training.md',
    line: 111,
    alt: 'Course Library showing course cards grouped by category',
    route: '/training/courses',
  },
  {
    id: '02-16-requirements',
    doc: '02-training.md',
    line: 438,
    alt: 'Training requirements management table',
    route: '/training/requirements',
  },
  {
    id: '02-17-officer-dashboard',
    doc: '02-training.md',
    line: 462,
    alt: 'Training Officer Dashboard with summary cards and pending review queue',
    route: '/training/officer',
    fullPage: true,
  },
  {
    id: '02-18-review-submissions',
    doc: '02-training.md',
    line: 480,
    alt: 'Review Submissions page listing pending training submissions',
    route: '/training/submissions',
  },
  {
    id: '02-38-manual-shift-report',
    doc: '02-training.md',
    line: 916,
    alt: 'Manual Shift Report page with date, apparatus, and hours entry',
    route: '/training/log-shift',
    fullPage: true,
  },
  {
    id: '02-42-external-integrations',
    doc: '02-training.md',
    line: 984,
    alt: 'External Training Integrations page showing provider connection status',
    route: '/training/integrations',
  },
  {
    id: '02-45-training-programs',
    doc: '02-training.md',
    line: 1030,
    alt: 'Training Programs page listing programs with an export action',
    route: '/training/programs',
  },
  {
    id: '02-64-skills-testing-admin',
    doc: '02-training.md',
    line: 1460,
    alt: 'Skills Testing section within Training Admin showing the template list',
    route: '/training/skills-testing',
  },

  // ── 03 Scheduling ───────────────────────────────────────────────────
  {
    id: '03-01-scheduling-tabs',
    doc: '03-scheduling.md',
    line: 43,
    alt: 'Scheduling page tab bar with the schedule view below it',
    route: '/scheduling',
  },
  {
    id: '03-12-shift-templates',
    doc: '03-scheduling.md',
    line: 239,
    alt: 'Shift Templates tab listing templates with start and end times',
    route: '/scheduling/templates',
  },
  {
    id: '03-13-shift-patterns',
    doc: '03-scheduling.md',
    line: 260,
    alt: 'Shift pattern creation page with the pattern type selector',
    route: '/scheduling/patterns',
    fullPage: true,
  },
  {
    id: '03-16-platoon-management',
    doc: '03-scheduling.md',
    line: 566,
    alt: 'Platoon Management page showing platoon columns and their members',
    route: '/scheduling/platoons',
  },
  {
    id: '03-24-equipment-check-reports',
    doc: '03-scheduling.md',
    line: 714,
    alt: 'Equipment Check Reports page with the compliance dashboard',
    route: '/scheduling/equipment-check-reports',
  },

  // ── 04 Events & Meetings ────────────────────────────────────────────
  {
    id: '04-01-events-list',
    doc: '04-events-meetings.md',
    line: 45,
    alt: 'Events listing page with upcoming events and type badges',
    route: '/events',
  },
  {
    id: '04-05-create-event',
    doc: '04-events-meetings.md',
    line: 126,
    alt: 'Create Event form with type, title, date, location, and reminder fields',
    route: '/events/new',
    fullPage: true,
  },
  {
    id: '04-08-event-analytics',
    doc: '04-events-meetings.md',
    line: 234,
    alt: 'Event analytics page with summary cards and attendance charts',
    route: '/events/analytics',
    fullPage: true,
  },
  {
    id: '04-09-event-templates',
    doc: '04-events-meetings.md',
    line: 250,
    alt: 'Event Templates page listing templates with type and active state',
    route: '/events/templates',
  },
  {
    id: '04-14-meeting-minutes',
    doc: '04-events-meetings.md',
    line: 423,
    alt: 'Meeting minutes page with the meeting type selector and attendee list',
    route: '/minutes',
  },
  {
    id: '04-15-action-items',
    doc: '04-events-meetings.md',
    line: 454,
    alt: 'Action Items page listing tasks with assignee, due date, and status',
    route: '/action-items',
  },

  // ── 05 Inventory ────────────────────────────────────────────────────
  {
    id: '05-01-inventory-items',
    doc: '05-inventory.md',
    line: 52,
    alt: 'Inventory Items list with search, category filter, and status pills',
    route: '/inventory/items',
  },
  {
    id: '05-03-inventory-categories',
    doc: '05-inventory.md',
    line: 95,
    alt: 'Inventory categories page listing categories with item counts',
    route: '/inventory/admin/categories',
  },

  // ── 06 Apparatus & Facilities ───────────────────────────────────────
  {
    id: '06-01-apparatus-list',
    doc: '06-apparatus-facilities.md',
    line: 43,
    alt: 'Apparatus listing with unit numbers, type badges, and status badges',
    route: '/apparatus',
  },
  {
    id: '06-09-facilities-dashboard',
    doc: '06-apparatus-facilities.md',
    line: 167,
    alt: 'Facilities dashboard with summary cards and facility cards',
    route: '/facilities',
    fullPage: true,
  },
  {
    id: '06-13-facility-maintenance',
    doc: '06-apparatus-facilities.md',
    line: 237,
    alt: 'Facility maintenance view with upcoming items and completed history',
    route: '/facilities/maintenance',
  },
  {
    id: '06-14-facility-inspections',
    doc: '06-apparatus-facilities.md',
    line: 261,
    alt: 'Facility inspections table with type, date, inspector, and result',
    route: '/facilities/inspections',
  },

  // ── 07 Documents, Forms & Communications ────────────────────────────
  {
    id: '07-01-documents',
    doc: '07-documents-forms.md',
    line: 41,
    alt: 'Documents page with the folder tree, file list, and search bar',
    route: '/documents',
  },
  {
    id: '07-04-forms-list',
    doc: '07-documents-forms.md',
    line: 105,
    alt: 'Forms listing page with status, submission counts, and actions',
    route: '/forms',
  },
  {
    id: '07-08-notification-rules',
    doc: '07-documents-forms.md',
    line: 247,
    alt: 'Notification rules and logs page with summary cards and the rules list',
    route: '/notifications',
    fullPage: true,
  },
  {
    id: '07-13-integrations',
    doc: '07-documents-forms.md',
    line: 469,
    alt: 'Integrations page showing available integrations and connection status',
    route: '/integrations',
  },

  // ── 08 Administration & Reports ─────────────────────────────────────
  {
    id: '08-02-organization-settings',
    doc: '08-admin-reports.md',
    line: 67,
    alt: 'Organization Settings page with department name, type, and timezone',
    route: '/settings',
    fullPage: true,
  },
  {
    id: '08-04-role-management',
    doc: '08-admin-reports.md',
    line: 209,
    alt: 'Role Management page listing positions and their permissions',
    route: '/settings/roles',
  },
  {
    id: '08-06-reports',
    doc: '08-admin-reports.md',
    line: 261,
    alt: 'Reports page with category filters and date range presets',
    route: '/reports',
  },
  {
    id: '08-07-analytics-dashboard',
    doc: '08-admin-reports.md',
    line: 281,
    alt: 'Analytics dashboard with metric cards and trend charts',
    route: '/admin/analytics',
    fullPage: true,
  },
  {
    id: '08-08-public-portal',
    doc: '08-admin-reports.md',
    line: 305,
    alt: 'Public Portal configuration page with the enable toggle and domain settings',
    route: '/admin/public-portal',
    fullPage: true,
  },
  {
    id: '08-11-error-monitor',
    // 'No errors found' is the healthy state this page should show
    allowEmptyState: true,
    doc: '08-admin-reports.md',
    line: 367,
    alt: 'Error Monitor page listing recent application errors',
    route: '/admin/errors',
  },
  {
    id: '08-19-audit-log',
    doc: '08-admin-reports.md',
    line: 532,
    alt: 'Audit Log page with summary stat cards and the filter bar',
    route: '/admin/audit-log',
    fullPage: true,
  },
  {
    id: '08-21-medical-screening',
    doc: '08-admin-reports.md',
    line: 859,
    alt: 'Medical Screening page showing the configured requirements',
    route: '/medical-screening',
  },

  // ── 09 Skills Testing ───────────────────────────────────────────────
  {
    id: '09-01-skill-templates',
    doc: '09-skills-testing.md',
    line: 51,
    alt: 'Skill sheet templates list with category and publication status',
    route: '/training/skills-testing',
  },
  {
    id: '09-02-create-template',
    doc: '09-skills-testing.md',
    line: 84,
    alt: 'Create skill sheet template form with metadata fields',
    route: '/training/skills-testing/templates/new',
    fullPage: true,
  },
  {
    id: '09-06-new-test',
    doc: '09-skills-testing.md',
    line: 179,
    alt: 'New skills test form with template and candidate selection',
    route: '/training/skills-testing/test/new',
    fullPage: true,
  },

  // ── 10 Mobile & PWA ─────────────────────────────────────────────────
  {
    id: '10-04-mobile-dashboard',
    // same dashboard, phone width
    allowEmptyState: true,
    doc: '10-mobile-pwa.md',
    line: 291,
    alt: 'Dashboard on a phone in portrait orientation with stacked widget cards',
    route: '/dashboard',
    viewport: 'mobile',
    fullPage: true,
  },
  {
    id: '10-05-mobile-inventory',
    doc: '10-mobile-pwa.md',
    line: 304,
    alt: 'Inventory items list on a phone, rendered as cards instead of table rows',
    route: '/inventory/items',
    viewport: 'mobile',
  },
  {
    id: '10-06-mobile-inventory-admin',
    doc: '10-mobile-pwa.md',
    line: 307,
    alt: 'Inventory admin hub on a phone with grouped card sections stacked vertically',
    route: '/inventory/admin',
    viewport: 'mobile',
    fullPage: true,
  },

  // ── 11 Finance ──────────────────────────────────────────────────────
  {
    id: '11-01-finance-dashboard',
    doc: '11-finance.md',
    line: 93,
    alt: 'Finance dashboard with budget health cards and recent transactions',
    route: '/finance',
    fullPage: true,
  },
  {
    id: '11-02-fiscal-year-settings',
    doc: '11-finance.md',
    line: 125,
    alt: 'Fiscal year settings listing fiscal years with status badges',
    route: '/finance/settings',
    fullPage: true,
  },
  {
    id: '11-06-approval-chains',
    doc: '11-finance.md',
    line: 352,
    alt: 'Approval chain configuration page with the chain list and step builder',
    route: '/finance/settings/approval-chains',
    fullPage: true,
  },
  {
    id: '11-08-create-purchase-request',
    doc: '11-finance.md',
    line: 498,
    alt: 'Create Purchase Request form with budget, vendor, and priority fields',
    route: '/finance/purchase-requests/new',
    fullPage: true,
  },
  {
    id: '11-10-create-expense-report',
    // a brand-new expense report legitimately has no line items yet
    allowEmptyState: true,
    doc: '11-finance.md',
    line: 611,
    alt: 'Create Expense Report form with header fields and the line items section',
    route: '/finance/expenses/new',
    fullPage: true,
  },
  {
    id: '11-12-create-check-request',
    doc: '11-finance.md',
    line: 728,
    alt: 'Create Check Request form with payee, amount, and budget fields',
    route: '/finance/check-requests/new',
    fullPage: true,
  },
  {
    id: '11-15-dues-management',
    doc: '11-finance.md',
    line: 948,
    alt: 'Dues management page with collection summary cards and the member dues table',
    route: '/finance/dues',
    fullPage: true,
  },

  // ── 12 Grants & Fundraising ─────────────────────────────────────────
  {
    id: '12-02-grants-dashboard',
    doc: '12-grants-fundraising.md',
    line: 70,
    alt: 'Grants dashboard with KPI cards for raised funds and active campaigns',
    route: '/grants',
    fullPage: true,
  },
  {
    id: '12-03-opportunities',
    doc: '12-grants-fundraising.md',
    line: 103,
    alt: 'Grant opportunities library showing available grant programs',
    route: '/grants/opportunities',
  },
  {
    id: '12-04-create-application',
    doc: '12-grants-fundraising.md',
    line: 125,
    alt: 'Create grant application form with program, agency, and amount fields',
    route: '/grants/applications/new',
    fullPage: true,
  },
  {
    id: '12-05-applications-pipeline',
    doc: '12-grants-fundraising.md',
    line: 152,
    alt: 'Grant applications in pipeline view with a column per status',
    route: '/grants/applications',
  },
  {
    id: '12-10-donors',
    doc: '12-grants-fundraising.md',
    line: 331,
    alt: 'Donor list with contact details and giving summaries',
    route: '/grants/donors',
  },
  {
    id: '12-14-fundraising-reports',
    doc: '12-grants-fundraising.md',
    line: 462,
    alt: 'Fundraising report with donation trends and top campaigns',
    route: '/grants/reports',
    fullPage: true,
  },

  // ── 13 Medical Screening ────────────────────────────────────────────
  {
    id: '13-01-medical-landing',
    doc: '13-medical-screening.md',
    line: 38,
    alt: 'Medical Screening landing page with its three-tab navigation',
    route: '/medical-screening',
  },

  // ── 14 Elections ────────────────────────────────────────────────────
  {
    id: '14-01-elections-list',
    doc: '14-elections.md',
    line: 56,
    alt: 'Elections list showing elections with status badges',
    route: '/elections',
  },
  {
    id: '14-16-election-settings',
    doc: '14-elections.md',
    line: 700,
    alt: 'Election settings page with the default rule toggles',
    route: '/elections/settings',
    fullPage: true,
  },

  // ── 15 Prospective Members ──────────────────────────────────────────
  {
    id: '15-01-pipeline-board',
    doc: '15-prospective-members.md',
    line: 49,
    alt: 'Prospective members kanban board with a column per pipeline stage',
    route: '/prospective-members',
  },
  {
    id: '15-10-pipeline-settings',
    doc: '15-prospective-members.md',
    line: 371,
    alt: 'Prospective members settings showing the inactivity configuration panel',
    route: '/prospective-members/settings',
    fullPage: true,
  },

  // ── 16 Integrations ─────────────────────────────────────────────────
  {
    id: '16-01-integrations-catalog',
    doc: '16-integrations.md',
    line: 39,
    alt: 'Integrations catalog grid with connection status on each card',
    route: '/integrations',
    fullPage: true,
  },

  // ── 17 Privacy & Data Rights ────────────────────────────────────────
  {
    id: '17-01-privacy-choices',
    doc: '17-privacy-data-rights.md',
    line: 43,
    alt: 'Account security settings showing the privacy choices section',
    route: '/settings/account',
    fullPage: true,
  },

  // ── 18 Department Store ─────────────────────────────────────────────
  {
    id: '18-01-member-storefront',
    doc: '18-storefront.md',
    line: 56,
    alt: 'Member storefront with the order window banner and product grid',
    route: '/store',
    fullPage: true,
  },
  {
    id: '18-02-store-admin',
    doc: '18-storefront.md',
    line: 311,
    alt: 'Store administration settings with the payment method options',
    route: '/store/admin',
    fullPage: true,
  },
];
