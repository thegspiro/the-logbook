import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * A certification requirement reads as a state with its date, not as a count:
 * "On file (Expires ...)", "Expired ..." or "Not recorded" instead of 1/1 or
 * 0/1. Checked at phone width, where the card's figure column sits beside a
 * long requirement name and has the least room.
 */

test.use({ viewport: { width: 390, height: 844 } });

const CPR = {
  id: 'req-cpr',
  name: 'CPR/BLS Certification',
  description: 'Maintain a current CPR/BLS provider certification (2-year certification cycle)',
  requirement_type: 'certification',
  frequency: 'biannual',
  training_type: 'certification',
  required_hours: 1,
  original_required_hours: 1,
  due_date: null,
  days_until_due: null,
};

const openMyTraining = async (page: Page, requirement: Record<string, unknown>) => {
  await signIn(page);
  // Registered after signIn's catch-all, so it answers this endpoint.
  await page.route('**/api/v1/training/module-config/my-training', (route) =>
    route.fulfill(
      json({
        visibility: { show_requirement_details: true },
        requirements_detail: [{ ...CPR, ...requirement }],
        training_records: [],
      })
    )
  );
  await page.goto('/training/my-training');
  return page.locator('.card').filter({ hasText: 'CPR/BLS Certification' }).last();
};

test('a current certificate reads as on file with its expiry', async ({ page }) => {
  const card = await openMyTraining(page, {
    completed_hours: 1,
    progress_percentage: 100,
    is_met: true,
    expiry_date: '2027-03-14',
  });
  await expect(card.getByText('On file', { exact: true })).toBeVisible();
  await expect(card.getByText('(Expires Mar 14, 2027)')).toBeVisible();
  await expect(card.getByText('1/1')).toHaveCount(0);

  // The figure column stays inside the card beside the long name.
  const cardBox = await card.boundingBox();
  const expiresBox = await card.getByText('(Expires Mar 14, 2027)').boundingBox();
  expect(cardBox).not.toBeNull();
  expect(expiresBox).not.toBeNull();
  expect((expiresBox?.x ?? 0) + (expiresBox?.width ?? 0)).toBeLessThanOrEqual(
    (cardBox?.x ?? 0) + (cardBox?.width ?? 0)
  );
});

test('a lapsed certificate says when it expired', async ({ page }) => {
  const card = await openMyTraining(page, {
    completed_hours: 0,
    progress_percentage: 0,
    is_met: false,
    cert_expired: true,
    blocks_activity: true,
    expiry_date: '2026-03-14',
  });
  await expect(card.getByText('Expired', { exact: true })).toBeVisible();
  await expect(card.getByText('(Mar 14, 2026)')).toBeVisible();
  await expect(card.getByText('0/1')).toHaveCount(0);
});

test('nothing on file reads as not recorded', async ({ page }) => {
  const card = await openMyTraining(page, {
    completed_hours: 0,
    progress_percentage: 0,
    is_met: false,
    cert_expired: true,
    blocks_activity: true,
    expiry_date: null,
  });
  await expect(card.getByText('Not recorded').first()).toBeVisible();
  await expect(card.getByText(/No certification on file/)).toBeVisible();
  await expect(card.getByText(/expired/i)).toHaveCount(0);
});
