import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'analytics.view'];

const TOP_EVENT_TITLES = [
  'Annual Live Fire Training Evolution at the Regional Burn Tower Complex',
  'Quarterly Business Meeting and Officer Election for the Volunteer Association',
  'Community Fire Prevention Open House and Smoke Alarm Giveaway',
  'Hazardous Materials Operations Level Refresher with County HazMat Team',
];

const TOP_EVENT_TYPES = ['training', 'business_meeting', 'public_education', 'training'];

const ANALYTICS_SUMMARY = {
  total_events: 148,
  total_rsvps: 2310,
  total_checked_in: 1904,
  avg_attendance_rate: 0.82,
  check_in_rate: 0.79,
  avg_checkin_minutes_before: 12,
  event_type_distribution: [{ event_type: 'training', count: 80 }],
  monthly_event_counts: [{ month: '2026-10', count: 14 }],
  top_events: TOP_EVENT_TITLES.map((title, i) => ({
    event_id: `event-${i}`,
    title,
    event_type: TOP_EVENT_TYPES[i] ?? 'other',
    start_datetime: `2026-0${i + 4}-14T18:30:00Z`,
    going_count: 1184 - i,
    checked_in_count: 1171 - i,
    attendance_rate: 0.93 - i * 0.2,
  })),
};

const VIEWPORTS = [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS];

// Top events by attendance sets a long event title beside type, date and three
// figures; on a phone that is wider than its card, pushing the attendance rate
// off the screen.
test.describe('Event analytics — top events by attendance table', () => {
  for (const viewport of VIEWPORTS) {
    test(`/events/analytics — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route('**/api/v1/events/analytics/summary**', (route) => {
        void route.fulfill(json(ANALYTICS_SUMMARY));
      });
      await page.goto('/events/analytics');

      const table = page.getByRole('region', { name: 'Top events by attendance' }).getByRole('table');
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Top events by attendance table');
    });
  }
});
