import { expect, test, type Page, type Route } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * The member-facing path for reporting training done outside the department.
 *
 * The three things worth an end-to-end check are the ones unit tests cannot
 * see whole: that a certificate travels with the create rather than after it,
 * that a draft round-trips without filing a second copy, and that a returned
 * submission opens the page on the officer's note. Requests are captured so
 * the shape of the call is asserted, not just the screen.
 */

const CONFIG = {
  id: 'config-1',
  organization_id: 'org-1',
  require_approval: true,
  approval_deadline_days: 14,
  notify_officer_on_submit: true,
  notify_member_on_decision: true,
  field_config: {
    course_name: { visible: true, required: true, label: 'Course or class name' },
    training_type: { visible: true, required: true, label: 'Training type' },
    completion_date: { visible: true, required: true, label: 'Date' },
    instructor: { visible: true, required: false, label: 'Instructor' },
    description: { visible: true, required: false, label: 'What it covered' },
    category_id: { visible: true, required: false, label: 'Category' },
    attachments: { visible: true, required: false, label: 'Supporting Documents' },
  },
  allowed_training_types: null,
  max_hours_per_submission: 16,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const RETURNED_SUBMISSION = {
  id: 'sub-returned',
  organization_id: 'org-1',
  submitted_by: 'e2e-user-id',
  course_name: 'Hazmat Operations Refresher',
  training_type: 'refresher',
  completion_date: '2026-03-12',
  start_time: '13:00:00',
  hours_completed: 4,
  status: 'revision_requested',
  reviewer_notes: 'Certificate number does not match the roster.',
  certification_number: '00-4471-B',
  issuing_agency: 'VDFP',
  reviewed_at: '2026-03-14T15:00:00Z',
  submitted_at: '2026-03-12T12:00:00Z',
  updated_at: '2026-03-14T15:00:00Z',
};

interface Captured {
  posts: { url: string; contentType: string; body: string }[];
  patches: string[];
}

/** Install the submit screen's own fixtures over the shared catch-all. */
async function mockSubmitScreen(page: Page, submissions: unknown[] = []): Promise<Captured> {
  const captured: Captured = { posts: [], patches: [] };

  await page.route('**/api/v1/training/submissions/config', (route) => route.fulfill(json(CONFIG)));
  await page.route('**/api/v1/training/categories**', (route) =>
    route.fulfill(json([{ id: 'cat-ems', name: 'EMS', organization_id: 'org-1', active: true }]))
  );
  await page.route('**/api/v1/training/programs/requirements**', (route) =>
    route.fulfill(json([{ id: 'r1', name: 'CPR / BLS Provider Renewal', active: true }]))
  );
  await page.route('**/api/v1/training/submissions/my**', (route) => route.fulfill(json(submissions)));

  const record = (route: Route) => {
    const request = route.request();
    captured.posts.push({
      url: request.url(),
      contentType: request.headers()['content-type'] ?? '',
      body: request.postData() ?? '',
    });
  };

  await page.route('**/api/v1/training/submissions/with-attachment', (route) => {
    record(route);
    return route.fulfill(json({ id: 'sub-new', status: 'pending_review' }, 201));
  });
  await page.route('**/api/v1/training/submissions', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    record(route);
    const body = JSON.parse(route.request().postData() || '{}') as { save_as_draft?: boolean };
    return route.fulfill(
      json(
        {
          id: 'sub-new',
          status: body.save_as_draft ? 'draft' : 'pending_review',
          course_name: 'Draft in progress',
          training_type: 'continuing_education',
          completion_date: '2026-03-18',
          hours_completed: 4,
          organization_id: 'org-1',
          submitted_by: 'e2e-user-id',
          submitted_at: '2026-03-18T12:00:00Z',
          updated_at: '2026-03-18T12:00:00Z',
        },
        201
      )
    );
  });
  await page.route('**/api/v1/training/submissions/sub-new', (route) => {
    captured.patches.push(route.request().method());
    return route.fulfill(json({ id: 'sub-new', status: 'draft' }));
  });

  return captured;
}

async function gotoSubmit(page: Page, submissions: unknown[] = []): Promise<Captured> {
  await signIn(page);
  const captured = await mockSubmitScreen(page, submissions);
  await page.goto('/training/submit');
  await expect(page.getByRole('heading', { name: 'Submit External Training' })).toBeVisible();
  return captured;
}

