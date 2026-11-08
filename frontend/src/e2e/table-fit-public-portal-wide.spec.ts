import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PORTAL_CONFIG = {
  id: 'config-1',
  organization_id: 'org-1',
  enabled: true,
  allowed_origins: ['https://www.greater-northfield-oakville-fire.org'],
  default_rate_limit: 1000,
  cache_ttl_seconds: 300,
  settings: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const API_KEYS = [0, 1, 2, 3].map((i) => ({
  id: `key-${i}`,
  organization_id: 'org-1',
  key_prefix: `lbk_live_8f3a${i}`,
  name: 'Greater Northfield-Oakville Township Website Integration Key',
  rate_limit_override: i % 2 ? 50000 : null,
  effective_rate_limit: 50000,
  expires_at: '2027-10-14T15:30:00Z',
  last_used_at: '2026-11-04T09:12:00Z',
  is_active: true,
  created_by: 'Alexandra Ayala-Montgomery',
  created_at: '2026-10-14T15:30:00Z',
  is_expired: false,
}));

const ACCESS_LOGS = [0, 1, 2, 3].map((i) => ({
  id: `log-${i}`,
  organization_id: 'org-1',
  api_key_id: 'key-1',
  ip_address: `2001:0db8:85a3:0000:0000:8a2e:0370:733${i}`,
  endpoint: `/api/public/v1/organization/events/upcoming?include_location=true&limit=50&page=${i}`,
  method: 'DELETE',
  status_code: i === 2 ? 429 : 200,
  response_time_ms: 123456,
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  referer: null,
  timestamp: '2026-10-14T15:30:00Z',
  flagged_suspicious: i % 2 === 1,
  flag_reason: 'Burst of requests exceeding the configured rate limit',
}));

async function openPortalTab(page: Page, tab: string): Promise<void> {
  await signIn(page, { permissions: [...TEST_USER.permissions, 'settings.manage'] });
  await page.route('**/api/v1/public-portal/config**', (route) => void route.fulfill(json(PORTAL_CONFIG)));
  await page.route('**/api/v1/public-portal/api-keys**', (route) => void route.fulfill(json(API_KEYS)));
  await page.route('**/api/v1/public-portal/access-logs**', (route) => void route.fulfill(json(ACCESS_LOGS)));
  await page.goto('/admin/public-portal');
  await page.getByRole('button', { name: tab, exact: true }).click();
}

// Access logs: a long-form timestamp, method, an unbroken endpoint URL, status,
// a full IPv6 address, response time, flag and a details toggle. Wider than
// any desktop before its URL and address could break.
test.describe('Public portal access logs table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/admin/public-portal — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openPortalTab(page, 'Access Logs');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Response Time', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Access logs table');
    });
  }
});

// API keys: a long key name, key prefix, status, rate limit, two long-form
// dates and a revoke action. Above sm it replaces the mobile card list.
test.describe('Public portal API keys table fits its card', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/admin/public-portal — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openPortalTab(page, 'API Keys');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Key Prefix', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'API keys table');
    });
  }
});
