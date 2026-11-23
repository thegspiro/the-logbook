import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * The compliance matrix reads a certification by state and expiry date, the
 * same words as My Training's card: "On file (Expires ...)", "Expired (...)"
 * or "Not recorded" with no date. Checked at phone width, where a row stacks,
 * and at a laptop width, where the date sits in its own column.
 */

const CERT = { requirement_id: 'req-cpr', requirement_name: 'CPR/BLS Certification' };

const member = (userId: string, name: string, standing: string, cpr: Record<string, unknown>) => ({
  user_id: userId,
  member_name: name,
  completion_pct: standing === 'compliant' ? 100 : 0,
  standing,
  requirements_met: standing === 'compliant' ? 1 : 0,
  requirements_total: 1,
  requirements: [{ ...CERT, as_of: '2026-11-20', ...cpr }],
});

const openMatrix = async (page: Page) => {
  await signIn(page, { permissions: ['training.manage'] });
  await page.route('**/api/v1/training/compliance-matrix', (route) =>
    route.fulfill(
      json({
        generated_at: '2026-11-20T12:45:00Z',
        as_of: '2026-11-20',
        requirements: [
          { id: 'req-cpr', name: 'CPR/BLS Certification', requirement_type: 'certification', frequency: 'biannual' },
        ],
        members: [
          // Worst first, so the queue opens on the missing certificate.
          member('u1', 'Avery, Jordan', 'non_compliant', {
            status: 'not_started',
            window_start: '2024-12-01',
            window_end: '2026-11-20',
          }),
          member('u2', 'Brooks, Alex', 'non_compliant', { status: 'expired', expiry_date: '2026-03-14' }),
          member('u3', 'Carver, Lee', 'compliant', { status: 'completed', expiry_date: '2027-03-14' }),
        ],
      })
    )
  );
  await page.goto('/training/admin?page=dashboard&tab=compliance');
};

const detail = (page: Page) => page.locator('.rounded-lg.border').filter({ hasText: 'CPR/BLS Certification' }).last();

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'laptop', width: 1280, height: 900 },
]) {
  test.describe(`at ${viewport.name} width`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('reads each certificate by state and expiry date', async ({ page }) => {
      await openMatrix(page);

      // Nothing on file: no window date beside it.
      await page.getByRole('button', { name: /Avery, Jordan/ }).click();
      await expect(detail(page).getByText('Not recorded')).toBeVisible();
      await expect(detail(page).getByText(/Window/)).toHaveCount(0);

      await page.getByRole('button', { name: /Brooks, Alex/ }).click();
      await expect(detail(page).getByText('Expired', { exact: true })).toBeVisible();
      await expect(detail(page).getByText('(Mar 14, 2026)')).toBeVisible();

      await page.getByRole('button', { name: /Carver, Lee/ }).click();
      await expect(detail(page).getByText('On file')).toBeVisible();
      await expect(detail(page).getByText('(Expires Mar 14, 2027)')).toBeVisible();
    });
  });
}
