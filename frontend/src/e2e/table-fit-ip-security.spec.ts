import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const BLOCKED_COUNTRIES = [
  ['KP', "Democratic People's Republic of Korea"],
  ['IR', 'Islamic Republic of Iran'],
  ['RU', 'Russian Federation'],
  ['BY', 'Republic of Belarus'],
].map(([countryCode, countryName], i) => ({
  id: `country-${i}`,
  countryCode,
  countryName,
  isBlocked: true,
  reason: 'Repeated credential-stuffing attempts against member accounts from this region in 2026',
  riskLevel: 'critical',
  createdBy: 'user-1',
  createdAt: '2026-10-14T15:30:00Z',
  updatedAt: '2026-10-14T15:30:00Z',
  blockedAttemptsCount: 123456,
  lastBlockedAt: '2026-11-01T09:12:00Z',
}));

// Blocked countries: country, code, risk badge, a truncated reason, a
// six-digit attempt count, the date added and an unblock action. Overflows its
// card on a tablet with the side navigation open.
test.describe('Blocked countries table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/ip-security — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'security.manage'] });
      await page.route(
        '**/api/v1/ip-security/blocked-countries**',
        (route) => void route.fulfill(json(BLOCKED_COUNTRIES))
      );
      await page.goto('/ip-security');
      await page.getByRole('button', { name: 'Blocked Countries', exact: true }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Risk Level', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Blocked countries table');
    });
  }
});
