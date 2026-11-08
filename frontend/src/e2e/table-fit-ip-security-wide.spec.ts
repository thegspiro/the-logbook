import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'security.manage'];

const MEMBER_NAMES = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vanderbilt-Okonkwo',
  'Maximiliana Rodriguez-Vandenberg',
  'Bartholomew Okonkwo-Henderson',
];

const PENDING_EXCEPTIONS = MEMBER_NAMES.map((userName, i) => ({
  id: `exception-${i}`,
  ipAddress: `2001:0db8:85a3:0000:0000:8a2e:0370:733${i}`,
  exceptionType: 'temporary',
  reason: 'Working remotely from the county emergency operations centre during the regional wildfire deployment',
  description: 'Laptop on the emergency operations centre guest network',
  userId: `user-${i}`,
  organizationId: 'org-1',
  requestedDurationDays: 30,
  validUntil: '2026-11-28T15:30:00Z',
  approvalStatus: 'pending',
  requestedBy: `user-${i}`,
  requestedAt: '2026-10-14T15:30:00Z',
  countryCode: 'GB',
  countryName: 'United Kingdom of Great Britain and Northern Ireland',
  useCase: 'travel',
  userName,
}));

const BLOCKED_ATTEMPTS = {
  total: 4,
  items: [0, 1, 2, 3].map((i) => ({
    id: `attempt-${i}`,
    ipAddress: `2001:0db8:85a3:0000:0000:8a2e:0370:99${i}0`,
    countryCode: 'RU',
    countryName: 'Russian Federation',
    userId: null,
    blockReason: 'Request originated from a country on the organization block list',
    blockDetails: null,
    requestPath: `/api/v1/auth/login/oauth/microsoft/callback?state=abcdef${i}`,
    requestMethod: 'POST',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    blockedAt: '2026-10-14T15:30:00Z',
  })),
};

// Pending IP exceptions: member, a full IPv6 address, use case with its
// justification, status, duration, a long country name, request time and the
// approve/reject actions. Overflows its card on a tablet or laptop.
test.describe('IP exceptions table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/ip-security — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route(
        '**/api/v1/ip-security/exceptions/pending**',
        (route) => void route.fulfill(json(PENDING_EXCEPTIONS))
      );
      await page.goto('/ip-security');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Use Case', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'IP exceptions table');
    });
  }
});

// Blocked access attempts: a full IPv6 address, country, reason, an unbroken
// request path in monospace, method and time. Overflows on a tablet or laptop.
test.describe('Blocked attempts table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/ip-security — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route(
        '**/api/v1/ip-security/blocked-attempts**',
        (route) => void route.fulfill(json(BLOCKED_ATTEMPTS))
      );
      await page.goto('/ip-security');
      await page.getByRole('button', { name: 'Blocked Attempts', exact: true }).click();

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Blocked At', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Blocked attempts table');
    });
  }
});
