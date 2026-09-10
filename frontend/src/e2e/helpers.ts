import type { Page } from '@playwright/test';

/**
 * Shared E2E fixtures and API mocking.
 *
 * These specs run against the Vite dev server with no backend: every
 * `/api/v1/**` call is fulfilled by Playwright. That keeps the suite fast and
 * hermetic, but it means the mocked URLs are a contract with the real service
 * layer. When an endpoint moves, the mock stops matching, the request falls
 * through to a proxy with nothing behind it, and the assertion fails somewhere
 * far from the cause. Route globs therefore live here — one place to correct —
 * and `mockApi` installs a permissive catch-all so a missed endpoint degrades
 * to empty data rather than a 500.
 */

export const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export const TEST_USER = {
  id: 'e2e-user-id',
  username: 'e2euser',
  email: 'e2e@example.com',
  first_name: 'Alex',
  last_name: 'Tester',
  is_active: true,
  // E2E represents an administrator so permission-gated pages exercise their
  // substantive body rather than merely proving that AppLayout rendered.
  permissions: [
    'members.view',
    'members.manage',
    'users.view',
    'scheduling.view',
    'scheduling.manage',
    'scheduling.reports',
    'forms.view',
    'forms.manage',
    'prospective_members.view',
    'prospective_members.manage',
    'communications.view',
    'communications.manage',
    'settings.view',
    'organization.manage',
    'positions.manage_permissions',
    'events.view',
    'events.manage',
    'training.view',
    'training.manage',
    'inventory.view',
    'inventory.manage',
    'documents.view',
    'documents.manage',
    'admin.access',
  ],
  roles: [],
  positions: [],
};

export const TEST_DEPARTMENT = 'Oakville Fire Department';

export const NOTIFICATION_SUBJECTS = ['New event scheduled', 'Training reminder'];

export const SHIFT_OFFICER = 'Captain Smith';

export const TRAINING_PROGRAMS = ['Firefighter I Certification', 'EMT Refresher'];

/** Progress percentage of the first enrolled program, as rendered. */
export const TRAINING_FIRST_PROGRESS = 65;

const notificationLogs = () => ({
  logs: [
    {
      id: 'notif-1',
      subject: NOTIFICATION_SUBJECTS[0],
      message: 'Monthly drill has been scheduled for next week.',
      sent_at: new Date().toISOString(),
      read: false,
      action_url: '/events',
    },
    {
      id: 'notif-2',
      subject: NOTIFICATION_SUBJECTS[1],
      message: 'Your CPR certification expires in 30 days.',
      sent_at: new Date(Date.now() - 86_400_000).toISOString(),
      read: true,
      action_url: '/training',
    },
  ],
  total: 2,
  skip: 0,
  limit: 10,
});

/**
 * One shift that ended yesterday and was never closed out.
 *
 * The close-out queue's whole subject. Without it the route's mobile ratchet
 * entry measured the filter bar, the empty state and the settings mirror —
 * never a queue row or its Close out control, which is the principal UI that
 * route exists to render. A budget met by a page with nothing on it is not
 * coverage.
 *
 * Dated relative to the run for the same reason `myShifts` is: a hard-coded
 * date stops being "yesterday" the day after it is written, and the row would
 * quietly leave the queue.
 */
