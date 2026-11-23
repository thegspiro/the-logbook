import { test, type Page, type Route } from '@playwright/test';

import { signIn } from '../../../frontend/src/e2e/helpers';
import { SCALE, ZONE, centre, decoyQr, prepare, recordShots, settle, tap, zoneDay, zoned } from '../../lib/recorder';

/**
 * Member Guide, Chapter 3 — "Events & RSVPs", on a landscape tablet.
 *
 * Serves a week of events around a fixed clock (6:20 PM on the render day):
 * a drill that counts toward attendance, a meeting, a kitchen-crew slot that
 * is already full, tonight's hose testing with check-in open, and two past
 * events, one of them mandatory with no check-in. RSVPs, the waitlist, the
 * check-in and the "I was there" request are all remembered, so each screen
 * shows what the one before it did. Responses are snake_case, as the event
 * schemas are.
 */

const ME = 'e2e-user-id'; // signIn's fixture user
const SCREEN = { width: 1180, height: 820 };
const TODAY = zoneDay(0);
const NOW = zoned(TODAY, 18, 20);
const day = (offset: number) => zoneDay(offset);
const iso = (d: Date) => d.toISOString();

interface Ev {
  id: string;
  title: string;
  event_type: string;
  start: Date;
  end: Date;
  location_name: string;
  description: string;
  requires_rsvp: boolean;
  is_mandatory: boolean;
  counts_toward_attendance: boolean;
  going_count: number;
  max_attendees: number | null;
  rsvp_deadline: Date | null;
  check_in_opens_at: Date;
  check_in_closes_at: Date;
  user_attended: boolean;
}

const EVENTS: Ev[] = [
  {
    id: 'evt-hose',
    title: 'Annual Hose Testing',
    event_type: 'training',
    start: zoned(TODAY, 19, 0),
    end: zoned(TODAY, 21, 0),
    location_name: 'Station 1 Apparatus Bay',
    description: 'Service testing of every length on Engine 1 and Engine 2. Gloves and eye protection.',
    requires_rsvp: false,
    is_mandatory: false,
    counts_toward_attendance: false,
    going_count: 11,
    max_attendees: null,
    rsvp_deadline: null,
    check_in_opens_at: zoned(TODAY, 18, 0),
    check_in_closes_at: zoned(TODAY, 21, 0),
    user_attended: false,
  },
  {
    id: 'evt-drill',
    title: 'Monday Night Drill: Ladder Operations',
    event_type: 'training',
    start: zoned(day(2), 19, 0),
    end: zoned(day(2), 21, 30),
    location_name: 'Station 1 Training Grounds',
    description: 'Ground ladder raises, roof work and a timed evolution. Full turnout gear.',
    requires_rsvp: true,
    is_mandatory: true,
    counts_toward_attendance: true,
    going_count: 14,
    max_attendees: null,
    rsvp_deadline: zoned(day(1), 21, 0),
    check_in_opens_at: zoned(day(2), 18, 0),
    check_in_closes_at: zoned(day(2), 21, 30),
    user_attended: false,
  },
  {
    id: 'evt-meeting',
    title: 'Monthly Business Meeting',
    event_type: 'business_meeting',
    start: zoned(day(5), 19, 30),
    end: zoned(day(5), 21, 0),
    location_name: 'Station 1 Conference Room',
    description: 'Officer reports, the apparatus committee update and new business.',
    requires_rsvp: true,
    is_mandatory: true,
    counts_toward_attendance: false,
    going_count: 22,
    max_attendees: null,
    rsvp_deadline: null,
    check_in_opens_at: zoned(day(5), 18, 30),
    check_in_closes_at: zoned(day(5), 21, 0),
    user_attended: false,
  },
  {
    id: 'evt-breakfast',
    title: 'Pancake Breakfast: Kitchen Crew',
    event_type: 'fundraiser',
    start: zoned(day(9), 6, 30),
    end: zoned(day(9), 11, 0),
    location_name: 'Station 1 Hall',
    description: 'Three people on the griddle and the coffee for the spring fundraiser.',
    requires_rsvp: true,
    is_mandatory: false,
    counts_toward_attendance: false,
    going_count: 3,
    max_attendees: 3,
    rsvp_deadline: null,
    check_in_opens_at: zoned(day(9), 6, 0),
    check_in_closes_at: zoned(day(9), 11, 0),
    user_attended: false,
  },
];

