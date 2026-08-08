import { test, expect } from '@playwright/test';

import { gotoDashboard } from './helpers';

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
        void route.fulfill({
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
        await route.fulfill({
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
        void route.fulfill({
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
        void route.fulfill({
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
        void route.fulfill({
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
      await gotoDashboard(page);

      // The navigation's logout control opens a confirmation dialog rather
      // than signing out immediately.
      await page
        .getByRole('button', { name: /^logout$/i })
        .first()
        .click();

      // Scope the confirmation to the dialog. Unscoped, "Logout" also matches
      // the navigation button that opened it, and the resulting strict-mode
      // error is easy to swallow — leaving the dialog open and the member
      // still signed in while the test reports only a URL timeout.
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      await dialog.getByRole('button', { name: /^logout$/i }).click();

      await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    });
  });
});
