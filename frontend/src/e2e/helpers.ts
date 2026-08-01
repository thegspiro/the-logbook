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
  permissions: [],
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
}

/**
 * Route glob → response body. Ordered least to most specific; `mockApi`
 * registers them in order and Playwright matches the last registration first,
 * so later entries win.
 */
const routes = ({ empty = false }: MockOptions): [string, () => unknown][] => [
  // Catch-all. Anything not listed below answers with an empty object rather
  // than reaching the dev-server proxy, which has no backend behind it.
  ['**/api/v1/**', () => ({})],

  ['**/api/v1/auth/me', () => TEST_USER],
  ['**/api/v1/auth/branding', () => ({ name: TEST_DEPARTMENT, logo: null })],
  [
    '**/api/v1/auth/oauth-config',
    () => ({ googleEnabled: false, microsoftEnabled: false }),
  ],
  ['**/api/v1/auth/session-settings', () => ({ session_timeout_minutes: 60 })],
  ['**/api/v1/auth/logout', () => ({ message: 'Logged out' })],

  ['**/api/v1/organization/modules', () => ({})],

  ['**/api/v1/notifications/my', () => (empty ? { logs: [] } : notificationLogs())],
  ['**/api/v1/notifications/my?**', () => (empty ? { logs: [] } : notificationLogs())],
  ['**/api/v1/notifications/my/unread-count', () => ({ unread_count: empty ? 0 : 1 })],

  ['**/api/v1/messages/inbox**', () => []],
  ['**/api/v1/messages/inbox/unread-count', () => ({ unread_count: 0 })],

  ['**/api/v1/scheduling/my-shifts**', () => (empty ? { shifts: [], total: 0 } : myShifts())],
  ['**/api/v1/scheduling/shifts/open**', () => []],
  ['**/api/v1/scheduling/summary**', () => ({ total_hours_this_month: 24 })],

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

  ['**/api/v1/events**', () => []],
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
  await page.goto('/login');
  await page.evaluate(() => {
    localStorage.setItem('has_session', '1');
  });
  await mockApi(page, options);
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
  return page
    .locator('aside, nav')
    .getByRole('button', { name })
    .first();
}