const PAST: Ev[] = [
  {
    id: 'evt-pastdrill',
    title: 'Monday Night Drill: Hose Advancement',
    event_type: 'training',
    start: zoned(day(-6), 19, 0),
    end: zoned(day(-6), 21, 30),
    location_name: 'Station 1 Training Grounds',
    description: 'Stretching and advancing attack lines, with a stairwell evolution.',
    requires_rsvp: true,
    is_mandatory: true,
    counts_toward_attendance: true,
    going_count: 16,
    max_attendees: null,
    rsvp_deadline: null,
    check_in_opens_at: zoned(day(-6), 18, 0),
    check_in_closes_at: zoned(day(-6), 21, 30),
    user_attended: false,
  },
  {
    id: 'evt-pastmeeting',
    title: 'Monthly Business Meeting',
    event_type: 'business_meeting',
    start: zoned(day(-12), 19, 30),
    end: zoned(day(-12), 21, 0),
    location_name: 'Station 1 Conference Room',
    description: 'Officer reports and the budget review.',
    requires_rsvp: true,
    is_mandatory: true,
    counts_toward_attendance: false,
    going_count: 24,
    max_attendees: null,
    rsvp_deadline: null,
    check_in_opens_at: zoned(day(-12), 18, 30),
    check_in_closes_at: zoned(day(-12), 21, 0),
    user_attended: true,
  },
];

// What this member has done, so each screen reflects the step before it.
const rsvp: Record<string, string> = { 'evt-pastmeeting': 'going' };
const checkedIn: Record<string, string> = {};
let petition: Record<string, unknown> | null = null;

const occupied = (e: Ev) => e.going_count + (rsvp[e.id] === 'going' ? 1 : 0);
const waitlisted = (e: Ev) => rsvp[e.id] === 'waitlisted';

function listItem(e: Ev) {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    event_type: e.event_type,
    start_datetime: iso(e.start),
    end_datetime: iso(e.end),
    location_name: e.location_name,
    requires_rsvp: e.requires_rsvp,
    is_mandatory: e.is_mandatory,
    counts_toward_attendance: e.counts_toward_attendance,
    is_draft: false,
    is_cancelled: false,
    is_recurring: false,
    going_count: occupied(e),
    occupied_seats: occupied(e),
    waitlist_count: waitlisted(e) ? 1 : 0,
    max_attendees: e.max_attendees,
    allowed_rsvp_statuses: ['going', 'not_going'],
    user_rsvp_status: rsvp[e.id] ?? null,
    rsvp_deadline: e.rsvp_deadline ? iso(e.rsvp_deadline) : null,
    check_in_opens_at: iso(e.check_in_opens_at),
    check_in_closes_at: iso(e.check_in_closes_at),
    user_attended: e.user_attended || e.id in checkedIn,
    credited_hours: null,
  };
}

function detail(e: Ev) {
  const status = rsvp[e.id];
  return {
    ...listItem(e),
    organization_id: 'org-1',
    location: e.location_name,
    allow_guests: false,
    user_rsvp: status ? { status, guest_count: 0, notes: null } : null,
    user_waitlist_position: waitlisted(e) ? 1 : null,
    user_waitlist_exceeds_capacity: false,
    can_view_attendees: false,
    can_manage_organizers: false,
    can_review_attendance_requests: false,
    can_edit_event: false,
    can_reopen_attendance: false,
    can_correct_attendance_times: false,
    can_staff_event: false,
    can_record_guest_headcount: false,
    custom_fields: [],
    attachments: [],
    allow_guest_check_in: false,
    organizer_name: 'Capt. Dana Smith',
    created_by_name: 'Capt. Dana Smith',
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
  };
}

