import { test, expect, type Page } from '@playwright/test';

/**
 * Inventory Impact Planner E2E
 *
 * Drives the planner end-to-end with the backend fully mocked via route
 * interception (mirroring dashboard.spec): authenticate, load filter
 * options, run an analysis, and verify the summary, size breakdown, and
 * impacted-member list render.
 */

const OPTIONS = {
  statuses: [
    { value: 'active', label: 'Active' },
    { value: 'retired', label: 'Retired' },
  ],
  membership_types: [{ value: 'active', label: 'Active' }],
  ranks: [{ value: 'firefighter', label: 'Firefighter' }],
  stations: ['Station 1', 'Station 2'],
  positions: [{ id: 'p1', name: 'Quartermaster' }],
  categories: [{ id: 'cat-jacket', name: 'Jackets', item_type: 'uniform' }],
  size_fields: [
    { value: 'shirt', label: 'Shirt' },
    { value: 'jacket', label: 'Jacket' },
  ],
};

const ANALYSIS = {
  total_members: 2,
  members_with_related_item: 0,
  members_needing_item: 2,
  members_needing_replacement: 0,
  members_missing_sizes: 0,
  members_over_allowance: 0,
  replacement_aware: false,
  allowance_aware: false,
  size_field: 'jacket',
  size_breakdown: [
    { size: 'L', total: 1, needing: 1 },
    { size: 'M', total: 1, needing: 1 },
  ],
  stock_checked: false,
  cost_estimated: false,
  total_to_purchase: null,
  estimated_total_cost: null,
  members: [
    {
      user_id: 'u1', full_name: 'Amy Adams', membership_number: '001',
      rank: 'firefighter', station: 'Station 1', status: 'active',
      needed_size: 'M', has_size_on_file: true, has_related_item: false,
      needs_replacement: false, over_allowance: false, related_item_names: [],
      email: 'amy@x.org', phone: '555-1',
    },
    {
      user_id: 'u2', full_name: 'Bob Baker', membership_number: '002',
      rank: 'firefighter', station: 'Station 2', status: 'active',
      needed_size: 'L', has_size_on_file: true, has_related_item: false,
      needs_replacement: false, over_allowance: false, related_item_names: [],
      email: 'bob@x.org', phone: '555-2',
    },
  ],
};

function jsonRoute(body: unknown) {
  return (route: import('@playwright/test').Route) =>
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
}

async function setupPlanner(page: Page) {
  await page.goto('/login');
  await page.evaluate(() => localStorage.setItem('has_session', '1'));

  await page.route('**/api/v1/auth/me', jsonRoute({
    id: 'qm-user', username: 'qm', email: 'qm@example.com',
    first_name: 'Quinn', last_name: 'Master', is_active: true,
    permissions: ['*'], roles: ['admin'], positions: [],
  }));
  await page.route('**/api/v1/auth/branding', jsonRoute({ name: 'Test FD', logo: null }));
  await page.route('**/api/v1/auth/oauth-config', jsonRoute({ googleEnabled: false, microsoftEnabled: false }));
  await page.route('**/api/v1/organization/enabled-modules', jsonRoute({ enabled_modules: ['inventory'] }));
  await page.route('**/api/v1/notifications/**', jsonRoute({ logs: [], total: 0, unread_count: 0 }));

  // Planner endpoints
  await page.route('**/api/v1/inventory/impact-planner/options', jsonRoute(OPTIONS));
  await page.route('**/api/v1/inventory/impact-planner/plans', jsonRoute([]));
  // Analyze is POSTed to the exact path; register last so it takes priority.
  await page.route('**/api/v1/inventory/impact-planner', jsonRoute(ANALYSIS));
}

test.describe('Inventory Impact Planner', () => {
  test('runs an analysis and shows the impacted members', async ({ page }) => {
    await setupPlanner(page);
    await page.goto('/inventory/admin/impact-planner');

    // Header + filters load
    await expect(page.getByRole('heading', { name: 'Impact Planner' })).toBeVisible();
    await expect(page.getByText('Who fits the category?')).toBeVisible();

    // Run the analysis
    await page.getByRole('button', { name: /Analyze Impact/i }).click();

    // Summary + members render
    await expect(page.getByText('Members matched')).toBeVisible();
    await expect(page.getByText('Amy Adams')).toBeVisible();
    await expect(page.getByText('Bob Baker')).toBeVisible();
    await expect(page.getByText('Sizes to purchase')).toBeVisible();
  });
});