const closeoutBacklog = () => {
  const yesterday = new Date(Date.now() - 86_400_000);
  const day = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(
    yesterday.getDate()
  ).padStart(2, '0')}`;
  return {
    shifts: [
      {
        id: 'closeout-1',
        organization_id: 'org-1',
        shift_date: day,
        start_time: `${day}T08:00:00Z`,
        end_time: `${day}T16:00:00Z`,
        apparatus_unit_number: 'Engine 1',
        shift_officer_name: SHIFT_OFFICER,
        attendee_count: 3,
        call_count: 0,
        is_finalized: false,
        created_at: `${day}T00:00:00Z`,
      },
    ],
    total: 1,
    skip: 0,
    limit: 200,
  };
};

const myShifts = () => {
  // Keep the shifts in the future relative to the run so the dashboard's
  // "upcoming" filtering keeps them; a hard-coded date silently empties this
  // section once it passes.
  const day = (offset: number) => {
    const d = new Date(Date.now() + offset * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return {
    shifts: [
      {
        id: 'shift-1',
        shift_date: day(2),
        start_time: '08:00',
        end_time: '16:00',
        shift_officer_name: SHIFT_OFFICER,
      },
      {
        id: 'shift-2',
        shift_date: day(6),
        start_time: '16:00',
        end_time: '00:00',
        shift_officer_name: null,
      },
    ],
    total: 2,
  };
};

const enrollments = () => [
  {
    id: 'enrollment-1',
    program: {
      id: 'prog-1',
      name: TRAINING_PROGRAMS[0],
      description: 'Basic firefighter certification program',
    },
    status: 'active',
    progress_percentage: TRAINING_FIRST_PROGRESS,
  },
  {
    id: 'enrollment-2',
    program: {
      id: 'prog-2',
      name: TRAINING_PROGRAMS[1],
      description: 'Annual EMT certification renewal',
    },
    status: 'active',
    progress_percentage: 30,
  },
];

export interface MockOptions {
  /**
   * Serve empty collections everywhere so the dashboard's empty states render.
   */
  empty?: boolean;
  /** Permissions granted to the signed-in fixture user. */
  permissions?: string[];
}

/**
 * Route glob → response body. Ordered least to most specific; `mockApi`
 * registers them in order and Playwright matches the last registration first,
 * so later entries win.
 */
const routes = ({ empty = false, permissions = [] }: MockOptions): [string, () => unknown][] => [
  // Catch-all. Anything not listed below answers with an empty object rather
  // than reaching the dev-server proxy, which has no backend behind it.
  ['**/api/v1/**', () => ({})],

  ['**/api/v1/auth/me', () => ({ ...TEST_USER, permissions })],
  ['**/api/v1/auth/branding', () => ({ name: TEST_DEPARTMENT, logo: null })],
  ['**/api/v1/auth/oauth-config', () => ({ googleEnabled: false, microsoftEnabled: false })],
  ['**/api/v1/auth/session-settings', () => ({ session_timeout_minutes: 60 })],
  ['**/api/v1/auth/logout', () => ({ message: 'Logged out' })],
  ['**/api/v1/onboarding/status', () => ({ is_complete: true })],

  ['**/api/v1/organization/modules', () => ({})],

  // Three pages now reject a payload that is valid JSON but not their declared
  // type, rather than substituting empty lists: an audit log that reads "no
  // events" over a broken endpoint, or a check-in board showing blank totals as
  // though they were live, is worse than an error. The catch-all `{}` above is
  // exactly such a payload, so without these fixtures those routes render their
  // error state — and the mobile passes would be measuring an error page, the
  // very thing this suite exists to catch.
  [
    '**/api/v1/audit-logs**',
    () => ({
      logs: [
        {
          id: 1,
          event_type: 'user.login',
          event_category: 'authentication',
          severity: 'info',
          username: 'e2euser',
          description: 'Signed in from a new device',
          created_at: new Date().toISOString(),
        },
        {
          id: 2,
          event_type: 'settings.update',
          event_category: 'settings',
          severity: 'warning',
          username: 'e2euser',
          description: 'Changed the session timeout',
          created_at: new Date().toISOString(),
        },
      ],
      total: 2,
      skip: 0,
      limit: 25,
    }),
  ],
  // Registered after the list glob above, which also matches this URL: a later
  // `page.route` takes precedence, so the more specific pattern has to come
  // last or it never runs.
  [
    '**/api/v1/audit-logs/stats**',
    () => ({
      total: 2,
      by_severity: { info: 1, warning: 1, critical: 0 },
      by_category: { authentication: 1, settings: 1 },
    }),
  ],

  ['**/api/v1/medical-supplies/lots/expiring**', () => []],
  ['**/api/v1/medical-supplies/categories**', () => []],
  ['**/api/v1/medical-supplies/items**', () => ({ items: [], total: 0, skip: 0, limit: 200 })],

  // Every Administration hub reads this. Unmocked, the catch-all answered `{}`
  // — truthy, so `AdminHubFrame` rendered the attention queue, but with no
  // `attention` array, and the page died on `items.length`. No hub route had
  // ever reached this code: they are all gated on a `*.manage` grant the base
  // fixture does not hold, so the loop was measuring Access Denied and the
  // crash sat behind it. A shape, not a stub, so the frame gets what the API
  // actually promises.
  [
    '**/api/v1/admin-hub/*/summary**',
    () => ({
      moduleKey: 'scheduling',
      generatedAt: new Date().toISOString(),
      timezone: 'UTC',
      metrics: [
        { key: 'shifts_needing_closeout', label: 'To close out', value: '1', context: 'waiting 1 day', fixed: false },
        { key: 'needs_attention', label: 'Needs attention', value: '0', context: 'nothing waiting', fixed: true },
      ],
      attention: [],
    }),
  ],

  ['**/api/v1/notifications/my', () => (empty ? { logs: [] } : notificationLogs())],
  ['**/api/v1/notifications/my?**', () => (empty ? { logs: [] } : notificationLogs())],
  ['**/api/v1/notifications/my/unread-count', () => ({ unread_count: empty ? 0 : 1 })],

  ['**/api/v1/messages/inbox**', () => []],
  ['**/api/v1/messages/inbox/unread-count', () => ({ unread_count: 0 })],
  ['**/api/v1/messages/threads**', () => ({ threads: [], total: 0 })],

  ['**/api/v1/scheduling/my-shifts**', () => (empty ? { shifts: [], total: 0 } : myShifts())],
  ['**/api/v1/scheduling/shifts/open**', () => []],
  // Registered after `/shifts/open` and before the generic entries below, the
  // same ordering the real router needs: a literal segment behind a path
  // parameter is unreachable.
  [
    '**/api/v1/scheduling/shifts/needing-closeout**',
    () => (empty ? { shifts: [], total: 0, skip: 0, limit: 200 } : closeoutBacklog()),
  ],
  // Stated rather than left to the catch-all. `{}` happens to resolve, so the
  // store marks the settings loaded and falls back to its defaults — the queue
  // renders either way, but only by accident, and a fixture nobody can read is
  // one nobody will maintain. `detailed` is the default mode, which is the
  // branch where a row offers "Open the shift to close it".
  [
    '**/api/v1/scheduling/settings**',
    () => ({
      platoons_enabled: false,
      require_end_of_shift_checks: false,
      call_tracking: { mode: 'detailed', call_types: [] },
      signup_closes_minutes_before: 0,
      late_signup_grace_minutes: 60,
      open_ended_shift_cushion_hours: 12,
    }),
  ],
  ['**/api/v1/scheduling/summary**', () => ({ hours_worked_this_month: 24 })],
  ['**/api/v1/scheduling/reports**', () => ({ reports: [], total: 0 })],
  [
    '**/api/v1/scheduling/reports/member-hours**',
    () => ({ members: [], period_start: '2026-08-01', period_end: '2026-08-20', total_members: 0 }),
  ],
  ['**/api/v1/ranks**', () => []],
  // The rank ladder under Members Administration reads these. Without them the
  // catch-all above fulfils both with `{}`, and the section maps over it.
  ['**/api/v1/operational-ranks', () => []],
  ['**/api/v1/operational-ranks?**', () => []],
  ['**/api/v1/operational-ranks/validate**', () => ({ issues: [], total: 0 })],
  // The membership ladder, with rungs rather than an empty list: this section's
  // reorder, rights and remove controls only exist once a tier renders, and an
  // empty ladder would ratchet a screen that has none of them on it. The counts
  // are what make the remove button's disabled state reachable.
  [
    '**/api/v1/users/membership-tiers/config**',
    () => ({
      auto_advance: true,
      tiers: [
        { id: 'probationary', name: 'Probationary', years_required: 0, sort_order: 0, benefits: {} },
        {
          id: 'active',
          name: 'Active Member',
          years_required: 1,
          sort_order: 1,
          benefits: { voting_eligible: true, can_hold_office: true },
        },
      ],
      member_counts: { active: 2 },
    }),
  ],

  ['**/api/v1/admin-hours/summary**', () => ({ totalHours: 8 })],

  ['**/api/v1/training/module-config/my-training**', () => ({ hours_summary: { total_hours: 12 } })],
  // Per-enrollment progress detail. The service fetches
  // `/enrollments/{id}` — not `/{id}/progress` — so this glob must stay a
  // single trailing segment, and must be registered before the `/me` route
  // below so `/enrollments/me` still resolves to the enrollment list.
  [
    '**/api/v1/training/programs/enrollments/*',
    () => ({
      requirement_progress: [
        { id: 'req-1', requirement: { name: 'Written Exam' }, status: 'not_started' },
        { id: 'req-2', requirement: { name: 'Practical Skills' }, status: 'in_progress' },
      ],
      time_remaining_days: 45,
    }),
  ],
  ['**/api/v1/training/programs/enrollments/me**', () => (empty ? [] : enrollments())],

  ['**/api/v1/inventory/summary**', () => ({})],
  ['**/api/v1/inventory/low-stock**', () => []],
  ['**/api/v1/inventory/items**', () => ({ items: [], total: 0 })],
  ['**/api/v1/inventory/categories**', () => []],
  ['**/api/v1/inventory/storage-areas**', () => []],
  ['**/api/v1/inventory/vendors**', () => []],
  ['**/api/v1/inventory/summary/by-location**', () => []],
  ['**/api/v1/locations**', () => []],

  [
    '**/api/v1/facilities/dashboard**',
    () => ({
      totalFacilities: 0,
      operationalFacilities: 0,
      overdueMaintenance: 0,
      upcomingInspections: 0,
      overdueMaintenanceRecords: [],
      upcomingInspectionRecords: [],
      recentMaintenanceCompletions: [],
    }),
  ],
  ['**/api/v1/facilities/page**', () => ({ items: [], total: 0, skip: 0, limit: 24 })],
  ['**/api/v1/facilities/types**', () => []],
  ['**/api/v1/facilities/statuses**', () => []],
  ['**/api/v1/facilities/maintenance-types**', () => []],

  ['**/api/v1/forms**', () => ({ forms: [], total: 0 })],
  ['**/api/v1/prospective-members**', () => ({ applicants: [], total: 0 })],
  ['**/api/v1/members**', () => ({ members: [], users: [], total: 0 })],
  ['**/api/v1/settings**', () => ({})],
  ['**/api/v1/events**', () => []],

  // After the broad `events**` glob above for the same reason: it matches this
  // URL too, and the last matching route registered is the one that answers.
  [
    '**/api/v1/events/*/check-in-monitoring**',
    () => ({
      event_id: '1',
      event_name: 'Monthly Drill',
      event_type: 'training',
      created_by_name: 'Alex Tester',
      start_datetime: new Date().toISOString(),
      end_datetime: new Date(Date.now() + 7_200_000).toISOString(),
      is_check_in_active: true,
      check_in_window_start: new Date(Date.now() - 900_000).toISOString(),
      check_in_window_end: new Date(Date.now() + 7_200_000).toISOString(),
      total_eligible_members: 24,
      total_rsvps: 18,
      total_checked_in: 12,
      check_in_rate: 50,
      recent_check_ins: [],
      early_check_ins: [],
      early_check_in_count: 0,
      early_check_in_threshold_minutes: 30,
      avg_check_in_time_minutes: null,
      last_check_in_at: null,
    }),
  ],
];

/**
 * Fulfil every `/api/v1/**` request with fixture data.
 *
 * Call before navigating to a protected page. `page.goto` must already have
 * put the page on the app origin if the caller also seeds localStorage.
 */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<void> {
  for (const [glob, body] of routes(options)) {
    await page.route(glob, (route) => {
      void route.fulfill(json(body()));
    });
  }
}

