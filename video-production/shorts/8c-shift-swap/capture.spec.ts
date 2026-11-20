import { test, type Page, type Route } from '@playwright/test';

import { signIn } from '../../../frontend/src/e2e/helpers';
import {
  SCALE,
  SCREEN,
  ZONE,
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
 * Short 8C — "Submitting a Shift Swap Request".
 *
 * The E2E fixtures schedule nothing, so this serves a week of Engine 1 day
 * shifts with the member on one of them, the members who could cover it, the
 * shifts and seats they could trade for, and swap-request endpoints that
 * remember what was sent, so the board shows the pending offer afterwards.
 * Dates are relative to the render.
 */

const ME = 'e2e-user-id'; // signIn's fixture user
const MY_DAY = zoneDay(3);
const MY_SHIFT_ID = `shift-${dayKey(MY_DAY)}`;

const CREW = [
  { user_id: 'u-smith', user_name: 'Capt. Dana Smith', position: 'officer' },
  { user_id: 'u-lee', user_name: 'Jordan Lee', position: 'firefighter' },
  { user_id: 'u-ortiz', user_name: 'Sam Ortiz', position: 'firefighter' },
  { user_id: 'u-patel', user_name: 'Riya Patel', position: 'driver' },
];

const POSITIONS = [
  { position: 'officer', required: true },
  { position: 'driver', required: true },
  { position: 'firefighter', required: true },
  { position: 'firefighter', required: true },
];

/** One Engine 1 day shift, 7 AM to 7 PM, with the given crew seated. */
function shift(day: Date, roster: { user_id: string; user_name: string; position: string }[]) {
  const key = dayKey(day);
  return {
    id: `shift-${key}`,
    organization_id: 'org-1',
    shift_date: key,
    start_time: zoned(day, 7, 0).toISOString(),
    end_time: zoned(day, 19, 0).toISOString(),
    apparatus_unit_number: 'Engine 1',
    positions: POSITIONS,
    attendee_count: roster.length,
    roster: roster.map((m, i) => ({ assignment_id: `a-${key}-${i}`, status: 'assigned', ...m })),
    call_count: 0,
    is_finalized: false,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
  };
}

const ME_SEAT = { user_id: ME, user_name: 'Alex Tester', position: 'firefighter' };

/** The week starting `start`: the member's shift on MY_DAY, the rest varied. */
function week(start: Date) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start.getTime() + i * 86_400_000);
    if (dayKey(day) === dayKey(MY_DAY)) {
      const [smith, , ortiz, patel] = CREW;
      return shift(day, [smith!, patel!, ME_SEAT, ortiz!]);
    }
    // A full crew most days, one seat open on some, so the board shows both.
    const crew = i % 3 === 1 ? CREW.slice(0, 3) : CREW;
    return shift(day, crew);
  });
}

const TRADE_CANDIDATES = [
  { user_id: 'u-kim', user_name: 'Morgan Kim', position: 'firefighter', shifts_this_month: 2, owes_trade: true },
  { user_id: 'u-reyes', user_name: 'Chris Reyes', position: 'firefighter', shifts_this_month: 3, owes_trade: false },
  { user_id: 'u-brooks', user_name: 'Taylor Brooks', position: 'firefighter', shifts_this_month: 5, owes_trade: false },
];

const exchangeCandidates = () => [
  {
    shift_id: `shift-${dayKey(zoneDay(5))}`,
    shift_date: dayKey(zoneDay(5)),
    start_time: zoned(zoneDay(5), 7, 0).toISOString(),
    user_id: 'u-lee',
    user_name: 'Jordan Lee',
    position: 'firefighter',
  },
  {
    shift_id: `shift-${dayKey(zoneDay(9))}`,
    shift_date: dayKey(zoneDay(9)),
    start_time: zoned(zoneDay(9), 7, 0).toISOString(),
    user_id: 'u-kim',
    user_name: 'Morgan Kim',
    position: 'firefighter',
  },
];

