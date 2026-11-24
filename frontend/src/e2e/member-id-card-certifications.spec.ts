import { expect, test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';

/**
 * The digital member ID card lists the member's certifications with their
 * expiry dates and says the date the card is valid through: the soonest
 * current expiry. Seen here as the member opening their own card at phone
 * width, where the card is narrowest, so the list must fit beside the photo,
 * barcode and QR code without pushing anything off the card.
 */

test.use({ viewport: { width: 390, height: 844 } });

const CERT = {
  requirement_type: 'certification',
  frequency: 'biannual',
  required_hours: 1,
  original_required_hours: 1,
  due_date: null,
  days_until_due: null,
};

const MY_TRAINING = {
  visibility: { show_requirement_details: true, show_certification_status: true },
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
      completed_hours: 1,
      progress_percentage: 100,
      is_met: true,
      expiry_date: '2026-12-01',
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
  training_records: [],
};

test('lists certifications with their dates and the date the card is valid through', async ({ page }) => {
  await signIn(page, { memberRecord: true });
  await page.route(
    '**/api/v1/organization/modules',
    (route) => void route.fulfill(json({ enabled_modules: ['training'], module_settings: {} }))
  );
  await page.route('**/api/v1/member-badges/*', (route) =>
    route.fulfill(json({ user_id: TEST_USER.id, badge_code: 'MB-ABCDEFGHJK' }))
  );
  await page.route('**/api/v1/training/module-config/my-training', (route) => route.fulfill(json(MY_TRAINING)));
  await page.goto(`/members/${TEST_USER.id}/id-card`);

  const block = page.getByTestId('card-certifications');
  await expect(block).toBeVisible();
  await expect(block.getByText('Card valid through')).toContainText('Card valid through Dec 1, 2026');
  const rows = block.getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('On file');
  await expect(rows.nth(0)).toContainText('Expires Mar 14, 2027');
  await expect(rows.nth(1)).toContainText('Expires Dec 1, 2026');
  await expect(rows.nth(2)).toContainText('Not recorded');

  // The block sits inside the card, the long name wrapping rather than
  // pushing its date past the edge.
  const card = await page.locator('#member-id-card').boundingBox();
  const date = await rows.nth(0).getByText('Expires Mar 14, 2027').boundingBox();
  expect(card).not.toBeNull();
  expect(date).not.toBeNull();
  expect((date?.x ?? 0) + (date?.width ?? 0)).toBeLessThanOrEqual((card?.x ?? 0) + (card?.width ?? 0));
  // The scannable codes are still on the card.
  await expect(page.getByTestId('barcode')).toBeVisible();
  // qrcode.react renders its title as an SVG <title> child, not an attribute.
  await expect(
    page.locator('svg').filter({ has: page.locator('title', { hasText: 'Member identification QR code' }) })
  ).toBeVisible();
});
