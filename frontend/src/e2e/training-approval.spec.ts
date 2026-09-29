import { expect, test, type Page } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * The officer's review of a Training event's credit, reached from the approval
 * email and the event page. The route had no page before, so the emailed link
 * bounced officers to the dashboard and nothing could complete a session that
 * required confirmation.
 *
 * The request body is asserted, not just the screen: an untouched row must go
 * back with its snapshot override (null means "use the credited minutes"), and
 * an approved 0 must travel as 0 rather than being dropped as falsy.
 */

const TOKEN = 'approval-token-e2e';

const approval = (status = 'pending') => ({
  id: 'approval-1',
  training_session_id: 'session-1',
  event_id: 'event-1',
  status,
  approval_deadline: '2026-10-06T13:45:00Z',
  event_title: 'SCBA Confidence Course',
  event_start_datetime: '2026-09-29T10:45:00Z',
  event_end_datetime: '2026-09-29T13:45:00Z',
  course_name: 'SCBA Confidence Course',
  credit_hours: 3,
  attendees: [
    {
      user_id: 'user-avery',
      user_name: 'Jordan Avery',
      user_email: 'avery@example.org',
      checked_in_at: '2026-09-29T10:45:00Z',
      checked_out_at: '2026-09-29T13:45:00Z',
      calculated_duration_minutes: 180,
      override_duration_minutes: null,
    },
    {
      user_id: 'user-blake',
      user_name: 'Sam Blake',
      user_email: 'blake@example.org',
      checked_in_at: '2026-09-29T11:15:00Z',
      checked_out_at: '2026-09-29T13:45:00Z',
      calculated_duration_minutes: 150,
      override_duration_minutes: null,
    },
  ],
  approved_by: null,
  approved_at: status === 'pending' ? null : '2026-09-29T15:00:00Z',
  approval_notes: null,
  created_at: '2026-09-29T14:00:00Z',
});

interface SubmittedAttendee {
  user_id: string;
  approved: boolean;
  override_duration_minutes: number | null;
  notes: string | null;
}

async function gotoApproval(page: Page, status = 'pending'): Promise<{ bodies: string[] }> {
  const captured = { bodies: [] as string[] };
  await signIn(page, { permissions: ['training.view', 'training.manage', 'events.view', 'events.manage'] });
  await page.route(`**/api/v1/training/sessions/approve/${TOKEN}`, (route) => {
    if (route.request().method() === 'POST') {
      captured.bodies.push(route.request().postData() ?? '');
      return route.fulfill(json({ message: 'Training approval submitted successfully', status: 'approved' }));
    }
    return route.fulfill(json(approval(status)));
  });
  await page.goto(`/training/approve/${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'SCBA Confidence Course' })).toBeVisible();
  return captured;
}

test.describe('Training approval', () => {
  test('records the officer approved minutes, a 0 included', async ({ page }) => {
    const captured = await gotoApproval(page);

    await expect(page.getByText('Awaiting approval')).toBeVisible();
    const blake = page.getByLabel('Approved minutes for Sam Blake');
    await expect(blake).toHaveValue('150');
    await blake.fill('0');
    await page.getByLabel('Note for Sam Blake').fill('Left before the evolutions');

    await page.getByRole('button', { name: 'Approve and record' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText("Records 2 members' training credit");
    await dialog.getByRole('button', { name: 'Approve and record' }).click();

    await expect(page.getByText('Approval recorded: 1 member credited, 1 given no credit')).toBeVisible();
    await page.waitForURL('**/events/event-1');

    expect(captured.bodies).toHaveLength(1);
    const body = JSON.parse(captured.bodies[0] ?? '{}') as { attendees: SubmittedAttendee[] };
    const byId = Object.fromEntries(body.attendees.map((a) => [a.user_id, a]));
    // Untouched: the snapshot override goes back, so the credited 180 stands.
    expect(byId['user-avery']).toMatchObject({ approved: true, override_duration_minutes: null, notes: null });
    // Edited to 0: sent as 0, which the backend reads as "no credit".
    expect(byId['user-blake']).toMatchObject({
      approved: true,
      override_duration_minutes: 0,
      notes: 'Left before the evolutions',
    });
  });

  test('refuses a blank figure before anything is sent', async ({ page }) => {
    const captured = await gotoApproval(page);

    await page.getByLabel('Approved minutes for Jordan Avery').fill('');
    await expect(page.getByText('Enter the approved minutes. 0 gives no credit.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and record' })).toBeDisabled();
    expect(captured.bodies).toHaveLength(0);
  });

  test('a processed approval is read-only', async ({ page }) => {
    await gotoApproval(page, 'approved');

    await expect(page.getByText('Already approved')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and record' })).toHaveCount(0);
    await expect(page.getByLabel('Approved minutes for Jordan Avery')).toHaveCount(0);
  });

  test('the roster fits a phone without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApproval(page);

    await expect(page.getByLabel('Approved minutes for Jordan Avery')).toBeVisible();
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    );
    expect(overflowX).toBe(false);
  });
});