const qrData = (e: Ev) => ({
  event_id: e.id,
  event_name: e.title,
  event_type: e.event_type,
  location: e.location_name,
  start_datetime: iso(e.start),
  end_datetime: iso(e.end),
  check_in_start: iso(e.check_in_opens_at),
  check_in_end: iso(e.check_in_closes_at),
  is_valid: true,
  can_check_in: !(e.id in checkedIn),
  timezone: ZONE,
  records_training: false,
  user_checked_in_at: checkedIn[e.id] ?? null,
  user_checked_out_at: null,
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const all = [...EVENTS, ...PAST];

// Registered after signIn's fixtures, so these answer first for their URLs.
async function mockEvents(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/events' || /^\/api\/v1\/events\/evt-/.test(url.pathname),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      if (path === '/api/v1/events') {
        const past = url.searchParams.has('end_before');
        return json(route, (past ? PAST : EVENTS).map(listItem));
      }
      const [, , , , id, ...rest] = path.split('/');
      const e = all.find((x) => x.id === id);
      if (!e) return route.fallback();
      const sub = rest.join('/');
      if (sub === '') return json(route, detail(e));
      if (sub === 'rsvp' && req.method() === 'POST') {
        const body = req.postDataJSON() as { status: string };
        const full = e.max_attendees !== null && occupied(e) >= e.max_attendees;
        rsvp[e.id] = body.status === 'going' && full ? 'waitlisted' : body.status;
        return json(route, { id: `rsvp-${e.id}`, event_id: e.id, user_id: ME, status: rsvp[e.id], guest_count: 0 });
      }
      if (sub === 'qr-check-in-data') return json(route, qrData(e));
      if (sub === 'self-check-in' && req.method() === 'POST') {
        checkedIn[e.id] = NOW.toISOString();
        return json(route, {
          id: `rsvp-${e.id}`,
          event_id: e.id,
          user_id: ME,
          status: 'going',
          guest_count: 0,
          checked_in: true,
          checked_in_at: checkedIn[e.id],
          checked_out_at: null,
        });
      }
      if (sub === 'attendance-petitions/mine') {
        if (req.method() === 'DELETE') {
          petition = null;
          return route.fulfill({ status: 204 });
        }
        return json(route, {
          petition,
          can_request: e.id === 'evt-pastdrill' && !petition,
          unavailable_reason: null,
          can_withdraw: !!petition,
        });
      }
      if (sub === 'attendance-petitions' && req.method() === 'POST') {
        const body = req.postDataJSON() as Record<string, string | null>;
        petition = {
          id: 'petition-1',
          event_id: e.id,
          user_id: ME,
          user_name: 'Alex Tester',
          status: 'pending',
          reason: body.reason,
          requested_check_in_at: body.requested_check_in_at ?? null,
          requested_check_out_at: body.requested_check_out_at ?? null,
          reviewed_by: null,
          reviewed_by_name: null,
          reviewed_at: null,
          review_note: null,
          created_at: NOW.toISOString(),
          withdrawal_count: 0,
        };
        return json(route, petition, 201);
      }
      return route.fallback();
    }
  );
  await page.route('**/api/v1/events/missed-mandatory**', (route) => json(route, []));
  await page.route('**/api/v1/events/attendance-petitions/pending**', (route) => json(route, []));
  await page.route('**/api/v1/elections?**', (route) => json(route, []));
  await page.route('**/api/v1/training/sessions/by-event/**', (route) => json(route, { detail: 'No session' }, 404));
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: ZONE });

