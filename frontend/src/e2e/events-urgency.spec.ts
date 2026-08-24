/**
 * Visual check of the /events urgency treatment.
 *
 * The unit tests assert that the right words and links appear. They cannot see
 * whether the amber "missed" strip is legible on a dark background, whether the
 * manager chips clear the status strip, or whether a 4px accent survives the
 * card's `overflow-hidden` — all of which are properties of the rendered page.
 * This drives the real page in a browser with one fixture per urgency state and
 * captures desktop and phone in both themes.
 *
 * Screenshots land in test-results/ for a human to look at; the assertions here
 * cover the structural facts that are cheap to regress and invisible in a diff.
 */

import { test, expect, type Page } from '@playwright/test';
import { json, mockApi, TEST_USER } from './helpers';

const hoursFromNow = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();

/** One event per urgency state, so a single page holds the whole ladder. */
const EVENTS = [
  {
    id: 'evt-live',
    title: 'Ladder Company Drill',
    event_type: 'training',
    start_datetime: hoursFromNow(-1),
    end_datetime: hoursFromNow(1),
    check_in_opens_at: hoursFromNow(-2),
    check_in_closes_at: hoursFromNow(1),
    location_name: 'Training Grounds',
    requires_rsvp: true,
    is_mandatory: false,
    is_cancelled: false,
    going_count: 12,
    credited_hours: 2,
    hour_category_label: 'drill',
  },
  {
    id: 'evt-action',
    title: 'Monthly Business Meeting',
    event_type: 'business_meeting',
    start_datetime: hoursFromNow(26),
    end_datetime: hoursFromNow(28),
    rsvp_deadline: hoursFromNow(20),
    location_name: 'Station 1 Dayroom',
    requires_rsvp: true,
    is_mandatory: true,
    is_cancelled: false,
    going_count: 8,
  },
  {
    id: 'evt-confirmed',
    title: 'Annual Awards Banquet',
    event_type: 'ceremony',
    start_datetime: hoursFromNow(200),
    end_datetime: hoursFromNow(204),
    location_name: 'Banquet Hall',
    requires_rsvp: true,
    is_mandatory: false,
    is_cancelled: false,
    user_rsvp_status: 'going',
    going_count: 42,
  },
  {
    id: 'evt-waitlisted',
    title: 'Rope Rescue Technician',
    event_type: 'training',
    start_datetime: hoursFromNow(300),
    end_datetime: hoursFromNow(308),
    location_name: 'Tower Site',
    requires_rsvp: true,
    is_mandatory: false,
    is_cancelled: false,
    user_rsvp_status: 'waitlisted',
    max_attendees: 14,
    going_count: 14,
  },
  {
    id: 'evt-declined',
    title: 'Pancake Breakfast',
    event_type: 'fundraiser',
    start_datetime: hoursFromNow(400),
    end_datetime: hoursFromNow(404),
    location_name: 'Station 2 Bay',
    requires_rsvp: true,
    is_mandatory: false,
    is_cancelled: false,
    user_rsvp_status: 'not_going',
    going_count: 30,
  },
  {
    id: 'evt-routine',
    title: 'Open House Planning',
    event_type: 'public_education',
    start_datetime: hoursFromNow(500),
    end_datetime: hoursFromNow(502),
    location_name: 'Station 1 Classroom',
    requires_rsvp: true,
    is_mandatory: false,
    is_cancelled: false,
    going_count: 4,
  },
];

const MISSED = [
  {
    id: 'evt-missed',
    title: 'Standpipe Drill',
    event_type: 'training',
    start_datetime: hoursFromNow(-260),
    end_datetime: hoursFromNow(-258),
    location_name: 'Training Grounds',
    requires_rsvp: true,
    is_mandatory: true,
    is_cancelled: false,
    user_attended: false,
    credited_hours: 2,
  },
];

/**
 * Route order matters: `mockApi` installs a permissive `**\/api/v1/**`
 * catch-all, and Playwright matches the most recently registered route first,
 * so these must go on after it.
 */
