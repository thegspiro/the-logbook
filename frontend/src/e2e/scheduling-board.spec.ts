import { test, expect, type Page } from '@playwright/test';

import { json, signIn } from './helpers';

/**
 * The scheduling board, in a real browser.
 *
 * The unit tests run in jsdom, where no CSS applies and the desktop grid and
 * the phone grid are therefore both in the document at once. That makes them
 * blind to the one thing this file checks: which layout a given viewport
 * actually gets, and that claiming a seat works end to end through it.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

/** A date comfortably in the future, so the cell is never dimmed as past. */
const target = () => {
  const date = new Date();
  date.setDate(date.getDate() + 9);
  return date;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);

const shiftFixture = (attendees: number) => {
  const day = target();
  return [
    {
      id: 'board-shift-1',
      organization_id: 'org',
      shift_date: iso(day),
      start_time: `${iso(day)}T14:00:00Z`,
      end_time: `${iso(day)}T22:00:00Z`,
      apparatus_unit_number: 'E101',
      positions: [
        { position: 'officer', required: true },
        { position: 'firefighter', required: true },
        { position: 'firefighter', required: true },
      ],
      attendee_count: attendees,
      roster: Array.from({ length: attendees }, (_, index) => ({
        assignment_id: `a${index}`,
        user_id: `other-${index}`,
        user_name: `Crew ${index}`,
        position: 'firefighter',
        status: 'assigned',
      })),
      call_count: 0,
      is_finalized: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];
};

/**
 * Board-specific fixtures, layered over `signIn`'s catch-all.
 *
 * Registered after it so they win: Playwright tries the most recently added
 * handler first.
 */
const mockBoard = async (page: Page, { onSignup }: { onSignup?: () => void } = {}) => {
  let attendees = 1;
  await page.route('**/api/v1/scheduling/calendar/month**', (route) => route.fulfill(json(shiftFixture(attendees))));
  await page.route('**/api/v1/scheduling/eligibility/positions/bulk**', (route) =>
    route.fulfill(json({ 'board-shift-1': ['firefighter'] }))
  );
  await page.route('**/api/v1/scheduling/swap-requests**', (route) =>
    route.fulfill(json({ items: [], total: 0, skip: 0, limit: 50 }))
  );
  await page.route('**/api/v1/scheduling/shifts/*/signup', (route) => {
    attendees += 1;
    onSignup?.();
    return route.fulfill(json({ id: 'new-assignment' }, 201));
  });
};

const openBoard = async (page: Page) => {
  await page.goto(`/scheduling?view=month&date=${iso(target())}`);
  await expect(page.getByRole('heading', { level: 2 }).filter({ hasText: /\w+ \d{4}/ })).toBeVisible();
};

test.describe('scheduling board', () => {
  test('desktop gets the month grid beside the day panel', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page);
    await mockBoard(page);
    await openBoard(page);

    await expect(page.getByRole('grid', { name: 'Month calendar', exact: true })).toBeVisible();
    // The phone grid is in the DOM but must not be shown here.
    await expect(page.getByRole('grid', { name: 'Month calendar, compact', exact: true })).toBeHidden();
  });

  test('a phone gets the compact grid instead', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page);
    await mockBoard(page);
    await openBoard(page);

    await expect(page.getByRole('grid', { name: 'Month calendar, compact', exact: true })).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Month calendar', exact: true })).toBeHidden();
  });

  test('claiming a seat takes one tap and updates the crew', async ({ page }) => {
    let signups = 0;
    await page.setViewportSize(DESKTOP);
    await signIn(page);
    await mockBoard(page, { onSignup: () => (signups += 1) });
    await openBoard(page);

    const grid = page.getByRole('grid', { name: 'Month calendar', exact: true });
    await grid
      .getByRole('gridcell')
      .filter({ hasText: String(target().getDate()) })
      .first()
      .click();

    const claim = page.getByRole('button', { name: /take a seat on this shift/i }).first();
    await expect(claim).toBeVisible();
    await claim.click();

    await expect.poll(() => signups).toBe(1);
    // The panel re-reads from the server, so the badge moves without a reload.
    await expect(page.getByText('1 of 3 seat open')).toBeVisible();
  });

  test('the month legend explains every colour on screen', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page);
    await mockBoard(page);
    await openBoard(page);

    // Scoped to the desktop legend: the phone one is in the DOM too, comes
    // first, and is hidden at this width.
    const legend = page.getByTestId('board-legend');
    for (const label of ['2+ seats open', '1 seat open', 'Fully staffed', "You're on it"]) {
      await expect(legend.getByText(label, { exact: true })).toBeVisible();
    }
  });
});
