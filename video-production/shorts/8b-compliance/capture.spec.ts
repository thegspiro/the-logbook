import { test, type Page } from '@playwright/test';

import { signIn } from '../../../frontend/src/e2e/helpers';
import { SCALE, SCREEN, centre, prepare, recordShots, settle, tap } from '../../lib/recorder';

/**
 * Short 8B — "Checking Your Training Compliance Status".
 *
 * The E2E fixture for /training/module-config/my-training carries hours only,
 * which renders an empty record. This serves a member with one certification
 * in each state the page colours: valid (green), expiring within 90 days
 * (yellow) and expired (red). Dates are relative to today, so "Expires in 30
 * days" reads the same whenever the short is rendered.
 */

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

const VISIBILITY = {
  show_training_history: true,
  show_training_hours: true,
  show_certification_status: true,
  show_pipeline_progress: false,
  show_requirement_details: false,
  show_shift_reports: false,
  show_shift_stats: false,
  show_officer_narrative: false,
  show_performance_rating: false,
  show_areas_of_strength: false,
  show_areas_for_improvement: false,
  show_skills_observed: false,
  show_submission_history: false,
  allow_member_report_export: false,
  report_review_required: false,
  report_review_role: '',
  rating_label: '',
  rating_scale_type: '',
};

const myTraining = () => ({
  visibility: VISIBILITY,
  hours_summary: {
    total_records: 14,
    total_hours: 86,
    completed_courses: 14,
    year_to_date_courses: 6,
    year_to_date_hours: 31,
    year: new Date().getFullYear(),
  },
  requirements_summary: { total_requirements: 5, met_requirements: 4, avg_compliance: 88 },
  certifications: [
    {
      id: 'cert-emt',
      course_name: 'EMT-Basic',
      certification_number: 'E-204118',
      expiration_date: inDays(420),
      is_expired: false,
      days_until_expiry: 420,
    },
    {
      id: 'cert-cpr',
      course_name: 'CPR / BLS Provider',
      expiration_date: inDays(30),
      is_expired: false,
      days_until_expiry: 30,
    },
    {
      id: 'cert-hazmat',
      course_name: 'Hazmat Operations',
      expiration_date: inDays(-12),
      is_expired: true,
      days_until_expiry: -12,
    },
    {
      id: 'cert-ff2',
      course_name: 'Firefighter II',
      certification_number: 'FF2-88213',
      expiration_date: inDays(900),
      is_expired: false,
      days_until_expiry: 900,
    },
  ],
});

// Registered after signIn's fixtures, so it answers first for this URL.
async function mockMyTraining(page: Page) {
  await page.route('**/api/v1/training/module-config/my-training**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(myTraining()) })
  );
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: 'America/Chicago' });

test('capture 8b-compliance', async ({ page }) => {
  await prepare(page);
  await signIn(page);
  await mockMyTraining(page);
  await page.goto('/dashboard');
  await settle(page);

  await recordShots(page, '8b-compliance', async (shot) => {
    await shot('hook', async () => {
      await page.waitForTimeout(600);
    });
    await shot('navigate', async () => {
      await tap(page, page.getByRole('button', { name: 'More: open full navigation menu' }));
      await page.waitForTimeout(500);
      await tap(page, page.getByRole('button', { name: 'Training', exact: true }).locator('visible=true').first());
      await page.waitForTimeout(400);
      await tap(
        page,
        page
          .getByRole('navigation', { name: 'Side navigation' })
          .getByRole('button', { name: 'My Training', exact: true })
      );
      await settle(page);
    });
    await shot('colors', async () => {
      const certs = page.getByRole('button', { name: /^Certifications/ });
      await tap(page, certs);
      await page.waitForTimeout(400);
      await centre(page, page.getByText('CPR / BLS Provider').locator('visible=true').last());
    });
    await shot('dates', async () => {
      await centre(page, page.getByRole('heading', { name: /Upcoming Expirations/ }));
    });
    await shot('submit', async () => {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(700);
      await tap(page, page.getByRole('main').getByRole('button', { name: 'Submit Training', exact: true }));
      await settle(page);
    });
    await shot('outro', async () => {
      await page.waitForTimeout(300);
    });
  });
});
