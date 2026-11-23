import { test, type Page, type Route } from '@playwright/test';

import { signIn } from '../../../frontend/src/e2e/helpers';
import {
  SCALE,
  SCREEN,
  ZONE,
  bottomMost,
  centre,
  dayKey,
  prepare,
  recordShots,
  settle,
  tap,
  zoneDay,
  zoned,
} from '../../lib/recorder';

/**
 * Short 8I — "Put Your Shifts in Your Phone Calendar".
 *
 * Serves the member's upcoming Engine 1 shifts and a calendar feed. The feed
 * link is a private credential, so the one on screen is a decoy: its token says
 * so, and the page's own origin (localhost during a capture) is shown as a
 * .invalid host, a name reserved never to resolve. The browser clock is fixed
 * at 9 AM on the 8th of the render's month, as in 8H.
 */

const ME = 'e2e-user-id'; // signIn's fixture user
const DAY = 86_400_000;
const SHOWN_ORIGIN = 'https://logbook.your-department.invalid';
const FEED_PATH = '/api/public/v1/calendar/demo-not-a-real-link.ics';
const ROTATED_PATH = '/api/public/v1/calendar/demo-reset-link.ics';

const today = zoneDay(0);
const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
const dayOf = (n: number) => new Date(monthStart.getTime() + (n - 1) * DAY);
const NOW = zoned(dayOf(8), 9, 0);
const MY_DAYS = [10, 15, 19, 24, 28];

const POSITIONS = [
  { position: 'officer', required: true },
  { position: 'driver', required: true },
  { position: 'firefighter', required: true },
  { position: 'firefighter', required: true },
];
const CREW = [
  { user_id: 'u-smith', user_name: 'Capt. Dana Smith', position: 'officer' },
  { user_id: 'u-patel', user_name: 'Riya Patel', position: 'driver' },
  { user_id: ME, user_name: 'Alex Tester', position: 'firefighter' },
  { user_id: 'u-ortiz', user_name: 'Sam Ortiz', position: 'firefighter' },
];

function shift(n: number) {
  const day = dayOf(n);
  const key = dayKey(day);
  return {
    id: `shift-${key}`,
    organization_id: 'org-1',
    shift_date: key,
    start_time: zoned(day, 7, 0).toISOString(),
    end_time: zoned(day, 19, 0).toISOString(),
    apparatus_unit_number: 'Engine 1',
    positions: POSITIONS,
    attendee_count: CREW.length,
    roster: CREW.map((m, i) => ({ assignment_id: `a-${key}-${i}`, status: 'assigned', ...m })),
    call_count: 0,
    is_finalized: false,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
  };
}

const assignments = () =>
  MY_DAYS.map((n) => ({
    id: `a-mine-${n}`,
    user_id: ME,
    shift_id: shift(n).id,
    position: 'firefighter',
    status: 'confirmed',
    assignment_status: 'confirmed',
    user_name: 'Alex Tester',
    shift: shift(n),
  }));

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Registered after signIn's fixtures, so these answer first for their URLs.
async function mockScheduling(page: Page) {
  const mine = MY_DAYS.map(shift);
  await page.route('**/api/v1/scheduling/my-assignments**', (route) => json(route, assignments()));
  await page.route('**/api/v1/scheduling/my-shifts**', (route) => json(route, { shifts: mine, total: mine.length }));
  await page.route('**/api/v1/scheduling/calendar/**', (route) => json(route, mine));
  await page.route('**/api/v1/scheduling/calendar-feed', (route) =>
    json(route, { token: 'demo-not-a-real-link', feed_path: FEED_PATH })
  );
  await page.route('**/api/v1/scheduling/calendar-feed/rotate', (route) =>
    json(route, { token: 'demo-reset-link', feed_path: ROTATED_PATH })
  );
  await page.route('**/api/v1/scheduling/swap-requests**', (route) =>
    json(route, { items: [], total: 0, skip: 0, limit: 50 })
  );
}

/**
 * Shows the feed link under SHOWN_ORIGIN. The field is a controlled React
 * input that re-renders (the Copy button swaps its icon), so the value is
 * rewritten every time it is set rather than once.
 */
async function decoyFeedOrigin(page: Page) {
  await page.addInitScript((shown) => {
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!native?.set || !native.get) return;
    const { get, set } = native;
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      configurable: true,
      get() {
        return get.call(this);
      },
      set(v: unknown) {
        const value =
          typeof v === 'string' && this.getAttribute('aria-label') === 'Calendar subscription URL'
            ? v.replace(window.location.origin, shown)
            : v;
        set.call(this, value);
      },
    });
  }, SHOWN_ORIGIN);
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: ZONE });

test('capture 8i-calendar-feed', async ({ page }) => {
  if (process.env.VIDEO_DEBUG) {
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/')) console.log('REQ', r.method(), r.url().replace(/^.*\/api\/v1/, ''));
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
    });
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.clock.setFixedTime(NOW);
  await prepare(page);
  await decoyFeedOrigin(page);
  await signIn(page);
  await mockScheduling(page);
  await page.goto('/dashboard');
  await settle(page);

  const main = page.getByRole('main');
  const link = main.getByLabel('Calendar subscription URL');

  await recordShots(page, '8i-calendar-feed', async (shot) => {
    await shot('hook', async () => {
      await page.waitForTimeout(600);
    });
    await shot('open', async () => {
      await tap(page, await bottomMost(page.getByRole('button', { name: 'Schedule', exact: true })));
      await settle(page);
      await tap(page, page.getByRole('link', { name: 'My Shifts', exact: true }).locator('visible=true').first());
      await settle(page);
    });
    await shot('subscribe', async () => {
      await tap(page, main.getByRole('button', { name: /Subscribe to my shifts/ }));
      await link.waitFor();
      await page.waitForTimeout(400);
    });
    await shot('copy', async () => {
      await tap(page, main.getByRole('button', { name: 'Copy calendar link' }));
      await page.waitForTimeout(600);
    });
    await shot('private', async () => {
      await centre(page, main.getByRole('button', { name: /Reset link/ }));
    });
    await shot('sync', async () => {
      await centre(page, main.getByText('Engine 1').first());
    });
    await shot('outro', async () => {
      await page.waitForTimeout(300);
    });
  });

  const shown = await link.inputValue();
  if (!shown.startsWith(SHOWN_ORIGIN)) throw new Error(`feed link shown as ${shown}`);
});
