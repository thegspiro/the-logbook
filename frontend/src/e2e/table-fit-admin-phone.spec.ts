import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'settings.manage'];

const ERROR_CODES = [
  {
    code: 'LB-SCHED-004',
    category: 'scheduling',
    title: 'Shift assignment conflicts with an existing assignment',
    description:
      'The member is already assigned to an overlapping shift at another station, or the requested position is already filled for that shift.',
    resolution: [
      'Open the member’s schedule and remove or swap the overlapping assignment before assigning them again.',
      'If every assignment fails at once, check whether SCHEDULING_TIMEZONE was changed — shifts are compared in the organization’s configured timezone.',
    ],
  },
  {
    code: 'LB-AUTH-002',
    category: 'auth',
    title: 'Session expired or invalid',
    description:
      'A session token was presented but could not be validated — it has expired, was revoked (e.g. by a password change or logout on another device), or is malformed.',
    resolution: [
      'Have the member sign in again.',
      'If every user is affected at once, check whether SECRET_KEY was rotated — that invalidates all outstanding sessions.',
    ],
  },
];

// The error code reference under the error monitor: a support code kept on
// one line, its meaning with a description, and the steps to resolve it.
test.describe('Error code reference table fits its card', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/admin/errors error codes — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route(
        (url) => url.pathname === '/api/v1/errors',
        (route) => void route.fulfill(json({ errors: [], total: 0 }))
      );
      await page.route(
        '**/api/v1/errors/stats**',
        (route) => void route.fulfill(json({ total: 0, by_type: {}, recent_errors: [] }))
      );
      await page.route('**/api/v1/errors/codes**', (route) => void route.fulfill(json({ codes: ERROR_CODES })));
      await page.goto('/admin/errors');
      await page.getByRole('button', { name: /Error Code Reference/ }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'How to resolve', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Error code reference table');
    });
  }
});
