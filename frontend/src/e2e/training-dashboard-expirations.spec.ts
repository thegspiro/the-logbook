import { expect, test } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * The training administration dashboard's Upcoming Expirations card shows each
 * certificate's expiry date beside its countdown, and the cards beside it print
 * dates the way the rest of the app does rather than raw YYYY-MM-DD. Checked at
 * phone width, where a long member and course name shares its row with the date.
 */

test.use({ viewport: { width: 390, height: 844 } });

const SUMMARY = {
  widget_metadata: {},
  stats: {
    total_members: 3,
    tracked_members: 3,
    active_requirements: 2,
    active_courses: 2,
    training_sessions: 1,
    active_programs: 0,
    graded_members: 3,
    not_applicable_members: 0,
    compliant_members: 2,
    compliance_percentage: 67,
    expiring_count: 2,
    completions_last_30_days: 1,
    total_hours_this_year: 120,
    average_hours_per_member: 40,
  },
  expirations: [
    {
      id: 'e1',
      member_id: 'm1',
      member_name: 'Fitzgerald-Montgomery, Alexandra',
      course_name: 'CPR/BLS Provider Certification',
      expiration_date: '2026-12-19',
      days_left: 26,
    },
    {
      id: 'e2',
      member_id: 'm2',
      member_name: 'Brooks, Alex',
      course_name: 'EMT-B',
      expiration_date: '2027-02-01',
      days_left: 70,
    },
  ],
  recent_completions: [
    {
      id: 'c1',
      member_id: 'm2',
      member_name: 'Brooks, Alex',
      course_name: 'Ground Ladders',
      completion_date: '2026-11-20',
      hours_completed: 2,
    },
  ],
  requirements: [
    { id: 'r1', name: 'Annual Training Hours', due_date: '2026-12-31' },
    { id: 'r2', name: 'CPR/BLS Certification', due_date: null },
  ],
  members_needing_intervention: [],
  upcoming_session_capacity: [],
  pending_validation: { count: 0 },
  requirements_at_risk: [],
};

test('shows expiry dates beside their countdowns, and formats every date', async ({ page }) => {
  await signIn(page, { permissions: ['training.manage'] });
  await page.route('**/api/v1/training/dashboard-summary**', (route) => route.fulfill(json(SUMMARY)));
  await page.goto('/training/admin?page=dashboard&tab=overview');

  const expirations = page.locator('a.card').filter({ hasText: 'Upcoming Expirations' });
  await expect(expirations.getByText('Dec 19, 2026 · 26d')).toBeVisible();
  await expect(expirations.getByText('Feb 1, 2027 · 70d')).toBeVisible();

  // The date stays whole and inside the card beside a long name.
  const card = await expirations.boundingBox();
  const date = await expirations.getByText('Dec 19, 2026 · 26d').boundingBox();
  expect(card).not.toBeNull();
  expect(date).not.toBeNull();
  expect((date?.x ?? 0) + (date?.width ?? 0)).toBeLessThanOrEqual((card?.x ?? 0) + (card?.width ?? 0));
  expect(date?.height ?? 0).toBeLessThan(30);

  await expect(page.getByText('Nov 20, 2026')).toBeVisible();
  await expect(page.getByText('Dec 31, 2026')).toBeVisible();
  await expect(page.getByText('2026-11-20')).toHaveCount(0);
});
