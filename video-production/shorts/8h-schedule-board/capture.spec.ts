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
 * Short 8H — "Viewing the Scheduling Dashboard".
 *
 * Serves a month of Engine 1 day and night shifts in every staffing state the
 * board colours, with the member on a few of them. The browser clock is fixed
 * at 9 AM on the 8th of the render's month, a Sunday or not, so the week the
 * phone board opens on is always mostly ahead, whatever day the short is
 * rendered. A phone shows one week; the Month toggle is for wider screens.
 */

const ME = 'e2e-user-id'; // signIn's fixture user
const DAY = 86_400_000;

const today = zoneDay(0);
const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
const dayOf = (n: number) => new Date(monthStart.getTime() + (n - 1) * DAY);
const NOW = zoned(dayOf(8), 9, 0);
const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();

/** The day shown open in the crew panel: two seats short on the day shift. */
const OPEN_DAY = 12;
const MY_DAYS = [3, 10, 15, 19, 24, 28];

const CREW = [
  { user_id: 'u-smith', user_name: 'Capt. Dana Smith', position: 'officer' },
  { user_id: 'u-patel', user_name: 'Riya Patel', position: 'driver' },
  { user_id: 'u-lee', user_name: 'Jordan Lee', position: 'firefighter' },
  { user_id: 'u-ortiz', user_name: 'Sam Ortiz', position: 'firefighter' },
];
const NIGHT_CREW = [
  { user_id: 'u-brooks', user_name: 'Lt. Taylor Brooks', position: 'officer' },
  { user_id: 'u-kim', user_name: 'Morgan Kim', position: 'driver' },
  { user_id: 'u-reyes', user_name: 'Chris Reyes', position: 'firefighter' },
  { user_id: 'u-okafor', user_name: 'Ada Okafor', position: 'firefighter' },
];
const ME_SEAT = { user_id: ME, user_name: 'Alex Tester', position: 'firefighter' };

const POSITIONS = [
  { position: 'officer', required: true },
  { position: 'driver', required: true },
  { position: 'firefighter', required: true },
  { position: 'firefighter', required: true },
];

type Seat = { user_id: string; user_name: string; position: string };

function shift(day: Date, night: boolean, roster: Seat[]) {
  const key = dayKey(day);
  const next = new Date(day.getTime() + DAY);
  return {
    id: `shift-${key}-${night ? 'n' : 'd'}`,
    organization_id: 'org-1',
    shift_date: key,
    start_time: zoned(day, night ? 19 : 7, 0).toISOString(),
    end_time: (night ? zoned(next, 7, 0) : zoned(day, 19, 0)).toISOString(),
    apparatus_unit_number: 'Engine 1',
    positions: POSITIONS,
    attendee_count: roster.length,
    roster: roster.map((m, i) => ({ assignment_id: `a-${key}-${night ? 'n' : 'd'}-${i}`, status: 'assigned', ...m })),
    call_count: 0,
    is_finalized: false,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
  };
}

/**
 * Most shifts full; a scatter one seat short (amber) and a few two short
 * (red), so every colour in the legend appears in the month.
 */
function month() {
  const shifts = [];
  for (let n = 1; n <= daysInMonth; n += 1) {
    const day = dayOf(n);
    const [smith, patel, lee, ortiz] = CREW as [Seat, Seat, Seat, Seat];
    let dayCrew: Seat[] = CREW;
    if (MY_DAYS.includes(n)) dayCrew = [smith, patel, ME_SEAT, ortiz];
    else if (n === OPEN_DAY || n % 9 === 4) dayCrew = [smith, patel];
    else if (n % 5 === 1) dayCrew = [smith, patel, lee];
    const nightCrew = n % 7 === 2 ? NIGHT_CREW.slice(0, 2) : n % 4 === 3 ? NIGHT_CREW.slice(0, 3) : NIGHT_CREW;
    shifts.push(shift(day, false, dayCrew), shift(day, true, nightCrew));
  }
  return shifts;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Registered after signIn's fixtures, so these answer first for their URLs.
async function mockScheduling(page: Page) {
  await page.route('**/api/v1/scheduling/calendar/month**', (route) => json(route, month()));
  await page.route('**/api/v1/scheduling/calendar/week**', (route) => json(route, month()));
  // The dashboard's Next 30 Days reads the same month, so it agrees with the board.
  const upcoming = () => month().filter((s) => s.start_time >= NOW.toISOString());
  await page.route('**/api/v1/scheduling/my-shifts**', (route) => {
    const mine = upcoming().filter((s) => s.roster.some((m) => m.user_id === ME));
    return json(route, { shifts: mine, total: mine.length });
  });
  await page.route('**/api/v1/scheduling/shifts/open**', (route) =>
    json(
      route,
      upcoming().filter((s) => s.roster.length < POSITIONS.length)
    )
  );
  // The member is cleared to ride as a firefighter, so open seats offer a signup.
  await page.route('**/api/v1/scheduling/eligibility/positions/bulk**', (route) => {
    const ids = (new URL(route.request().url()).searchParams.get('shift_ids') ?? '').split(',');
    return json(route, Object.fromEntries(ids.filter(Boolean).map((id) => [id, ['firefighter']])));
  });
  await page.route('**/api/v1/scheduling/shifts/*/standing-claim**', (route) => json(route, null));
  await page.route('**/api/v1/scheduling/swap-requests**', (route) =>
    json(route, { items: [], total: 0, skip: 0, limit: 50 })
  );
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: ZONE });

test('capture 8h-schedule-board', async ({ page }) => {
  if (process.env.VIDEO_DEBUG) {
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/')) console.log('REQ', r.method(), r.url().replace(/^.*\/api\/v1/, ''));
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
    });
  }
  await page.clock.setFixedTime(NOW);
  await prepare(page);
  await signIn(page);
  await mockScheduling(page);
  await page.goto('/dashboard');
  await settle(page);

  const grid = page.getByRole('grid', { name: /compact/ });
  const main = page.getByRole('main');
  const filter = (name: string) =>
    main.getByRole('group', { name: 'Calendar filter' }).getByRole('button', { name, exact: true });

  await recordShots(page, '8h-schedule-board', async (shot) => {
    await shot('hook', async () => {
      await page.waitForTimeout(600);
    });
    await shot('open', async () => {
      await tap(page, await bottomMost(page.getByRole('button', { name: 'Schedule', exact: true })));
      await settle(page);
      await centre(page, grid);
    });
    await shot('colours', async () => {
      await centre(page, main.getByText('2+ seats open').first());
    });
    await shot('day', async () => {
      await centre(page, grid);
      await tap(page, grid.getByRole('gridcell', { name: new RegExp(`^${OPEN_DAY} `) }));
      await page.waitForTimeout(700);
      await centre(page, main.getByText('Riya Patel').first());
    });
    await shot('filters', async () => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(700);
      await tap(page, filter('Needs staffing'));
      await page.waitForTimeout(1600);
      await tap(page, filter('My shifts'));
      await page.waitForTimeout(500);
    });
    await shot('mine', async () => {
      await centre(page, grid);
      await tap(page, grid.getByRole('gridcell', { name: new RegExp(`^${MY_DAYS[1] ?? 10} `) }));
      await page.waitForTimeout(700);
    });
    await shot('outro', async () => {
      await page.waitForTimeout(300);
    });
  });
});
