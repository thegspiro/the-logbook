import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * An hours requirement leads with the member's average hours a month, on
 * both the member's My Training card and the compliance matrix, with the
 * total kept underneath. The server sends the average
 * (`training_compliance.monthly_pace`) and both screens print the same
 * figure. Checked at phone width, where the card's figure column is
 * narrowest and a second line could be pushed out of view.
 */

test.use({ viewport: { width: 390, height: 844 } });

const HOURS_REQUIREMENT = {
  id: 'req-hours',
  name: 'Annual Training Hours',
  requirement_type: 'hours',
  frequency: 'annual',
  training_type: null,
  required_hours: 72,
  original_required_hours: 72,
  completed_hours: 83.25,
  progress_percentage: 100,
  is_met: true,
  due_date: null,
  days_until_due: null,
  waived_months: 0,
  window_start: '2025-12-01',
  window_end: '2026-11-20',
  window_months: 12,
  monthly_average: 6.94,
  monthly_needed: 6,
  monthly_hours: [
    { month: '2025-12', hours: 8, waived: false },
    { month: '2026-01', hours: 6, waived: false },
    { month: '2026-02', hours: 7.25, waived: false },
    { month: '2026-03', hours: 6, waived: false },
    { month: '2026-04', hours: 9, waived: false },
    { month: '2026-05', hours: 5, waived: false },
    { month: '2026-06', hours: 7, waived: false },
    { month: '2026-07', hours: 6, waived: false },
    { month: '2026-08', hours: 8, waived: false },
    { month: '2026-09', hours: 7, waived: false },
    { month: '2026-10', hours: 8, waived: false },
    { month: '2026-11', hours: 6, waived: false },
  ],
};

const COURSES_REQUIREMENT = {
  id: 'req-ops',
  name: 'Annual Operations Training',
  requirement_type: 'courses',
  frequency: 'annual',
  required_hours: 6,
  original_required_hours: 6,
  completed_hours: 6,
  progress_percentage: 100,
  is_met: true,
  due_date: null,
  days_until_due: null,
};

const openMyTraining = async (page: Page) => {
  await signIn(page);
  // Registered after signIn's catch-all, so it answers this endpoint.
  await page.route('**/api/v1/training/module-config/my-training', (route) =>
    route.fulfill(
      json({
        visibility: { show_requirement_details: true, show_training_hours: true },
        requirements_detail: [COURSES_REQUIREMENT, HOURS_REQUIREMENT],
        training_records: [],
      })
    )
  );
  await page.goto('/training/my-training');
};

test('My Training leads an hours requirement with its monthly average', async ({ page }) => {
  await openMyTraining(page);
  const card = page.locator('.card').filter({ hasText: 'Annual Training Hours' }).last();
  await expect(card.getByText('6.9/6 hrs/mo avg')).toBeVisible();
  await expect(card.getByText('83.25/72 hrs total')).toBeVisible();
  await expect(card.getByText('Complete')).toBeVisible();

  // A courses requirement keeps its count: the average is for hours only.
  const courses = page.locator('.card').filter({ hasText: 'Annual Operations Training' }).last();
  await expect(courses.getByText('6/6 courses')).toBeVisible();
  await expect(courses.getByText(/hrs\/mo avg/)).toHaveCount(0);

  // The breakdown prints the server's average, so it agrees with the headline.
  await card.getByRole('button', { name: /show monthly hours/i }).click();
  await expect(card.getByText(/average 6\.9 hrs\/month · 6 hrs\/month needed/)).toBeVisible();

  // The headline and its total line sit inside the card at phone width.
  const cardBox = await card.boundingBox();
  const totalBox = await card.getByText('83.25/72 hrs total').boundingBox();
  expect(cardBox).not.toBeNull();
  expect(totalBox).not.toBeNull();
  expect((totalBox?.x ?? 0) + (totalBox?.width ?? 0)).toBeLessThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0));
});

test('the compliance matrix shows the same monthly average as My Training', async ({ page }) => {
  await signIn(page, { permissions: ['training.manage'] });
  await page.route('**/api/v1/training/compliance-matrix', (route) =>
    route.fulfill(
      json({
        generated_at: '2026-11-20T12:45:00Z',
        as_of: '2026-11-20',
        requirements: [
          {
            id: 'req-hours',
            name: 'Annual Training Hours',
            requirement_type: 'hours',
            frequency: 'annual',
            target: 72,
            target_unit: 'hours',
          },
          {
            id: 'req-ops',
            name: 'Annual Operations Training',
            requirement_type: 'courses',
            frequency: 'annual',
            target: 6,
            target_unit: 'courses',
          },
        ],
        members: [
          {
            user_id: 'u1',
            member_name: 'Boyle, Devon',
            completion_pct: 100,
            standing: 'compliant',
            requirements_met: 2,
            requirements_total: 2,
            requirements: [
              {
                requirement_id: 'req-hours',
                requirement_name: 'Annual Training Hours',
                status: 'completed',
                progress_current: 83.25,
                progress_required: 72,
                progress_unit: 'hours',
                base_required: 72,
                window_start: '2025-12-01',
                window_end: '2026-11-20',
                as_of: '2026-11-20',
                monthly_average: 6.94,
                monthly_needed: 6,
              },
              {
                requirement_id: 'req-ops',
                requirement_name: 'Annual Operations Training',
                status: 'completed',
                progress_current: 6,
                progress_required: 6,
                progress_unit: 'courses',
                window_start: '2026-11-01',
                window_end: '2027-01-31',
                as_of: '2026-11-20',
              },
            ],
          },
        ],
      })
    )
  );
  await page.goto('/training/admin?page=dashboard&tab=compliance');

  // The matrix prints totals to one decimal, as it always has.
  await expect(page.getByText('6.9/6 hrs/mo avg')).toBeVisible();
  await expect(page.getByText('83.3 of 72 hours total')).toBeVisible();
  await expect(page.getByText('6 of 6 courses')).toBeVisible();
});
