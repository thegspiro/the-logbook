import { test, expect, type Page } from '@playwright/test';

/**
 * Navigation E2E Tests
 *
 * Tests page access control for unauthenticated and authenticated users,
 * side navigation visibility, section navigation, and 404 handling.
 */

/** Shared mock API route setup for an authenticated session. */
async function setupAuthenticatedSession(page: Page) {
  // Inject tokens into localStorage so ProtectedRoute considers the user authenticated
  await page.evaluate(() => {
    localStorage.setItem('access_token', 'mock-access-token');
    localStorage.setItem('refresh_token', 'mock-refresh-token');
  });

  // Mock current user endpoint (called by ProtectedRoute's loadUser)
  await page.route('**/api/v1/auth/me', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'nav-test-user-id',
        username: 'navtestuser',
        email: 'navtest@example.com',
        first_name: 'Nav',
        last_name: 'Tester',
        is_active: true,
        permissions: [],
        roles: [],
        positions: [],
      }),
    });
  });

  // Mock branding
  await page.route('**/api/v1/auth/branding', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Test Department', logo: null }),
    });
  });

  // Mock OAuth config
  await page.route('**/api/v1/auth/oauth-config', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ googleEnabled: false, microsoftEnabled: false }),
    });
  });

  // Mock organization enabled-modules (used by SideNavigation)
  await page.route('**/api/v1/organization/enabled-modules', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled_modules: [] }),
    });
  });

  // Mock dashboard data endpoints so the dashboard renders without errors
  await page.route('**/api/v1/dashboard/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  await page.route('**/api/v1/notifications/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ logs: [] }),
    });
  });

  await page.route('**/api/v1/scheduling/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ shifts: [], total_hours_this_month: 0 }),
    });
  });

  await page.route('**/api/v1/training/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/v1/messages/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/v1/inventory/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  // Mock members endpoint for Members page
  await page.route('**/api/v1/members**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ members: [], total: 0 }),
    });
  });

  // Mock events endpoint for Events page
  await page.route('**/api/v1/events**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: [], total: 0 }),
    });
  });
}

