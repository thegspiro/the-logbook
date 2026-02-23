import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 *
 * Tests the login page UI, form validation, error handling,
 * successful login flow, and logout behavior.
 */

test.describe('Authentication', () => {
  test.describe('Login Page', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
    });

    test('should load the login page and show the sign-in form', async ({ page }) => {
      // The page should have a heading indicating sign-in
      const heading = page.locator('h1');
      await expect(heading).toBeVisible();
      await expect(heading).toContainText('Sign in');

      // The form should be present with the aria label
      const form = page.locator('form[aria-label="Sign in form"]');
      await expect(form).toBeVisible();

      // The page should contain the platform branding text
      await expect(page.locator('text=Access The Logbook platform')).toBeVisible();
    });

    test('should have username and password input fields', async ({ page }) => {
      const usernameInput = page.locator('#username');
      await expect(usernameInput).toBeVisible();
      await expect(usernameInput).toHaveAttribute('name', 'username');
      await expect(usernameInput).toHaveAttribute('type', 'text');
      await expect(usernameInput).toHaveAttribute('placeholder', 'Username or Email');

      const passwordInput = page.locator('#password');
      await expect(passwordInput).toBeVisible();
      await expect(passwordInput).toHaveAttribute('name', 'password');
      await expect(passwordInput).toHaveAttribute('type', 'password');
      await expect(passwordInput).toHaveAttribute('placeholder', 'Password');
    });

    test('should have a submit button with "Sign in" text', async ({ page }) => {
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toBeVisible();
      await expect(submitButton).toHaveText('Sign in');
      await expect(submitButton).toBeEnabled();
    });

    test('should show a "Forgot your password?" link', async ({ page }) => {
      const forgotLink = page.locator('a[href="/forgot-password"]');
      await expect(forgotLink).toBeVisible();
      await expect(forgotLink).toHaveText('Forgot your password?');
    });

    test('should show validation errors when submitting an empty form', async ({ page }) => {
      // Clear any browser-level required validation by removing the required attribute
      // so we can test the application's own validation logic
      await page.locator('#username').evaluate((el) => el.removeAttribute('required'));
      await page.locator('#password').evaluate((el) => el.removeAttribute('required'));

      // Submit the empty form
      await page.locator('button[type="submit"]').click();

      // The application should display its own validation error messages
      const usernameError = page.locator('#username-error');
      await expect(usernameError).toBeVisible();
      await expect(usernameError).toHaveText('Username or email is required');

      const passwordError = page.locator('#password-error');
      await expect(passwordError).toBeVisible();
      await expect(passwordError).toHaveText('Password is required');
    });

    test('should show error message with invalid credentials', async ({ page }) => {
      // Mock the login API to return a 401 error
      await page.route('**/api/v1/auth/login', (route) => {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Invalid username or password' }),
        });
      });

      // Fill in credentials and submit
      await page.locator('#username').fill('invalid_user');
      await page.locator('#password').fill('wrong_password');
      await page.locator('button[type="submit"]').click();

      // An error alert should appear on the page
      const errorAlert = page.locator('[role="alert"]').filter({ hasText: /invalid|failed|incorrect/i });
      await expect(errorAlert).toBeVisible({ timeout: 10000 });
    });

    test('should show loading state while submitting', async ({ page }) => {
      // Delay the login API response to observe loading state
      await page.route('**/api/v1/auth/login', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Invalid credentials' }),
        });
      });

      await page.locator('#username').fill('testuser');
      await page.locator('#password').fill('testpassword');
      await page.locator('button[type="submit"]').click();

      // The button should show "Signing in..." while loading
      const submitButton = page.locator('button[type="submit"]');
      await expect(submitButton).toContainText('Signing in...');
      await expect(submitButton).toBeDisabled();
    });

    test('should redirect to dashboard on successful login', async ({ page }) => {
      // Mock the login API to return a successful response with tokens
      await page.route('**/api/v1/auth/login', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            access_token: 'mock-access-token-for-testing',
            refresh_token: 'mock-refresh-token-for-testing',
            token_type: 'bearer',
          }),
        });
      });

      // Mock the current user endpoint (called by loadUser after login)
      await page.route('**/api/v1/auth/me', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'test-user-id',
            username: 'testuser',
            email: 'testuser@example.com',
            first_name: 'Test',
            last_name: 'User',
            is_active: true,
            permissions: [],
            roles: [],
            positions: [],
          }),
        });
      });

      // Mock branding and other non-critical endpoints
      await page.route('**/api/v1/auth/branding', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ name: 'Test Department', logo: null }),
        });
      });

      // Fill in credentials and submit
      await page.locator('#username').fill('testuser');
      await page.locator('#password').fill('correct_password');
      await page.locator('button[type="submit"]').click();

      // Should redirect to dashboard
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should clear field error when user starts typing', async ({ page }) => {
      // Remove HTML required attributes to test app-level validation
      await page.locator('#username').evaluate((el) => el.removeAttribute('required'));
      await page.locator('#password').evaluate((el) => el.removeAttribute('required'));

      // Submit empty form to trigger validation errors
      await page.locator('button[type="submit"]').click();

      // Verify errors are shown
      await expect(page.locator('#username-error')).toBeVisible();

      // Start typing in the username field
      await page.locator('#username').fill('a');

      // The username error should be cleared
      await expect(page.locator('#username-error')).not.toBeVisible();
    });
  });

  test.describe('Logout', () => {
    test('should return to login page after logout', async ({ page }) => {
      // Set up authentication state by injecting tokens into localStorage
      await page.goto('/login');
      await page.evaluate(() => {
        localStorage.setItem('access_token', 'mock-access-token');
        localStorage.setItem('refresh_token', 'mock-refresh-token');
      });

      // Mock the current user endpoint
      await page.route('**/api/v1/auth/me', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'test-user-id',
            username: 'testuser',
            email: 'testuser@example.com',
            first_name: 'Test',
            last_name: 'User',
            is_active: true,
            permissions: [],
            roles: [],
            positions: [],
          }),
        });
      });

      // Mock non-critical API endpoints to prevent errors
      await page.route('**/api/v1/auth/branding', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ name: 'Test Department', logo: null }),
        });
      });

      await page.route('**/api/v1/auth/oauth-config', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ googleEnabled: false, microsoftEnabled: false }),
        });
      });

      await page.route('**/api/v1/organization/enabled-modules', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ enabled_modules: [] }),
        });
      });

      // Mock dashboard data endpoints to prevent errors
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
          body: JSON.stringify({ shifts: [] }),
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

      // Mock the logout endpoint
      await page.route('**/api/v1/auth/logout', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Logged out' }),
        });
      });

      // Navigate to the dashboard
      await page.goto('/dashboard');
      await page.waitForURL(/\/dashboard/, { timeout: 10000 });

      // Find and click the logout button in the navigation
      // The side navigation has a logout button/icon
      const logoutButton = page.locator('button').filter({ hasText: /log\s*out|sign\s*out/i });

      if (await logoutButton.isVisible()) {
        await logoutButton.click();

        // If a confirmation modal appears, confirm the logout
        const confirmButton = page.locator('button').filter({ hasText: /confirm|yes|log\s*out|sign\s*out/i });
        if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await confirmButton.click();
        }
      } else {
        // On mobile or collapsed nav, the logout might be behind a menu
        // Try opening the mobile menu first
        const menuButton = page.locator('button').filter({ has: page.locator('[class*="Menu"], [aria-label*="menu"]') }).first();
        if (await menuButton.isVisible({ timeout: 2000 }).catch(() => false)) {
          await menuButton.click();
          const mobileLogout = page.locator('button').filter({ hasText: /log\s*out|sign\s*out/i }).first();
          await mobileLogout.click();

          const confirmButton = page.locator('button').filter({ hasText: /confirm|yes|log\s*out|sign\s*out/i });
          if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confirmButton.click();
          }
        }
      }

      // After logout, should be back at the login page
      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });
  });
});