/**
 * Mark the browser as holding a session and install the API fixtures.
 *
 * Auth uses httpOnly cookies, so there is no token to plant. The `has_session`
 * flag is the only client-side signal, and it just tells `loadUser` that
 * calling `/auth/me` is worthwhile.
 */
export async function signIn(page: Page, options: MockOptions = {}): Promise<void> {
  // Install routes before the first document load. Login mounts branding and
  // onboarding queries immediately; registering afterward leaked them to the
  // dev-server proxy and made every workflow wait for failed network calls.
  await mockApi(page, options);
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('has_session', '1');
  });
}

/** Ensure no session flag is set, so ProtectedRoute redirects to /login. */
export async function signOut(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.removeItem('has_session');
  });
}

/**
 * Sign in and land on the dashboard, ready for assertions.
 */
export async function gotoDashboard(page: Page, options: MockOptions = {}): Promise<void> {
  await signIn(page, options);
  await page.goto('/dashboard');
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

/**
 * The sidebar/topbar navigation region.
 *
 * The app renders mobile and desktop variants of the same controls
 * simultaneously (Tailwind `sm:hidden` / `hidden sm:inline`), so an unscoped
 * text locator matches twice and trips Playwright's strict mode. Scope to the
 * navigation landmark and take the first match.
 */
/**
 * Locate text that the layout renders twice — once inside a `sm:hidden` mobile
 * element and once inside a `hidden sm:inline` desktop one.
 *
 * Both copies are in the DOM at every viewport; only one is visible. Plain
 * `.first()` therefore picks whichever comes first in source order, which is
 * the mobile copy and is invisible on a desktop viewport. Filtering to the
 * visible match keeps the assertion viewport-agnostic.
 */
export function visibleText(page: Page, text: string) {
  return page.locator(`text=${text} >> visible=true`).first();
}

export function navItem(page: Page, name: RegExp | string) {
  return page.locator('aside, nav').getByRole('button', { name }).first();
}
