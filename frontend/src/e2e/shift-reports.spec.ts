import { test, expect, type Page } from '@playwright/test';

import { json, signIn, TEST_USER } from './helpers';

/**
 * The Shift Reports tab, in a real browser.
 *
 * Two things here are invisible to the jsdom unit tests. The page shell
 * rewrites `?view=` for its calendar, which a mocked `useSearchParams` never
 * does, and which silently broke every deep link into this tab. And the report
 * card's layout: jsdom applies no CSS, so it cannot see three status pills
 * crushing a member's name to "Al…" on a phone.
 */

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const report = (over: Record<string, unknown>) => ({
  id: 'r1',
  organization_id: 'org',
  shift_date: daysAgo(2).slice(0, 10),
  trainee_id: 'crew-1',
  officer_id: TEST_USER.id,
  trainee_name: 'Alexandra Kimberly-Whitfield',
  officer_name: 'Alex Tester',
  shift_label: 'E-1 — Engine 1',
  hours_on_shift: 12,
  calls_responded: 3,
  performance_rating: 4,
  review_status: 'approved',
  trainee_acknowledged: false,
  created_at: daysAgo(2),
  updated_at: daysAgo(2),
  ...over,
});

const FILED = [
  report({ id: 'r1' }),
  report({ id: 'r2', trainee_name: 'Jordan Park', review_status: 'pending_review', created_at: daysAgo(4) }),
];

const mockReports = async (page: Page) => {
  await signIn(page, { permissions: TEST_USER.permissions });
  const fulfil = (glob: string, body: unknown) => page.route(glob, (route) => route.fulfill(json(body)));
  await fulfil('**/api/v1/training/module-config/config', { report_review_required: true, rating_scale_type: 'stars' });
  await fulfil('**/api/v1/training/shift-reports/my-reports**', []);
  await fulfil('**/api/v1/training/shift-reports/by-officer**', FILED);
  await fulfil('**/api/v1/training/shift-reports/officer-analytics**', null);
  await fulfil('**/api/v1/training/shift-reports/pending-review**', [FILED[1]]);
  await fulfil('**/api/v1/training/shift-reports/flagged**', []);
  await fulfil('**/api/v1/training/shift-reports/drafts**', []);
};

test.describe('Shift Reports — deep links', () => {
  test.use({ viewport: DESKTOP });

  // The training module's hand-off links to ?tab=shift-reports&view=create.
  // The calendar used to overwrite `view` with `week` before this lazily
  // loaded tab mounted, so the link opened the default list instead.
  test('opens the view named in the URL', async ({ page }) => {
    await mockReports(page);
    await page.goto('/scheduling?tab=shift-reports&view=pending-review');

    await expect(page.getByRole('button', { name: 'Review Queue' })).toHaveClass(/bg-violet-600/);
    await expect(page.getByText('Jordan Park', { exact: false })).toBeVisible();
    await expect(page).toHaveURL(/view=pending-review/);
  });

  test('keeps the chosen view in the URL', async ({ page }) => {
    await mockReports(page);
    await page.goto('/scheduling?tab=shift-reports');

    await page.getByRole('button', { name: 'Drafts' }).click();
    await expect(page).toHaveURL(/view=drafts/);
  });
});

test.describe('Shift Reports — phone layout', () => {
  test.use({ viewport: PHONE });

  test('the status pills sit below the name instead of crushing it', async ({ page }) => {
    await mockReports(page);
    await page.goto('/scheduling?tab=shift-reports&view=filed-by-me');

    const title = page.getByText(/Alexandra Kimberly-Whitfield —/);
    const pill = page.getByText('Not acknowledged yet');
    await expect(title).toBeVisible();
    await expect(pill).toBeVisible();

    const titleBox = await title.boundingBox();
    const pillBox = await pill.boundingBox();
    expect(titleBox && pillBox).toBeTruthy();
    if (!titleBox || !pillBox) return;
    // Below, not beside: the pill starts under the title's bottom edge.
    expect(pillBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    // And the title has most of the card's width to itself.
    expect(titleBox.width).toBeGreaterThan(PHONE.width * 0.5);
  });

  test('"New report" stays on screen instead of scrolling off the tab strip', async ({ page }) => {
    await mockReports(page);
    await page.goto('/scheduling?tab=shift-reports&view=filed-by-me');

    const newReport = page.getByRole('button', { name: 'New report' });
    await expect(newReport).toBeInViewport();
    await newReport.click();
    await expect(page.getByText('New Shift Completion Report')).toBeVisible();
  });
});
