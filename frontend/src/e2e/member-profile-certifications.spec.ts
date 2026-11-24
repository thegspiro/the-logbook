import { expect, test } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * A member's profile lists every certification the member is graded on, each
 * with its state and expiry date, in the same words as My Training and the
 * compliance matrix. Seen here as a training officer opening another member's
 * profile: the list reads the officer's member endpoint, and the recent
 * records beneath it print their dates as "Mar 14, 2027".
 */

const CERT = {
  requirement_type: 'certification',
  frequency: 'biannual',
  required_hours: 1,
  original_required_hours: 1,
  due_date: null,
  days_until_due: null,
};

const REQUIREMENTS = {
  user_id: 'member-2',
  as_of: '2026-11-23',
  leave_month_rule: 'any_day',
  requirements_summary: { total_requirements: 3, met_requirements: 1, avg_compliance: 33 },
  requirements_detail: [
    {
      ...CERT,
      id: 'req-cpr',
      name: 'CPR/BLS Provider Certification',
      completed_hours: 1,
      progress_percentage: 100,
      is_met: true,
      expiry_date: '2027-03-14',
    },
    {
      ...CERT,
      id: 'req-emt',
      name: 'EMT-B',
      completed_hours: 0,
      progress_percentage: 0,
      is_met: false,
      cert_expired: true,
      expiry_date: '2026-03-14',
    },
    {
      ...CERT,
      id: 'req-hazmat',
      name: 'Hazmat Operations',
      completed_hours: 0,
      progress_percentage: 0,
      is_met: false,
      cert_expired: true,
      expiry_date: null,
    },
  ],
};

const RECORDS = [
  {
    id: 'rec-1',
    organization_id: 'org-1',
    user_id: 'member-2',
    course_name: 'CPR/BLS Provider',
    training_type: 'certification',
    completion_date: '2025-03-14',
    expiration_date: '2027-03-14',
    hours_completed: 4,
    status: 'completed',
    created_at: '2025-03-14T00:00:00Z',
    updated_at: '2025-03-14T00:00:00Z',
  },
];

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 900 },
]) {
  test.describe(`at ${viewport.name} width`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('lists each certification with its state and expiry date', async ({ page }) => {
      await signIn(page, { memberRecord: true, permissions: ['members.view', 'training.manage'] });
      await page.route(
        '**/api/v1/organization/modules',
        (route) => void route.fulfill(json({ enabled_modules: ['training'], module_settings: {} }))
      );
      await page.route(
        '**/api/v1/training/module-config/members/member-2/requirements',
        (route) => void route.fulfill(json(REQUIREMENTS))
      );
      await page.route('**/api/v1/training/records**', (route) => void route.fulfill(json(RECORDS)));
      await page.goto('/members/member-2');

      const list = page.getByRole('list').filter({ hasText: 'CPR/BLS Provider Certification' });
      const rows = list.getByRole('listitem');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(0)).toContainText('On file');
      await expect(rows.nth(0)).toContainText('(Expires Mar 14, 2027)');
      await expect(rows.nth(1)).toContainText('Expired');
      await expect(rows.nth(1)).toContainText('(Mar 14, 2026)');
      await expect(rows.nth(2)).toContainText('Not recorded');

      // The state and its date stay inside the row beside a long name.
      const row = await rows.nth(0).boundingBox();
      const date = await rows.nth(0).getByText('(Expires Mar 14, 2027)').boundingBox();
      expect(row).not.toBeNull();
      expect(date).not.toBeNull();
      expect((date?.x ?? 0) + (date?.width ?? 0)).toBeLessThanOrEqual((row?.x ?? 0) + (row?.width ?? 0));

      await expect(page.getByText('Completed: Mar 14, 2025')).toBeVisible();
      await expect(page.getByText('Expires: Mar 14, 2027')).toBeVisible();
    });
  });
}
