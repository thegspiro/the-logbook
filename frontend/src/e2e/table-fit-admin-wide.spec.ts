import { test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS, expectTableFitsItsCard } from './tableFit';

const PERMISSIONS = [...TEST_USER.permissions, 'settings.manage', 'audit.view'];

const PEOPLE = [
  'Alexandra Ayala-Montgomery',
  'Christopher Vanderbilt-Okonkwo',
  'Maximiliano Fitzgerald-Hernandez',
  'Bartholomew Kowalczyk-Richardson',
];

const ERROR_LOGS = PEOPLE.map((name, i) => ({
  id: `9f3c2a1${i}-7b4e-4d2a-9c1f-0a8e6b5d4c3${i}`,
  error_type: i % 2 ? 'BACKEND_DATABASE_ERROR' : 'NETWORK_ERROR',
  error_message:
    'sqlalchemy.exc.OperationalError: (2013, Lost connection to MySQL server during query while fetching inventory items',
  user_message: 'We could not load the inventory items for this station. Check your connection and try again.',
  troubleshooting_steps: ['Reload the page'],
  context: {
    page: '/inventory/admin/items?category=respiratory-protection-equipment&station=headquarters',
    action: 'Loading the inventory item list for Station 14 Northfield Heights',
    occurrences: 37,
    source: i % 2 ? 'backend' : 'client',
  },
  user_id: `member-${i}`,
  user_name: name,
  user_username: name.toLowerCase().replace(' ', '.'),
  created_at: `2026-11-0${i + 2}T14:3${i}:00Z`,
}));

const AUDIT_EVENT_TYPES = [
  'user_permission_role_assignment_changed',
  'inventory_item_bulk_export_downloaded',
  'auth_login_failed_mfa_challenge',
  'organization_settings_module_enabled',
];

const AUDIT_CATEGORIES = ['user_management', 'data_export', 'authentication', 'configuration'];

const AUDIT_SEVERITIES = ['info', 'warning', 'critical', 'info'];

const AUDIT_LOGS = PEOPLE.map((name, i) => ({
  id: 1000 + i,
  timestamp: `2026-11-0${i + 2}T14:3${i}:00Z`,
  event_type: AUDIT_EVENT_TYPES[i] ?? 'other',
  event_category: AUDIT_CATEGORIES[i] ?? 'other',
  severity: AUDIT_SEVERITIES[i] ?? 'info',
  user_id: `member-${i}`,
  username: name.toLowerCase().replace(' ', '.'),
  ip_address: `2001:0db8:85a3:0000:0000:8a2e:0370:733${i}`,
  event_data: { detail: 'Role "Station Officer" added by the department administrator' },
}));

// The error monitor sets a long-form timestamp, error type, the member-facing
// and technical messages and the page and action beside each other; it was
// wider than the widest desktop, hiding the View details button.
test.describe('Error monitoring — errors table', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/admin/errors — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route(
        (url) => url.pathname === '/api/v1/errors',
        (route) => {
          void route.fulfill(json({ errors: ERROR_LOGS, total: ERROR_LOGS.length }));
        }
      );
      await page.route('**/api/v1/errors/stats**', (route) => {
        void route.fulfill(
          json({ total: 4, by_type: { NETWORK_ERROR: 2, BACKEND_DATABASE_ERROR: 2 }, recent_errors: ERROR_LOGS })
        );
      });
      await page.route('**/api/v1/errors/codes**', (route) => {
        void route.fulfill(json({ codes: [] }));
      });
      await page.goto('/admin/errors');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Error Type', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Error monitoring table');
    });
  }
});

// The audit log sets a long-form timestamp, a machine event type, the category,
// the username and a full IPv6 address side by side; on a tablet or a laptop
// that was wider than the log card.
test.describe('Audit log — entries table', () => {
  for (const viewport of TABLE_FIT_VIEWPORTS) {
    test(`/admin/audit-log — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: PERMISSIONS });
      await page.route(
        (url) => url.pathname === '/api/v1/audit-logs',
        (route) => {
          void route.fulfill(json({ logs: AUDIT_LOGS, total: AUDIT_LOGS.length, skip: 0, limit: 50 }));
        }
      );
      await page.route('**/api/v1/audit-logs/stats**', (route) => {
        void route.fulfill(
          json({ total: 4, by_severity: { info: 2, warning: 1, critical: 1 }, by_category: { authentication: 1 } })
        );
      });
      await page.goto('/admin/audit-log');

      const table = page
        .getByRole('table')
        .filter({ has: page.getByRole('columnheader', { includeHidden: true, name: 'Severity', exact: true }) });
      await table.waitFor();
      await expectTableFitsItsCard(table, 'Audit log table');
    });
  }
});
