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
const START = '2026-12-13T00:00:00Z'; // Sat Dec 12, 6:00 PM Central
const END = '2026-12-13T04:00:00Z';

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
  rsvp_deadline: '2026-12-06T05:59:00Z',
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

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: 'America/Chicago' });

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
