import { test, expect } from '@playwright/test';

import { TEST_USER, gotoDashboard, navItem, openNavigation, signIn, signOut } from './helpers';

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
      test(`should redirect unauthenticated users from ${path} to /login`, async ({ page }) => {
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
      // Level 1: the greeting is the page's own heading, and was an h2 until a
      // page with no h1 was found to start its outline three levels down.
      const greeting = page.getByRole('heading', { level: 1 }).first();
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
      await openNavigation(page);
      await navItem(page, 'Members').click();

      await expect(page).toHaveURL(/\/members/, { timeout: 10000 });
    });

    test('should navigate to the Events section', async ({ page }) => {
      await openNavigation(page);
      await navItem(page, 'Events').click();

      await expect(page).toHaveURL(/\/events/, { timeout: 10000 });
    });

    test('should navigate to the Inventory section via the Operations menu', async ({ page }) => {
      // Signs in again with a grant the shared beforeEach does not give: the
      // fixture user has NO permissions (`signIn` sets `permissions: []`, which
      // overrides TEST_USER's list), and the gear catalogue is manager-only, so
      // the row this test clicks does not render for a plain member. That is
      // the behaviour, not an obstacle to it — the assertion below is about
      // where the row leads, and someone has to be able to see it first.
      await gotoDashboard(page, { permissions: ['inventory.manage'] });

      // Inventory is a child of the collapsible "Operations" group. The
      // label is not "Inventory": that word covers gear and medical supplies
      // both, which are separate pages under separate permissions, so the nav
      // names the one this route actually opens.
      await openNavigation(page);
      await navItem(page, 'Operations').click();
      await navItem(page, 'Inventory').click();

      await expect(page).toHaveURL(/\/inventory/, { timeout: 10000 });
    });

    test('should navigate to the Training section', async ({ page }) => {
      // "Training" is a collapsible group (its own path is "#"), so clicking it
      // expands the group rather than navigating.
      await openNavigation(page);
      await navItem(page, 'Training').click();
      await navItem(page, 'My Training').click();

      await expect(page).toHaveURL(/\/training/, { timeout: 10000 });
    });
  });

  test.describe('Unknown Routes (404 handling)', () => {
    test('should send a signed-out visitor to sign in rather than show the app', async ({ page }) => {
      // The catch-all sits inside the signed-in layout, so an unknown address is
      // gated like any other page and only shown the 404 after signing in.
      await page.goto('/this-route-does-not-exist-12345');

      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });

    test('should say the page was not found, at the same address, for a signed-in user', async ({ page }) => {
      await signIn(page);

      await page.goto('/nonexistent-page-xyz');

      await expect(page).toHaveURL(/nonexistent-page-xyz/);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible({
        timeout: 10000,
      });
    });

    test('should offer a way back to the dashboard', async ({ page }) => {
      await signIn(page);
      await page.goto('/nonexistent-page-xyz');

      await page.getByRole('button', { name: 'Go to the dashboard' }).click();

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });
  });
});
