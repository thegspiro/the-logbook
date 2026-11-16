import { test, type Page, type Route } from '@playwright/test';

import { signIn } from '../../../frontend/src/e2e/helpers';
import { SCALE, SCREEN, bottomMost, centre, prepare, recordShots, settle, tap } from '../../lib/recorder';

/**
 * Short 8A — "How to RSVP for an Event in 30 Seconds".
 *
 * The E2E fixtures serve no events, so one upcoming event is layered on top,
 * with an RSVP endpoint that remembers the member's answer so the event page
 * re-renders with it after Submit.
 */

const EVENT_ID = 'evt-awards';
const ZONE = 'America/Chicago'; // the browser's zone below, so times read as written

/** The UTC instant of a wall-clock time in ZONE on the given calendar day. */
function zoned(day: Date, hour: number, minute: number): Date {
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
  // Read the zone's offset at that moment, then shift by it. Correct across
  // daylight saving, since the offset is taken for the day itself.
  const asZone = new Date(new Date(wall).toLocaleString('en-US', { timeZone: ZONE }));
  const asUtc = new Date(new Date(wall).toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(wall + (asUtc.getTime() - asZone.getTime()));
}

// Dated from the render, not fixed: the event page offers RSVP only before the
// deadline, and the dashboard's opening shot lists only the next 30 days. So
// the banquet is the first Saturday at least two weeks out, 6-10 PM, with RSVP
// closing the Saturday before.
const saturday = new Date(Date.now() + 14 * 86_400_000);
saturday.setUTCDate(saturday.getUTCDate() + ((6 - saturday.getUTCDay() + 7) % 7));
const START = zoned(saturday, 18, 0).toISOString();
const END = zoned(saturday, 22, 0).toISOString();
const RSVP_DEADLINE = zoned(new Date(saturday.getTime() - 7 * 86_400_000), 23, 59).toISOString();

type RsvpStatus = 'going' | 'not_going' | 'maybe';
let myRsvp: RsvpStatus | undefined;

const listItem = () => ({
  id: EVENT_ID,
  title: 'Annual Awards Banquet',
  description: 'Dinner, service awards and the year in review. Families welcome.',
  event_type: 'ceremony',
  start_datetime: START,
  end_datetime: END,
  location_name: 'Elks Lodge',
  requires_rsvp: true,
  is_mandatory: false,
  is_cancelled: false,
  is_draft: false,
  rsvp_count: 31 + (myRsvp ? 1 : 0),
  going_count: 23 + (myRsvp === 'going' ? 1 : 0),
  max_attendees: 120,
  occupied_seats: 23 + (myRsvp === 'going' ? 1 : 0),
  waitlist_count: 0,
  allowed_rsvp_statuses: ['going', 'not_going', 'maybe'],
  rsvp_deadline: RSVP_DEADLINE,
  ...(myRsvp ? { user_rsvp_status: myRsvp } : {}),
});

const detail = () => ({
  ...listItem(),
  organization_id: 'org-1',
  location: 'Elks Lodge, 412 Main St',
  allow_guests: false,
  send_reminders: true,
  reminder_target: 'going',
  reminder_schedule: [24],
  not_going_count: 5,
  maybe_count: 3,
  organizer_name: 'Lt. Dana Reyes',
  created_by_name: 'Lt. Dana Reyes',
  created_at: '2026-11-02T15:00:00Z',
  updated_at: '2026-11-02T15:00:00Z',
});

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// Registered after signIn's fixtures, so it answers first for these URLs;
// everything else under /events falls back to them.
async function mockEvent(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/events' || url.pathname.startsWith(`/api/v1/events/${EVENT_ID}`),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (path === '/api/v1/events') return json(route, [listItem()]);
      if (path === `/api/v1/events/${EVENT_ID}`) return json(route, detail());
      if (path === `/api/v1/events/${EVENT_ID}/rsvp` && req.method() === 'POST') {
        myRsvp = (req.postDataJSON() as { status: RsvpStatus }).status;
        return json(route, {
          id: 'rsvp-1',
          event_id: EVENT_ID,
          user_id: 'user-1',
          status: myRsvp,
          guest_count: 0,
          responded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          checked_in: false,
        });
      }
      return route.fallback();
    }
  );
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: ZONE });

test('capture 8a-rsvp', async ({ page }) => {
  await prepare(page);
  await signIn(page);
  await mockEvent(page);
  await page.goto('/dashboard');
  await settle(page);

  const banquet = () => page.getByText('Annual Awards Banquet').locator('visible=true').first();

  await recordShots(page, '8a-rsvp', async (shot) => {
    await shot('hook', async () => {
      await page.waitForTimeout(900);
      await centre(page, banquet());
    });
    await shot('events', async () => {
      await tap(page, await bottomMost(page.getByRole('button', { name: 'Events', exact: true })));
      await settle(page);
    });
    await shot('event', async () => {
      await tap(page, banquet());
      await settle(page);
    });
    await shot('rsvp', async () => {
      await tap(page, page.getByRole('button', { name: 'RSVP Now' }));
      await page.getByRole('dialog').waitFor();
      await page.waitForTimeout(1400); // while the three choices are read out
      await tap(page, page.getByRole('radio', { name: 'Going', exact: true }));
      await page.waitForTimeout(500);
      await tap(page, page.getByRole('button', { name: 'Submit RSVP' }));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    });
    await shot('done', async () => {
      const heading = page.getByRole('heading', { name: 'Your RSVP' });
      await heading.waitFor();
      await centre(page, heading);
    });
  });
});
