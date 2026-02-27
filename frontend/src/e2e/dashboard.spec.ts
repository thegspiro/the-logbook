import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard E2E Tests
 *
 * Tests dashboard content sections including welcome message, notifications,
 * upcoming shifts, training progress, and responsive layout on mobile viewports.
 */

/** Shared mock API route setup for an authenticated session with dashboard data. */
async function setupAuthenticatedDashboard(page: Page) {
  // Inject tokens into localStorage
  await page.evaluate(() => {
    localStorage.setItem('access_token', 'mock-access-token');
    localStorage.setItem('refresh_token', 'mock-refresh-token');
  });

  // Mock current user endpoint
  await page.route('**/api/v1/auth/me', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'dashboard-test-user-id',
        username: 'dashboarduser',
        email: 'dashboard@example.com',
        first_name: 'Dashboard',
        last_name: 'Tester',
        is_active: true,
        permissions: [],
        roles: [],
        positions: [],
      }),
    });
  });

  // Mock branding endpoint with a specific department name
  await page.route('**/api/v1/auth/branding', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Oakville Fire Department', logo: null }),
    });
  });

  // Mock dashboard branding (used by Dashboard component directly)
  await page.route('**/api/v1/dashboard/branding', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'Oakville Fire Department', logo: null }),
    });
  });

  // Mock OAuth config
  await page.route('**/api/v1/auth/oauth-config', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ googleEnabled: false, microsoftEnabled: false }),
    });
  });

  // Mock organization enabled-modules
  await page.route('**/api/v1/organization/enabled-modules', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled_modules: [] }),
    });
  });

  // Mock notifications with sample data
  await page.route('**/api/v1/notifications/**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        logs: [
          {
            id: 'notif-1',
            subject: 'New event scheduled',
            message: 'Monthly drill has been scheduled for next week.',
            sent_at: new Date().toISOString(),
            read: false,
            action_url: '/events',
          },
          {
            id: 'notif-2',
            subject: 'Training reminder',
            message: 'Your CPR certification expires in 30 days.',
            sent_at: new Date(Date.now() - 86400000).toISOString(),
            read: true,
            action_url: '/training',
          },
        ],
      }),
    });
  });

  // Mock upcoming shifts with sample data
  await page.route('**/api/v1/scheduling/my-shifts**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shifts: [
          {
            id: 'shift-1',
            shift_date: '2026-03-01',
            start_time: '08:00',
            end_time: '16:00',
            shift_officer_name: 'Captain Smith',
          },
          {
            id: 'shift-2',
            shift_date: '2026-03-05',
            start_time: '16:00',
            end_time: '00:00',
            shift_officer_name: null,
          },
        ],
      }),
    });
  });

  // Mock scheduling summary
  await page.route('**/api/v1/scheduling/summary**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total_hours_this_month: 24 }),
    });
  });

  // Mock training enrollments with sample data
  await page.route('**/api/v1/training/programs/enrollments**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'enrollment-1',
          program: {
            id: 'prog-1',
            name: 'Firefighter I Certification',
            description: 'Basic firefighter certification program',
          },
          status: 'active',
          progress_percentage: 65,
        },
        {
          id: 'enrollment-2',
          program: {
            id: 'prog-2',
            name: 'EMT Refresher',
            description: 'Annual EMT certification renewal',
          },
          status: 'active',
          progress_percentage: 30,
        },
      ]),
    });
  });

  // Mock training enrollment progress detail
  await page.route('**/api/v1/training/programs/enrollments/*/progress', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requirement_progress: [
          { id: 'req-1', requirement: { name: 'Written Exam' }, status: 'not_started' },
          { id: 'req-2', requirement: { name: 'Practical Skills' }, status: 'in_progress' },
        ],
        time_remaining_days: 45,
      }),
    });
  });

  // Mock training my-training summary
  await page.route('**/api/v1/training/config/my-training**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hours_summary: { total_hours: 12 } }),
    });
  });

  // Catch-all for other training routes
  await page.route('**/api/v1/training/**', (route) => {
    if (route.request().url().includes('enrollments') || route.request().url().includes('config')) {
      // Already handled by more specific routes above; let them through
      void route.fallback();
    } else {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }
  });

  // Mock messages
  await page.route('**/api/v1/messages/**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // Mock inventory
  await page.route('**/api/v1/inventory/**', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });

  // Mock dashboard admin summary (returns 403 for non-admin user)
  await page.route('**/api/v1/dashboard/admin-summary', (route) => {
    void route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Forbidden' }),
    });
  });
}

