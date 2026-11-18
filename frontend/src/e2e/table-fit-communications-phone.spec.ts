import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'settings.manage', 'events.manage'];
const SENT_AT = '2026-10-14T15:30:00Z';

const messageHistory = {
  items: [0, 1, 2, 3].map((i) => ({
    id: `message-${i}`,
    to_email: 'quartermaster.logistics.coordinator@northwest-county-fire-rescue-district.example.org',
    subject:
      'Reminder: annual self-contained breathing apparatus fit testing and medical clearance deadline approaching',
    template_type: 'event_reminder',
    status: i % 2 ? 'failed' : 'sent',
    error_message: 'SMTP relay refused the connection after the greeting',
    recipient_count: i + 1,
    sent_at: SENT_AT,
  })),
  total: 4,
  skip: 0,
  limit: 20,
};

const totals = {
  events_held: 4,
  people_reached: 4960,
  signed_in: 4960,
  estimated: 0,
  member_hours: 450,
  members_involved: 38,
  requests_received: 6,
  requests_completed: 4,
};

const communityEngagement = {
  total_public_events: 21,
  total_member_attendees: 160,
  total_external_attendees: 610,
  upcoming_public_events: 3,
  period: 'year',
  period_start: '2026-01-01',
  period_end: '2026-12-31',
  current: totals,
  previous: totals,
  upcoming_events: 1,
  turnout: { events: 4, signed_in: 4960, expected: 6000 },
  granularity: 'month',
  by_period: [{ period: '2026-10', events: 4, signed_in: 4960, estimated: 0 }],
  by_type: [{ label: 'Public education and fire prevention outreach', events: 4, people_reached: 4960 }],
  recent_events: [0, 1, 2, 3].map((i) => ({
    event_id: `event-${i}`,
    title: 'Fire prevention week open house, apparatus display and smoke trailer demonstration',
    start_datetime: SENT_AT,
    type_label: 'Public education and fire prevention outreach',
    organization_name: 'Northwest County Elementary School Parent Teacher Association',
    request_id: 'request-1',
    signed_in: 1240,
    expected: 1500,
    people_reached: 1240,
    reach_is_estimate: false,
    crew: 14,
    member_hours: 112.5,
  })),
};

async function openSignedIn(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await signIn(page, { permissions: PERMISSIONS });
}

// Sent email history: status, a long recipient address, a long subject, the
// template type from lg up, and the send time.
test.describe('Message history table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/communications/email-templates?tab=history — ${viewport.name}`, async ({ page }) => {
      await openSignedIn(page, viewport);
      await page.route('**/api/v1/message-history**', (route) => void route.fulfill(json(messageHistory)));
      await page.goto('/communications/email-templates?tab=history');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Recipient', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Message history table');
    });
  }
});

// Recent outreach events: date, event and its organizer, type, reach, crew and
// hours. Under 640px the tab draws its own phone list instead, so the table is
// measured from the tablet widths up, where the side navigation narrows it.
test.describe('Recent outreach events table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/events/admin?tab=community — ${viewport.name}`, async ({ page }) => {
      await openSignedIn(page, viewport);
      await page.route(
        '**/api/v1/dashboard/community-engagement**',
        (route) => void route.fulfill(json(communityEngagement))
      );
      await page.goto('/events/admin?tab=community');

      const table = page.getByRole('table', { name: 'Recent outreach events' });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Recent outreach events table');
    });
  }
});
