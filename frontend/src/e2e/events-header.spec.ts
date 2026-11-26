import { test, expect, type Page } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * Every Events page keeps the Events header: the strip of Events sections and
 * one <h1>. The unit tests prove each page draws it in each state; this proves
 * it in a browser, under the real routes, for the two kinds of viewer — and
 * that the viewer's grants, not the page, decide which sections the strip
 * offers.
 *
 * Owner decisions, 2026-11-26: Events Administration keeps the admin header
 * with the Events strip above it; an outreach request carries a lighter form
 * of that header (strip, admin title, Community Outreach page row) rather than
 * the hub's metrics and area cards; member check-in and the printable report
 * stay without it.
 */

const MEMBER = ['events.view'];
const ADMIN = ['events.view', 'events.manage', 'analytics.view', 'crr.record'];

const MEMBER_SECTIONS = ['Events', 'Attendance Requests'];
const ADMIN_SECTIONS = ['Events', 'Attendance Requests', 'Event Templates', 'Attendance Trends', 'CRR Activities'];

const EVENT = {
  id: '1',
  organization_id: 'org-1',
  title: 'Monthly Drill',
  description: 'Hose and ladder drill',
  event_type: 'training',
  location: 'Station 1',
  start_datetime: '2026-12-10T23:00:00Z',
  end_datetime: '2026-12-11T01:00:00Z',
  created_by_id: 'e2e-user-id',
  requires_rsvp: true,
  max_attendees: 40,
  is_mandatory: false,
  is_cancelled: false,
  allowed_rsvp_statuses: ['going', 'not_going'],
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
};

async function signInAs(page: Page, permissions: string[]) {
  await signIn(page, { permissions });
  // After signIn's fixtures, so it answers ahead of the broad `events**` glob.
  await page.route('**/api/v1/events/1', (route) => route.fulfill(json(EVENT)));
}

async function expectEventsHeader(page: Page, sections: string[]) {
  const strip = page.getByRole('navigation', { name: 'Events sections' });
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('link')).toHaveText(sections);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
}

test.describe('Events header — events manager', () => {
  const ROUTES = [
    '/events',
    '/events/attendance-requests',
    '/events/templates',
    '/events/analytics',
    '/events/crr-activities',
    '/events/1',
    '/events/1/edit',
    '/events/1/monitoring',
    '/events/1/analytics',
    '/events/1/qr-code',
    '/events/admin',
    '/events/admin?tab=requests',
    '/events/admin/requests/req-demo-1',
  ];

  for (const path of ROUTES) {
    test(`${path} draws the Events strip and one heading`, async ({ page }) => {
      await signInAs(page, ADMIN);
      await page.goto(path);
      await expectEventsHeader(page, ADMIN_SECTIONS);
    });
  }

  test('an outreach request sits under the Events Administration header, without the hub around it', async ({
    page,
  }) => {
    await signInAs(page, ADMIN);
    await page.goto('/events/admin/requests/req-demo-1');

    await expect(page.getByRole('heading', { level: 1, name: 'Events Administration' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Oakville Elementary' })).toBeVisible();

    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail.getByRole('link', { name: 'Outreach Requests' })).toHaveAttribute(
      'href',
      '/events/admin?tab=requests'
    );
    await expect(trail.getByText('Oakville Elementary')).toHaveAttribute('aria-current', 'page');

    const outreach = page.getByRole('navigation', { name: 'Community Outreach pages' });
    await expect(outreach.getByRole('link', { name: 'Outreach Requests' })).toHaveAttribute('aria-current', 'page');
    // Lighter than the hub: no area cards, so the request is the next thing.
    const areaCard = page.getByRole('tab', { name: /^Community Outreach/ });
    await expect(areaCard).toHaveCount(0);

    // The trail leads back to the board, where the hub's cards are drawn.
    await trail.getByRole('link', { name: 'Outreach Requests' }).click();
    await expect(page).toHaveURL(/\/events\/admin\?tab=requests$/);
    await expect(areaCard).toHaveAttribute('aria-selected', 'true');
  });

  test('Event Templates keeps its header while the list loads, and when it fails', async ({ page }) => {
    await signInAs(page, ADMIN);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fail = false;
    await page.route('**/api/v1/events/templates?**', async (route) => {
      await held;
      await route.fulfill(fail ? json({ detail: 'down' }, 500) : json([]));
    });

    await page.goto('/events/templates');
    await expectEventsHeader(page, ADMIN_SECTIONS);
    await expect(page.getByRole('heading', { level: 1, name: 'Event Templates' })).toBeVisible();

    fail = true;
    release();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expectEventsHeader(page, ADMIN_SECTIONS);
  });
});

test.describe('Events header — member', () => {
  for (const path of ['/events', '/events/attendance-requests', '/events/1', '/events/1/qr-code']) {
    test(`${path} offers only the sections a member may open`, async ({ page }) => {
      await signInAs(page, MEMBER);
      await page.goto(path);
      await expectEventsHeader(page, MEMBER_SECTIONS);
    });
  }

  test('an administration page is refused, not drawn with a strip the member cannot use', async ({ page }) => {
    await signInAs(page, MEMBER);
    await page.goto('/events/admin');
    await expect(page.getByText('Access Denied')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Events sections' })).toHaveCount(0);
  });
});