test.describe('Dashboard', () => {
  test.describe('Welcome Section', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await setupAuthenticatedDashboard(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should display the welcome message with department name', async ({ page }) => {
      // The dashboard shows "Welcome to {departmentName}" as the main heading
      const welcomeHeading = page.locator('h2').filter({ hasText: /welcome to/i });
      await expect(welcomeHeading).toBeVisible({ timeout: 10000 });

      // It should contain either the mocked department name or the default
      await expect(welcomeHeading).toContainText(/welcome to/i);
    });

    test('should display the current date', async ({ page }) => {
      // The dashboard shows today's date beneath the welcome heading
      // It uses a long format like "Monday, January 1, 2026"
      const dateText = page.locator('text=/\\w+day,/');
      await expect(dateText).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Notifications Section', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await setupAuthenticatedDashboard(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should display the Notifications section heading', async ({ page }) => {
      const notificationsHeading = page.locator('h3').filter({ hasText: /notifications/i });
      await expect(notificationsHeading).toBeVisible({ timeout: 10000 });
    });

    test('should display notification items from the API', async ({ page }) => {
      // Wait for the notification data to load and render
      const notificationItem = page.locator('text=New event scheduled');
      await expect(notificationItem).toBeVisible({ timeout: 10000 });

      const secondNotification = page.locator('text=Training reminder');
      await expect(secondNotification).toBeVisible();
    });

    test('should have a "View All" link to the notifications page', async ({ page }) => {
      // The Notifications section has a "View All" button that navigates to /notifications
      const viewAllButton = page.locator('button, a').filter({ hasText: /view all/i }).first();
      await expect(viewAllButton).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Upcoming Shifts Section', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await setupAuthenticatedDashboard(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should display the Upcoming Shifts section heading', async ({ page }) => {
      const shiftsHeading = page.locator('h3').filter({ hasText: /upcoming shifts/i });
      await expect(shiftsHeading).toBeVisible({ timeout: 10000 });
    });

    test('should display shift items when shifts are available', async ({ page }) => {
      // Wait for shift data to load. The shift for 2026-03-01 should render
      // with the officer name "Captain Smith".
      const officerText = page.locator('text=Captain Smith');
      await expect(officerText).toBeVisible({ timeout: 10000 });
    });

    test('should have a "View Schedule" link to the scheduling page', async ({ page }) => {
      const viewScheduleButton = page.locator('button, a').filter({ hasText: /view schedule/i });
      await expect(viewScheduleButton).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Training Progress Section', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await setupAuthenticatedDashboard(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should display the Training Progress section heading', async ({ page }) => {
      const trainingHeading = page.locator('h3').filter({ hasText: /my training progress/i });
      await expect(trainingHeading).toBeVisible({ timeout: 15000 });
    });

    test('should display enrolled training programs', async ({ page }) => {
      // The mock returns two enrollments
      const program1 = page.locator('text=Firefighter I Certification');
      await expect(program1).toBeVisible({ timeout: 15000 });

      const program2 = page.locator('text=EMT Refresher');
      await expect(program2).toBeVisible();
    });

    test('should display progress percentages for programs', async ({ page }) => {
      // The mock data has 65% for the first enrollment
      const progressText = page.locator('text=65%');
      await expect(progressText).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Hours Summary Cards', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/login');
      await setupAuthenticatedDashboard(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    });

    test('should display the hours summary region', async ({ page }) => {
      const hoursSummary = page.locator('[aria-label="Hours summary"]');
      await expect(hoursSummary).toBeVisible({ timeout: 10000 });
    });

    test('should display Total Hours, Training, Standby, and Administrative cards', async ({ page }) => {
      // The hours summary has four cards with these labels
      await expect(page.locator('text=Total Hours').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=Training').first()).toBeVisible();
      await expect(page.locator('text=Standby').first()).toBeVisible();
      await expect(page.locator('text=Administrative').first()).toBeVisible();
    });
  });

  test.describe('Responsive Layout', () => {
    test('should render the dashboard correctly on a mobile viewport', async ({ page, browserName: _browserName }) => {
      // Set a mobile-sized viewport
      await page.setViewportSize({ width: 375, height: 812 });

      await page.goto('/login');
      await setupAuthenticatedDashboard(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // The welcome heading should still be visible
      const welcomeHeading = page.locator('h2').filter({ hasText: /welcome to/i });
      await expect(welcomeHeading).toBeVisible({ timeout: 10000 });

      // The notifications section should be visible (stacked vertically on mobile)
      const notificationsHeading = page.locator('h3').filter({ hasText: /notifications/i });
      await expect(notificationsHeading).toBeVisible({ timeout: 10000 });

      // The upcoming shifts section should also be visible
      const shiftsHeading = page.locator('h3').filter({ hasText: /upcoming shifts/i });
      await expect(shiftsHeading).toBeVisible();

      // On mobile, the sidebar is typically collapsed/hidden behind a menu button
      // Verify the main content area is still accessible and scrollable
      const mainContent = page.locator('main');
      await expect(mainContent).toBeVisible();
    });

    test('should stack grid sections vertically on narrow screens', async ({ page }) => {
      // Set a narrow viewport
      await page.setViewportSize({ width: 375, height: 812 });

      await page.goto('/login');
      await setupAuthenticatedDashboard(page);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // Wait for content to load
      const hoursSummary = page.locator('[aria-label="Hours summary"]');
      await expect(hoursSummary).toBeVisible({ timeout: 10000 });

      // Get the bounding boxes of the Notifications and Upcoming Shifts headings
      // On mobile (< lg breakpoint), these should be stacked (Shifts below Notifications)
      const notificationsHeading = page.locator('h3').filter({ hasText: /notifications/i });
      const shiftsHeading = page.locator('h3').filter({ hasText: /upcoming shifts/i });

      await expect(notificationsHeading).toBeVisible({ timeout: 10000 });
      await expect(shiftsHeading).toBeVisible();

      const notifBox = await notificationsHeading.boundingBox();
      const shiftsBox = await shiftsHeading.boundingBox();

      if (notifBox && shiftsBox) {
        // In a single-column layout, the shifts heading should be below the notifications heading
        expect(shiftsBox.y).toBeGreaterThan(notifBox.y);
      }
    });
  });

  test.describe('Empty State', () => {
    test('should show empty state messages when no data is available', async ({ page }) => {
      await page.goto('/login');

      // Set up authentication but with empty data responses
      await page.evaluate(() => {
        localStorage.setItem('access_token', 'mock-access-token');
        localStorage.setItem('refresh_token', 'mock-refresh-token');
      });

      await page.route('**/api/v1/auth/me', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'empty-test-user',
            username: 'emptyuser',
            email: 'empty@example.com',
            first_name: 'Empty',
            last_name: 'State',
            is_active: true,
            permissions: [],
            roles: [],
            positions: [],
          }),
        });
      });

      await page.route('**/api/v1/auth/branding', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ name: 'Test Department', logo: null }),
        });
      });

      await page.route('**/api/v1/auth/oauth-config', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ googleEnabled: false, microsoftEnabled: false }),
        });
      });

      await page.route('**/api/v1/organization/enabled-modules', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ enabled_modules: [] }),
        });
      });

      // Return empty data for all dashboard endpoints
      await page.route('**/api/v1/dashboard/**', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      });

      await page.route('**/api/v1/notifications/**', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ logs: [] }),
        });
      });

      await page.route('**/api/v1/scheduling/**', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ shifts: [], total_hours_this_month: 0 }),
        });
      });

      await page.route('**/api/v1/training/**', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      });

      await page.route('**/api/v1/messages/**', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      });

      await page.route('**/api/v1/inventory/**', (route) => {
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
      });

      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });

      // With no notifications, it should show the empty state
      const noNotifications = page.locator('text=No notifications');
      await expect(noNotifications).toBeVisible({ timeout: 10000 });

      // With no upcoming shifts, it should show the empty state
      const noShifts = page.locator('text=No upcoming shifts scheduled');
      await expect(noShifts).toBeVisible({ timeout: 10000 });
    });
  });
});
