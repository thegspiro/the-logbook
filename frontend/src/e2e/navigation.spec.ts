import { test, expect } from '@playwright/test';

import { TEST_USER, gotoDashboard, navItem, signIn, signOut } from './helpers';

/**
 * Navigation E2E Tests
 *
 * Covers route protection for unauthenticated visitors, the navigation
 * landmark's contents, moving between sections, and unknown-route handling.
 *
 * Note on locators: the side navigation renders its destinations as `<button>`
 * elements that call `navigate()`, not as anchors. Selectors keyed to
 * `a[href="..."]` will never match.
 */

test.describe('Navigation', () => {
  test.describe('Unauthenticated Access', () => {
    for (const path of ['/dashboard', '/events', '/members']) {
      test(`should redirect unauthenticated users from ${path} to /login`, async ({
        page,
      }) => {
        await signOut(page);
        await page.goto(path);

        await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
      });
    }

    test('should allow access to the login page without authentication', async ({ page }) => {
      await page.goto('/login');

      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('h1')).toContainText('Sign in');
    });
  });

  test.describe('Authenticated Dashboard Access', () => {
    test('should load the dashboard after authentication', async ({ page }) => {
      await gotoDashboard(page);

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // The dashboard greets the member by first name once /auth/me resolves.
      const greeting = page.getByRole('heading', { level: 2 }).first();
      await expect(greeting).toBeVisible({ timeout: 10000 });
      await expect(greeting).toContainText(TEST_USER.first_name);
    });
  });

  test.describe('Side Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the main navigation destinations', async ({ page }) => {
      for (const label of ['Dashboard', 'Members', 'Events', 'Documents', 'Training']) {
        await expect(navItem(page, label)).toBeVisible({ timeout: 10000 });
      }
    });
  });

  test.describe('Section Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should navigate to the Members section', async ({ page }) => {
      await navItem(page, 'Members').click();

      await expect(page).toHaveURL(/\/members/, { timeout: 10000 });
    });

    test('should navigate to the Events section', async ({ page }) => {
      await navItem(page, 'Events').click();

      await expect(page).toHaveURL(/\/events/, { timeout: 10000 });
    });

    test('should navigate to the Inventory section via the Operations menu', async ({
      page,
    }) => {
      // Inventory is a child of the collapsible "Operations" group.
      await navItem(page, 'Operations').click();
      await navItem(page, 'Inventory').click();

      await expect(page).toHaveURL(/\/inventory/, { timeout: 10000 });
    });

    test('should navigate to the Training section', async ({ page }) => {
      // "Training" is a collapsible group (its own path is "#"), so clicking it
      // expands the group rather than navigating.
      await navItem(page, 'Training').click();
      await navItem(page, 'My Training').click();

      await expect(page).toHaveURL(/\/training/, { timeout: 10000 });
    });
  });

  test.describe('Unknown Routes (404 handling)', () => {
    test('should redirect unknown routes away from the unknown path', async ({ page }) => {
      // App.tsx ends with <Route path="*" element={<Navigate to="/" replace />} />,
      // and "/" then resolves by auth state.
      await page.goto('/this-route-does-not-exist-12345');

      await expect(page).not.toHaveURL(/this-route-does-not-exist-12345/, {
        timeout: 10000,
      });
    });

    test('should redirect unknown routes for authenticated users', async ({ page }) => {
      await signIn(page);

      await page.goto('/nonexistent-page-xyz');

      await expect(page).not.toHaveURL(/nonexistent-page-xyz/, { timeout: 10000 });
    });
  });
});