const sent: Record<string, unknown>[] = [];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// Registered after signIn's fixtures, so these answer first for their URLs.
async function mockScheduling(page: Page) {
  await page.route('**/api/v1/scheduling/calendar/week**', (route) => {
    const start = new URL(route.request().url()).searchParams.get('week_start');
    return json(route, week(start ? new Date(`${start}T00:00:00Z`) : zoneDay(0)));
  });
  await page.route('**/api/v1/scheduling/eligibility/positions/bulk**', (route) => json(route, {}));
  await page.route('**/api/v1/scheduling/shifts/*/trade-candidates', (route) => json(route, TRADE_CANDIDATES));
  await page.route('**/api/v1/scheduling/shifts/*/exchange-candidates', (route) => json(route, exchangeCandidates()));
  await page.route('**/api/v1/scheduling/shifts/*/standing-claim**', (route) => json(route, null));
  await page.route(
    (url) => url.pathname === '/api/v1/scheduling/shifts',
    (route) => {
      const upcoming = [1, 2, 4, 5, 6].map((n) => shift(zoneDay(n), CREW.slice(0, 3)));
      return json(route, { shifts: upcoming, total: upcoming.length, skip: 0, limit: 50 });
    }
  );
  await page.route('**/api/v1/scheduling/my-assignments**', (route) =>
    json(route, [
      {
        id: 'a-mine',
        user_id: ME,
        shift_id: MY_SHIFT_ID,
        position: 'firefighter',
        status: 'confirmed',
        assignment_status: 'confirmed',
        user_name: 'Alex Tester',
        shift: week(MY_DAY).find((s) => s.id === MY_SHIFT_ID),
      },
    ])
  );
  await page.route('**/api/v1/scheduling/swap-requests**', (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      const target = TRADE_CANDIDATES.find((c) => c.user_id === body.target_user_id);
      const created = {
        id: `swap-${sent.length + 1}`,
        requesting_user_id: ME,
        requesting_user_name: 'Alex Tester',
        target_user_name: target?.user_name ?? null,
        status: 'pending',
        created_at: new Date().toISOString(),
        ...body,
      };
      sent.push(created);
      return json(route, created, 201);
    }
    return json(route, { items: sent, total: sent.length, skip: 0, limit: 50 });
  });
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: ZONE });

test('capture 8c-shift-swap', async ({ page }) => {
  await prepare(page);
  await signIn(page);
  await mockScheduling(page);
  await page.goto(`/scheduling?view=week&date=${dayKey(MY_DAY)}`);
  await settle(page);

  const myDayCell = () =>
    page.getByRole('grid', { name: /compact/ }).getByRole('gridcell', { name: new RegExp(`^${MY_DAY.getUTCDate()} `) });

  await recordShots(page, '8c-shift-swap', async (shot) => {
    await shot('hook', async () => {
      await centre(page, page.getByRole('grid', { name: /compact/ }));
    });
    await shot('giveup', async () => {
      await tap(page, myDayCell());
      await page.waitForTimeout(600);
      await tap(page, page.getByRole('button', { name: 'Give up this shift' }));
      await page.getByRole('dialog').waitFor();
    });
    await shot('specific', async () => {
      await tap(page, page.getByRole('button', { name: /Offer it to someone specific/ }));
      await page.waitForTimeout(300);
      await tap(page, page.getByRole('button', { name: 'Continue' }));
      await page.getByText('Morgan Kim').waitFor();
    });
    await shot('filtered', async () => {
      await page.waitForTimeout(400);
    });
    await shot('send', async () => {
      await tap(page, page.getByRole('button', { name: /Morgan Kim/ }));
      await page.waitForTimeout(400);
      await tap(page, page.getByRole('button', { name: /Send offer to Morgan Kim/ }));
      await page.getByRole('button', { name: 'Done' }).waitFor();
    });
    await shot('pending', async () => {
      await tap(page, page.getByRole('button', { name: 'Done' }));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.waitForTimeout(400);
      await centre(page, page.getByText(/Offered to Morgan Kim/).first());
    });
    await shot('option2', async () => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(600);
      await tap(
        page,
        page
          .getByRole('link', { name: /My Shifts/ })
          .or(page.getByRole('button', { name: /My Shifts/ }))
          .first()
      );
      await settle(page);
      await tap(page, page.getByRole('button', { name: /^Swap shift on/ }).first());
      await page.getByRole('heading', { name: 'Request Shift Swap' }).waitFor();
    });
    await shot('specificshift', async () => {
      await tap(page, page.getByRole('button', { name: /Specific Shift/ }));
      await page.waitForTimeout(500);
    });
    await shot('openswap', async () => {
      await tap(page, page.getByRole('button', { name: /^Open Swap/ }));
      await page.waitForTimeout(400);
    });
    await shot('exchange', async () => {
      await tap(page, page.getByRole('button', { name: /Exchange With a Member/ }));
      await page.getByLabel('Exchange With').waitFor();
    });
    await shot('submit', async () => {
      await tap(page, page.getByRole('button', { name: 'Submit Request' }));
      await page.getByRole('heading', { name: 'Request Shift Swap' }).waitFor({ state: 'hidden' });
    });
    await shot('outro', async () => {
      await page.waitForTimeout(300);
    });
  });
});