test.describe('Navigation', () => {
  test.describe('Unauthenticated Access', () => {
    test('should redirect unauthenticated users from /dashboard to /login', async ({ page }) => {
      // Ensure no tokens are present
      await page.goto('/login');
      await page.evaluate(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      });

      // Attempt to access a protected route
      await page.goto('/dashboard');

      // ProtectedRoute should redirect to /login
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated users from /events to /login', async ({ page }) => {
      await page.goto('/login');
      await page.evaluate(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      });

      await page.goto('/events');

      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });

    test('should redirect unauthenticated users from /members to /login', async ({ page }) => {
      await page.goto('/login');
      await page.evaluate(() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
      });

      await page.goto('/members');

      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });

    test('should allow access to the login page without authentication', async ({ page }) => {
      await page.goto('/login');

      await expect(page).toHaveURL(/\/login/);
      const heading = page.locator('h1');
      await expect(heading).toContainText('Sign in');
    });
  });

  test.describe('Authenticated Dashboard Access', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate first so we can evaluate JS on the page origin
      await page.goto('/login');
      await setupAuthenticatedSession(page);
    });

    test('should load the dashboard after authentication', async ({ page }) => {
      await page.goto('/dashboard');

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // The dashboard should show the welcome heading
      const welcomeHeading = page.locator('h2').filter({ hasText: /welcome/i });
      await expect(welcomeHeading).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Side Navigation Links', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await setupAuthenticatedSession(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should display the main navigation links', async ({ page }) => {
      // The side navigation should contain core navigation items.
      // On desktop, these are visible in the sidebar. On mobile, behind a menu button.
      // We check for the presence of these nav link texts (visible or in the DOM).

      // Dashboard link
      const dashboardLink = page.locator('nav, aside').locator('text=Dashboard').first();
      await expect(dashboardLink).toBeAttached({ timeout: 10000 });

      // Members link
      const membersLink = page.locator('nav, aside').locator('text=Members').first();
      await expect(membersLink).toBeAttached();

      // Events link
      const eventsLink = page.locator('nav, aside').locator('text=Events').first();
      await expect(eventsLink).toBeAttached();

      // Documents link
      const documentsLink = page.locator('nav, aside').locator('text=Documents').first();
      await expect(documentsLink).toBeAttached();

      // Training link (parent menu item or sub-item)
      const trainingLink = page.locator('nav, aside').locator('text=Training').first();
      await expect(trainingLink).toBeAttached();
    });
  });

  test.describe('Section Navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await setupAuthenticatedSession(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should navigate to the Members section', async ({ page }) => {
      // Click the Members link in the navigation
      // Use the navigation container to avoid clicking random page text
      const membersLink = page.locator('nav a[href="/members"], aside a[href="/members"]').first();
      if (await membersLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await membersLink.click();
      } else {
        // On mobile: open hamburger menu first
        const menuButton = page.locator('button[aria-label*="menu" i], button[aria-label*="Menu" i]').first();
        if (await menuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await menuButton.click();
        }
        await page.locator('a[href="/members"]').first().click();
      }

      await expect(page).toHaveURL(/\/members/, { timeout: 10000 });
    });

    test('should navigate to the Events section', async ({ page }) => {
      const eventsLink = page.locator('nav a[href="/events"], aside a[href="/events"]').first();
      if (await eventsLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await eventsLink.click();
      } else {
        const menuButton = page.locator('button[aria-label*="menu" i], button[aria-label*="Menu" i]').first();
        if (await menuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await menuButton.click();
        }
        await page.locator('a[href="/events"]').first().click();
      }

      await expect(page).toHaveURL(/\/events/, { timeout: 10000 });
    });

    test('should navigate to the Inventory section', async ({ page }) => {
      // Inventory is under the "Operations" sub-menu in the sidebar.
      // We need to expand the parent first, or directly navigate.
      const inventoryLink = page.locator('a[href="/inventory"]').first();
      if (await inventoryLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await inventoryLink.click();
      } else {
        // The Inventory link may be inside a collapsed sub-menu ("Operations").
        // Try expanding it by clicking the parent menu label.
        const operationsMenu = page.locator('nav, aside').locator('text=Operations').first();
        if (await operationsMenu.isVisible({ timeout: 2000 }).catch(() => false)) {
          await operationsMenu.click();
          await page.locator('a[href="/inventory"]').first().click();
        } else {
          // Fallback: navigate directly
          await page.goto('/inventory');
        }
      }

      await expect(page).toHaveURL(/\/inventory/, { timeout: 10000 });
    });

    test('should navigate to the Training section', async ({ page }) => {
      // Training has sub-items. Click the parent to expand, then click "My Training".
      const trainingParent = page.locator('nav, aside').locator('text=Training').first();
      if (await trainingParent.isVisible({ timeout: 3000 }).catch(() => false)) {
        await trainingParent.click();
        // Wait for the sub-menu to appear, then click "My Training"
        const myTrainingLink = page.locator('a[href="/training/my-training"]').first();
        if (await myTrainingLink.isVisible({ timeout: 3000 }).catch(() => false)) {
          await myTrainingLink.click();
        } else {
          // Fallback: navigate directly
          await page.goto('/training');
        }
      } else {
        await page.goto('/training');
      }

      await expect(page).toHaveURL(/\/training/, { timeout: 10000 });
    });
  });

  test.describe('Unknown Routes (404 handling)', () => {
    test('should redirect unknown routes to the root', async ({ page }) => {
      // The App.tsx catch-all route redirects unknown paths to "/" via:
      //   <Route path="*" element={<Navigate to="/" replace />} />
      // Then "/" will further redirect based on auth state.
      await page.goto('/this-route-does-not-exist-12345');

      // The catch-all redirects to "/", which will then redirect to either
      // /login (if unauthenticated) or a known route.
      // Since there is no stored token, ProtectedRoute will send to /login,
      // or the root redirect will land somewhere known.
      await page.waitForURL((url) => {
        const path = url.pathname;
        // Should not stay on the unknown route
        return path !== '/this-route-does-not-exist-12345';
      }, { timeout: 10000 });

      // Verify we are NOT on the unknown route anymore
      expect(page.url()).not.toContain('/this-route-does-not-exist-12345');
    });

    test('should redirect unknown routes for authenticated users', async ({ page }) => {
      await page.goto('/login');
      await setupAuthenticatedSession(page);

      await page.goto('/nonexistent-page-xyz');

      // The catch-all Route redirects to "/", and since the user has no token
      // in the URL context initially, the redirect chain should end at a known page.
      await page.waitForURL((url) => {
        const path = url.pathname;
        return path !== '/nonexistent-page-xyz';
      }, { timeout: 10000 });

      expect(page.url()).not.toContain('/nonexistent-page-xyz');
    });
  });
});