test('capture 6-member-03-events', async ({ page }) => {
  // A chapter runs minutes, not the config's two-minute allowance for a short.
  test.setTimeout(600_000);
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
  await mockEvents(page);
  await page.goto('/events');
  await settle(page);

  const main = page.getByRole('main');
  const card = (title: string) => main.getByRole('heading', { name: title, level: 3 }).first();

  await recordShots(page, '6-member-03-events', async (shot) => {
    await shot('intro', async () => {
      await page.waitForTimeout(800);
    });
    await shot('cards', async () => {
      await centre(page, card('Monthly Business Meeting'));
    });
    await shot('badge', async () => {
      await centre(page, main.getByText('Counts toward attendance').first());
    });
    await shot('calendar', async () => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(600);
      await tap(page, main.getByRole('button', { name: 'Calendar view' }));
      await page.waitForTimeout(2200);
      await tap(page, main.getByRole('button', { name: 'List view' }));
      await settle(page);
    });
    await shot('open', async () => {
      await tap(page, card('Monday Night Drill: Ladder Operations'));
      await page.waitForURL('**/events/evt-drill');
      await settle(page);
      await tap(page, main.getByRole('button', { name: 'RSVP Now' }));
      await page.getByRole('dialog').waitFor();
    });
    await shot('choose', async () => {
      const dialog = page.getByRole('dialog');
      await tap(page, dialog.getByRole('radio', { name: 'Going', exact: true }));
      const notes = dialog.getByLabel('Notes (optional)');
      await tap(page, notes);
      await notes.pressSequentially('Bringing my own helmet light.', { delay: 30 });
      await tap(page, dialog.getByRole('button', { name: 'Submit RSVP' }));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    });
    await shot('answered', async () => {
      await centre(page, main.getByText('Your RSVP').first());
    });
    await shot('closed', async () => {
      await page.waitForTimeout(400);
    });
    await shot('full', async () => {
      await page.goto('/events');
      await settle(page);
      await tap(page, card('Pancake Breakfast: Kitchen Crew'));
      await page.waitForURL('**/events/evt-breakfast');
      await settle(page);
      await centre(page, main.getByText('Event Full').first());
    });
    await shot('waitlist', async () => {
      await tap(page, main.getByRole('button', { name: 'RSVP Now' }));
      const dialog = page.getByRole('dialog');
      await tap(page, dialog.getByRole('radio', { name: 'Going', exact: true }));
      await tap(page, dialog.getByRole('button', { name: 'Submit RSVP' }));
      await dialog.waitFor({ state: 'hidden' });
      await settle(page);
      await centre(page, main.getByText(/on the waitlist/).first());
    });
    await shot('promote', async () => {
      await page.waitForTimeout(400);
    });
    await shot('qr', async () => {
      // The code an officer puts up at the door. It is swapped for a decoy
      // before it is painted: the real one encodes this capture's link.
      await page.goto('/events/evt-hose/qr-code');
      await settle(page);
      const qr = page.locator('.qr-container').first();
      await decoyQr(qr);
      await centre(page, qr);
    });
    await shot('checkin', async () => {
      // The scan happens on the member's phone; this is the page it opens.
      await page.goto('/events/evt-hose/check-in');
      await settle(page);
      await tap(page, page.getByRole('button', { name: 'Check In to This Event' }));
    });
    await shot('checked', async () => {
      await centre(page, page.getByText("You're Checked In").first());
    });
    await shot('early', async () => {
      await page.waitForTimeout(400);
    });
    await shot('petition', async () => {
      await page.goto('/events/evt-pastdrill');
      await settle(page);
      const button = main.getByRole('button', { name: 'I was there' });
      await centre(page, button);
      await tap(page, button);
      await page.getByRole('dialog').waitFor();
    });
    await shot('form', async () => {
      const dialog = page.getByRole('dialog');
      const reason = dialog.getByLabel(/Why is there no check-in/);
      await tap(page, reason);
      await reason.pressSequentially('My phone died before I could scan the code at the door.', { delay: 22 });
      await page.waitForTimeout(300);
      await tap(page, dialog.getByRole('button', { name: 'Send request' }));
      await dialog.waitFor({ state: 'hidden' });
      await settle(page);
    });
    await shot('waiting', async () => {
      await centre(page, main.getByRole('button', { name: 'Withdraw request' }));
    });
    await shot('past', async () => {
      await page.goto('/events');
      await settle(page);
      await tap(page, main.getByRole('button', { name: 'Past', exact: true }));
      await settle(page);
      await centre(page, main.getByText('No check-in recorded').first());
    });
    await shot('outro', async () => {
      await page.waitForTimeout(400);
    });
  });
});
