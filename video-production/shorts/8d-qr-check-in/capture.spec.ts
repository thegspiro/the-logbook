import { test, type Page, type Route } from '@playwright/test';

import { signIn } from '../../../frontend/src/e2e/helpers';
import {
  SCALE,
  SCREEN,
  ZONE,
  centre,
  choose,
  dayKey,
  decoyQr,
  prepare,
  recordShots,
  settle,
  tap,
  zoneDay,
  zoned,
} from '../../lib/recorder';

/**
 * Short 8D — "Creating an Event with QR Check-In".
 *
 * An officer creates a meeting through the real form; the create endpoint
 * returns what was sent, so the event page, the QR page and the member's
 * check-in page all show the event as it was entered. The default Flexible
 * window opens an hour before the start, so it is genuinely open when the
 * member checks in (see NOW).
 */

const EVENT_ID = 'evt-new';
const MINUTES_BEFORE = 60;

// The browser's clock is fixed at 6:20 PM on the render day, so the story
// holds whenever it is rendered: a 7 PM meeting whose Flexible window opened
// at 6, and a member checking in at 6:20. Basing it on the real time put the
// meeting on the next day for a late render, before its window opened.
const DAY = zoneDay(0);
const HOUR = 19;
const NOW = zoned(DAY, 18, 20);

let created: Record<string, unknown> | null = null;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const upcoming = () => {
  const day = zoneDay(6);
  return [
    {
      id: 'evt-cpr',
      title: 'CPR Recertification',
      event_type: 'training',
      start_datetime: zoned(day, 9, 0).toISOString(),
      end_datetime: zoned(day, 12, 0).toISOString(),
      location_name: 'Station 1 Training Room',
      requires_rsvp: false,
      is_mandatory: true,
      is_cancelled: false,
    },
  ];
};

const eventRecord = (): Record<string, unknown> => {
  const start = String(created?.start_datetime ?? zoned(DAY, HOUR, 0).toISOString());
  const end = String(created?.end_datetime ?? zoned(DAY, HOUR + 2, 0).toISOString());
  const opens = new Date(new Date(start).getTime() - MINUTES_BEFORE * 60_000).toISOString();
  return {
    requires_rsvp: false,
    is_mandatory: false,
    allow_guests: false,
    send_reminders: true,
    reminder_target: 'going',
    reminder_schedule: [24],
    ...created,
    id: EVENT_ID,
    organization_id: 'org-1',
    start_datetime: start,
    end_datetime: end,
    is_cancelled: false,
    is_draft: false,
    check_in_opens_at: opens,
    check_in_closes_at: end,
    created_by_name: 'Alex Tester',
    organizer_name: 'Alex Tester',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
};

const qrData = () => {
  const e = eventRecord();
  return {
    event_id: EVENT_ID,
    event_name: String(e.title ?? 'Monthly Business Meeting'),
    event_type: String(e.event_type ?? 'business_meeting'),
    start_datetime: e.start_datetime,
    end_datetime: e.end_datetime,
    check_in_start: e.check_in_opens_at,
    check_in_end: e.check_in_closes_at,
    is_valid: true,
    can_check_in: true,
    location: String(e.location ?? 'Station 1 Conference Room'),
    timezone: ZONE,
    user_checked_in_at: null,
  };
};

// Registered after signIn's fixtures, so these answer first for their URLs.
async function mockEvents(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/events' || url.pathname.startsWith(`/api/v1/events/${EVENT_ID}`),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (path === '/api/v1/events' && req.method() === 'POST') {
        created = req.postDataJSON() as Record<string, unknown>;
        return json(route, eventRecord(), 201);
      }
      if (path === '/api/v1/events') return json(route, created ? [eventRecord(), ...upcoming()] : upcoming());
      if (path === `/api/v1/events/${EVENT_ID}`) return json(route, eventRecord());
      if (path === `/api/v1/events/${EVENT_ID}/qr-check-in-data`) return json(route, qrData());
      if (path === `/api/v1/events/${EVENT_ID}/self-check-in` && req.method() === 'POST') {
        const now = NOW.toISOString();
        return json(route, {
          id: 'rsvp-1',
          event_id: EVENT_ID,
          user_id: 'e2e-user-id',
          status: 'going',
          guest_count: 0,
          responded_at: now,
          updated_at: now,
          checked_in: true,
          checked_in_at: now,
        });
      }
      return route.fallback();
    }
  );
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: ZONE });

test('capture 8d-qr-check-in', async ({ page }) => {
  await prepare(page);
  await page.clock.setFixedTime(NOW);
  await signIn(page, { permissions: ['events.view', 'events.manage'] });
  await mockEvents(page);
  await page.goto('/events');
  await settle(page);

  await recordShots(page, '8d-qr-check-in', async (shot) => {
    await shot('hook', async () => {
      await page.waitForTimeout(600);
    });
    await shot('basics', async () => {
      await tap(page, page.getByRole('link', { name: 'Create Event' }).first());
      await settle(page);
      const title = page.getByLabel('Title');
      await tap(page, title);
      await title.pressSequentially('Monthly Business Meeting', { delay: 35 });
      const date = page.getByLabel('Start Date & Time');
      await tap(page, date);
      await date.fill(dayKey(DAY));
      await choose(page, page.getByLabel('Start time hour'), String(HOUR % 12));
      await choose(page, page.getByLabel('Start time minute'), '00');
      await choose(page, page.getByLabel('Start time AM/PM'), HOUR >= 12 ? 'PM' : 'AM');
      await tap(page, page.getByRole('button', { name: '2 hours' }));
      const location = page.getByLabel('Location', { exact: true });
      await tap(page, location);
      await location.pressSequentially('Station 1 Conference Room', { delay: 30 });
    });
    await shot('window', async () => {
      const windowSelect = page.getByLabel('Check-In Window');
      await centre(page, page.getByRole('heading', { name: 'Check-In Settings' }));
      await page.waitForTimeout(1200);
      await choose(page, windowSelect, 'strict');
      await page.waitForTimeout(900);
      await choose(page, windowSelect, 'window');
      await page.waitForTimeout(900);
      await choose(page, windowSelect, 'flexible');
    });
    await shot('save', async () => {
      await tap(page, page.getByRole('button', { name: 'Create Event' }).last());
      await page.waitForURL(`**/events/${EVENT_ID}`);
      await settle(page);
    });
    await shot('qr', async () => {
      await tap(page, page.getByRole('button', { name: 'View QR Code' }));
      await page.waitForURL(`**/events/${EVENT_ID}/qr-code`);
      await settle(page);
      // The real code encodes this capture's check-in link; a viewer must not
      // be able to scan a link off the video, so it is swapped for a decoy
      // before the shot shows it.
      const qr = page.locator('.qr-container').first();
      await decoyQr(qr);
      await centre(page, qr);
    });
    await shot('member', async () => {
      // The scan itself happens on a phone camera; what the member sees next
      // is this page.
      await page.goto(`/events/${EVENT_ID}/check-in`);
      await settle(page);
      await tap(page, page.getByRole('button', { name: 'Check In to This Event' }));
    });
    await shot('done', async () => {
      await centre(page, page.getByText("You're Checked In").first());
    });
    await shot('outro', async () => {
      await page.waitForTimeout(300);
    });
  });
});