async function gotoEvents(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await mockApi(page, { permissions: TEST_USER.permissions });

  await page.route('**/api/v1/events/missed-mandatory**', (route) => route.fulfill(json(MISSED)));
  await page.route('**/api/v1/events/visible-event-types**', (route) =>
    route.fulfill(
      json({
        visible_event_types: ['business_meeting', 'public_education', 'training', 'ceremony', 'fundraiser', 'other'],
        custom_event_categories: [],
        visible_custom_categories: [],
      })
    )
  );
  await page.route('**/api/v1/events?**', (route) => route.fulfill(json(EVENTS)));

  await page.goto('/login');
  await page.evaluate((t) => {
    localStorage.setItem('has_session', '1');
    localStorage.setItem('theme-preference', t);
  }, theme);

  await page.goto('/events');
  await expect(page.getByRole('heading', { name: 'Events', level: 1 })).toBeVisible({ timeout: 15_000 });
  // Fonts and the band's derived rows settle a frame after the fetch resolves.
  await expect(page.getByTestId('needs-you-band')).toBeVisible();
}

test.describe('Events page urgency treatment', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`desktop — ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1400 });
      await gotoEvents(page, theme);

      const band = page.getByTestId('needs-you-band');

      // The band leads with what is happening now, then what is unanswered,
      // then what was missed — the order the ladder promises.
      await expect(band.getByText('Ladder Company Drill is happening now')).toBeVisible();
      await expect(band.getByText("Monthly Business Meeting is mandatory and you haven't responded")).toBeVisible();
      await expect(band.getByText('No check-in recorded for Standpipe Drill')).toBeVisible();
      await expect(band.getByText('3', { exact: true })).toBeVisible();

      // Routine events must not be in the band — that absence is the design.
      await expect(band.getByText(/Open House Planning/)).toHaveCount(0);

      await page.screenshot({
        path: `test-results/events-urgency-desktop-${theme}.png`,
        fullPage: true,
      });
    });

    test(`phone — ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await gotoEvents(page, theme);

      await page.screenshot({
        path: `test-results/events-urgency-phone-${theme}.png`,
        fullPage: true,
      });
    });
  }

  test('every footer control clears the 44px touch minimum on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoEvents(page, 'light');

    // Card footers only; the header/filter chrome has its own coverage.
    const controls = page.locator('[data-testid="events-grid"] button, [data-testid="events-grid"] a');
    const count = await controls.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const control = controls.nth(i);
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      if (!box) continue;
      expect(
        box.height,
        `control ${i} ("${(await control.textContent())?.trim().slice(0, 30)}") is ${box.height}px tall`
      ).toBeGreaterThanOrEqual(43.5);
    }
  });

  test('the manager chips do not sit on top of the status strip', async ({ page }) => {
    // The chips are absolutely positioned in the card corner from md up; with a
    // status strip present they have to clear it, or they cover the strip's
    // right-hand meta ("Check-in closes 8:15 PM").
    await page.setViewportSize({ width: 1280, height: 1400 });
    await gotoEvents(page, 'light');

    const liveCard = page.locator('[data-testid="events-grid"] > div').filter({ hasText: 'Ladder Company Drill' });
    const strip = liveCard.getByText('Happening now');
    const editChip = liveCard.getByRole('link', { name: /^Edit / });

    const stripBox = await strip.boundingBox();
    const chipBox = await editChip.boundingBox();
    // Throwing narrows both to non-null for the comparison below, where `!`
    // would only silence the compiler and leave a bad failure message.
    if (!stripBox || !chipBox) {
      const missing = [!stripBox && 'status strip', !chipBox && 'Edit chip'].filter(Boolean).join(' and ');
      throw new Error(`Expected the ${missing} to be laid out, but it has no bounding box`);
    }

    // The chip's top edge starts below the strip's bottom edge.
    expect(chipBox.y).toBeGreaterThanOrEqual(stripBox.y + stripBox.height);
  });
});