/** The nav carries its own "Submit Training" button; scope to the form. */
const form = (page: Page) => page.locator('#main-content');

test.describe('Submit External Training', () => {
  test('derives the hours from a start time and a stepped duration', async ({ page }) => {
    await gotoSubmit(page);

    await expect(page.getByText('Runs 9:00 AM to 1:00 PM. Adjust in 15-minute steps.')).toBeVisible();
    await form(page).getByRole('button', { name: '2h' }).click();
    await expect(page.getByText('Runs 9:00 AM to 11:00 AM. Adjust in 15-minute steps.')).toBeVisible();
    await form(page).getByRole('button', { name: 'Increase length by 15 minutes' }).click();
    await expect(page.getByText('Runs 9:00 AM to 11:15 AM. Adjust in 15-minute steps.')).toBeVisible();
  });

  test('sends the certificate with the create and confirms with a receipt', async ({ page }) => {
    const captured = await gotoSubmit(page);

    await form(page)
      .getByLabel(/Course or class name/)
      .fill('EMT Recertification — NREMT');
    await form(page).getByLabel(/^Date/).fill('2026-03-18');
    await form(page)
      .getByLabel(/Start time/)
      .fill('18:30');
    await page.setInputFiles('#training-attachment', {
      name: 'certificate.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n'),
    });
    await form(page)
      .getByRole('button', { name: /Submit Training/ })
      .click();

    await expect(page.getByText('Training Submitted')).toBeVisible();
    await expect(page.getByText('certificate.pdf')).toBeVisible();

    // One multipart request, carrying the file and the reported start time —
    // an auto-approved submission is frozen before any follow-up upload could
    // reach it.
    expect(captured.posts).toHaveLength(1);
    const [post] = captured.posts;
    expect(post?.url).toContain('/with-attachment');
    expect(post?.contentType).toContain('multipart/form-data');
    expect(post?.body).toContain('"start_time":"18:30"');
    expect(post?.body).toContain('certificate.pdf');
  });

  test('keeps a draft on one row across repeated saves', async ({ page }) => {
    const captured = await gotoSubmit(page);

    await form(page)
      .getByLabel(/Course or class name/)
      .fill('Half-written entry');
    await form(page).getByLabel(/^Date/).fill('2026-03-18');
    await form(page).getByRole('button', { name: 'Save Draft' }).click();

    await expect(page.getByText(/Editing your submission/)).toBeVisible();
    await form(page).getByRole('button', { name: 'Save Draft' }).click();
    await expect.poll(() => captured.patches).toContain('PATCH');

    // The second save updates the draft rather than filing another one.
    expect(captured.posts).toHaveLength(1);
  });

  test('opens on the officer note when a submission comes back', async ({ page }) => {
    await gotoSubmit(page, [RETURNED_SUBMISSION]);

    await expect(page.getByText('A training officer asked for a change')).toBeVisible();
    await expect(page.getByText(/Certificate number does not match the roster/)).toBeVisible();

    await page.getByRole('button', { name: /Fix and Resubmit/ }).click();

    // The stored start time is restored, not re-guessed as 09:00.
    await expect(form(page).getByLabel(/Course or class name/)).toHaveValue('Hazmat Operations Refresher');
    await expect(form(page).getByLabel(/Start time/)).toHaveValue('13:00');
    await expect(form(page).getByLabel(/Certificate no\./)).toHaveValue('00-4471-B');
  });

  test('the phone action bar clears the bottom navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSubmit(page);

    const clearance = await page.evaluate(() => {
      const bar = document.querySelector('form .fixed.inset-x-0.bottom-0');
      const nav = document.querySelector('nav.fixed.bottom-0');
      if (!bar || !nav) return null;
      const barStyle = getComputedStyle(bar);
      const barBox = bar.getBoundingClientRect();
      const navBox = nav.getBoundingClientRect();
      return {
        // The bar's own padding is what lifts its content over the nav.
        contentBottom: barBox.bottom - parseFloat(barStyle.paddingBottom),
        navTop: navBox.top,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });

    expect(clearance).not.toBeNull();
    if (!clearance) return;
    expect(clearance.contentBottom).toBeLessThanOrEqual(clearance.navTop);
    expect(clearance.overflowX).toBe(false);
  });
});
