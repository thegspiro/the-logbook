import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const event = {
  id: 'modal-mobile',
  organization_id: 'org-1',
  title: 'Long-form Mobile Event',
  description: 'An event used to exercise the complete RSVP form.',
  event_type: 'business_meeting',
  location: 'Station 1',
  start_datetime: '2030-08-20T18:00:00Z',
  end_datetime: '2030-08-20T20:00:00Z',
  requires_rsvp: true,
  rsvp_deadline: '2030-08-19T18:00:00Z',
  allowed_rsvp_statuses: ['going', 'not_going', 'maybe'],
  allow_guests: true,
  is_mandatory: false,
  send_reminders: false,
  is_cancelled: false,
  is_recurring: true,
  created_at: '2026-08-20T10:00:00Z',
  updated_at: '2026-08-20T10:00:00Z',
};

async function openLongEventDialog(page: Page) {
  await page.route('**/api/v1/events/modal-mobile', (route) => route.fulfill({ json: event }));
  await page.route('**/api/v1/events/modal-mobile/rsvps**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/events/modal-mobile/stats', (route) => route.fulfill({ json: {} }));
  await page.goto('/events/modal-mobile');
  await page.getByRole('button', { name: 'RSVP Now' }).click();
  await expect(page.getByRole('dialog', { name: 'RSVP for Long-form Mobile Event' })).toBeVisible();
}

test.describe('shared modal mobile regression', () => {
  for (const scenario of [
    { name: '320px viewport', width: 320, height: 568 },
    { name: 'short landscape viewport', width: 667, height: 320 },
    // Chromium exposes a resized visual viewport when the emulated software
    // keyboard is open; 420px matches the visible portion of a 390x844 phone.
    { name: 'open software keyboard visual viewport', width: 390, height: 420 },
  ]) {
    test(`${scenario.name} keeps the heading, scroller, and primary action reachable`, async ({ page }) => {
      await page.setViewportSize({ width: scenario.width, height: scenario.height });
      await signIn(page);
      await openLongEventDialog(page);

      const dialog = page.getByRole('dialog');
      const panel = page.getByTestId('modal-panel');
      const body = page.getByTestId('modal-content');
      const submit = page.getByRole('button', { name: 'Submit RSVP' });
      await expect(dialog.getByRole('heading')).toBeInViewport();
      await expect(submit).toBeInViewport();
      await expect(panel).toHaveCSS('overflow', 'hidden');
      await expect(body).toHaveCSS('overflow-y', 'auto');
      expect(await panel.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(scenario.height);

      await body.evaluate((node) => node.scrollTo(0, node.scrollHeight));
      await expect(dialog.getByRole('heading')).toBeInViewport();
      await expect(submit).toBeInViewport();
    });
  }
});
