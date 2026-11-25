import { expect, test } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * Printing CR80 ID cards with the member's certifications: the option is off
 * for a department that never chose it, an officer switches it on, and the
 * PDF request carries it so the server prints "Valid through" and the list.
 * Checked at phone width, where the layout controls stack.
 */

test.use({ viewport: { width: 390, height: 844 } });

test('switching certifications on sends them with the print request', async ({ page }) => {
  await signIn(page, { permissions: ['members.manage_id_cards'] });
  await page.route('**/api/v1/labels/preview', (route) =>
    route.fulfill(
      json({
        items: [
          { name: 'Laura Adams', barcode_value: 'MB-1', subtitle: null },
          { name: 'Ben Anderson', barcode_value: 'MB-2', subtitle: null },
        ],
      })
    )
  );
  await page.route('**/api/v1/member-id-cards/layout', (route) =>
    route.fulfill(json({ orientation: 'landscape', sides: 'both', symbology: 'code128', certifications: false }))
  );
  await page.route('**/api/v1/member-badges/settings', (route) => route.fulfill(json({ accept_legacy: false })));
  const printed: unknown[] = [];
  await page.route('**/api/v1/member-id-cards/pdf', async (route) => {
    printed.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' });
  });
  await page.goto('/members/print-id-cards?ids=u1,u2');

  const option = page.getByRole('checkbox', { name: /Certifications and valid-through date/ });
  await expect(page.getByText('Laura Adams')).toBeVisible();
  await expect(option).not.toBeChecked();
  await expect(page.getByText(/each certification with its date on the back/)).toBeVisible();

  await option.check();
  await page.getByRole('button', { name: /Download 2 cards/ }).click();

  await expect.poll(() => printed.length).toBe(1);
  expect(printed[0]).toEqual({
    user_ids: ['u1', 'u2'],
    orientation: 'landscape',
    sides: 'both',
    symbology: 'code128',
    certifications: true,
  });
  // Not yet the department's: the save button offers to make it so.
  await expect(page.getByRole('button', { name: /Save as department layout/ })).toBeVisible();
});
