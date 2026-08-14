import { test, expect } from '@playwright/test';

import {
  NOTIFICATION_SUBJECTS,
  SHIFT_OFFICER,
  TEST_USER,
  TRAINING_FIRST_PROGRESS,
  TRAINING_PROGRAMS,
  gotoDashboard,
  visibleText,
} from './helpers';

/**
 * Dashboard E2E Tests
 *
 * Covers the dashboard's content sections — greeting, notifications, upcoming
 * shifts, training progress, hours summary — plus empty states and the mobile
 * layout.
 *
 * Note on locators: the dashboard renders mobile and desktop variants of the
 * same content side by side (Tailwind `sm:hidden` / `hidden sm:inline`), so a
 * bare text locator legitimately matches twice. Assertions here scope to a
 * heading or take `.first()` rather than asserting a single match exists.
 */

test.describe('Dashboard', () => {
  test.describe('Greeting Section', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should greet the signed-in member by first name', async ({ page }) => {
      // The dashboard personalises the greeting when the profile has a first
      // name, and falls back to "Welcome to {department}" when it does not.
      const greeting = page.getByRole('heading', { level: 2 }).first();
      await expect(greeting).toBeVisible({ timeout: 10000 });
      await expect(greeting).toHaveText(`Hi, ${TEST_USER.first_name}`);
    });

    test('should display the current date', async ({ page }) => {
      // Rendered in a long format such as "Monday, January 1, 2026".
      await expect(page.locator('text=/\\w+day,/').first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test.describe('Notifications Section', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the Notifications section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /notifications/i }).first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('should display notification items from the API', async ({ page }) => {
      for (const subject of NOTIFICATION_SUBJECTS) {
        await expect(visibleText(page, subject)).toBeVisible({ timeout: 10000 });
      }
    });

    test('should have a "View All" control for the notifications page', async ({ page }) => {
      const viewAll = page.getByRole('button', { name: /view all/i }).first();
      await expect(viewAll).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Upcoming Shifts Section', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the Upcoming Shifts section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /upcoming shifts/i }).first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('should display shift items when shifts are available', async ({ page }) => {
      await expect(visibleText(page, SHIFT_OFFICER)).toBeVisible({
        timeout: 10000,
      });
    });

    test('should have a "View Schedule" control for the scheduling page', async ({ page }) => {
      // Both "My Upcoming Shifts" and "Open Shifts" carry one of these.
      const viewSchedule = page.getByRole('button', { name: /view schedule/i });
      await expect(viewSchedule.first()).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Training Progress Section', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the Training Progress section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /my training progress/i }).first();
      await expect(heading).toBeVisible({ timeout: 15000 });
    });

    test('should display enrolled training programs', async ({ page }) => {
      for (const program of TRAINING_PROGRAMS) {
        await expect(visibleText(page, program)).toBeVisible({ timeout: 15000 });
      }
    });

    test('should display progress percentages for programs', async ({ page }) => {
      await expect(visibleText(page, `${TRAINING_FIRST_PROGRESS}%`)).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Hours Summary Cards', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the hours summary region', async ({ page }) => {
      await expect(page.locator('[aria-label="Hours summary"]')).toBeVisible({
        timeout: 10000,
      });
    });

    test('should display Total Hours, Training, Standby, and Administrative cards', async ({ page }) => {
      const summary = page.locator('[aria-label="Hours summary"]');
      for (const label of ['Total Hours', 'Training', 'Standby', 'Administrative']) {
        await expect(summary.getByText(label).first()).toBeVisible({ timeout: 10000 });
      }
    });
  });

  test.describe('Responsive Layout', () => {
    test('should render the dashboard correctly on a mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await gotoDashboard(page);

      const greeting = page.getByRole('heading', { level: 2 }).first();
      await expect(greeting).toBeVisible({ timeout: 10000 });

      await expect(page.getByRole('heading', { name: /notifications/i }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: /upcoming shifts/i }).first()).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
    });

    test('should stack grid sections vertically on narrow screens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await gotoDashboard(page);

      await expect(page.locator('[aria-label="Hours summary"]')).toBeVisible({
        timeout: 10000,
      });

      const notifications = page.getByRole('heading', { name: /notifications/i }).first();
      const shifts = page.getByRole('heading', { name: /upcoming shifts/i }).first();
      await expect(notifications).toBeVisible({ timeout: 10000 });
      await expect(shifts).toBeVisible();

      const notifBox = await notifications.boundingBox();
      const shiftsBox = await shifts.boundingBox();
      expect(notifBox).not.toBeNull();
      expect(shiftsBox).not.toBeNull();
      // Single-column layout: shifts sit below notifications rather than beside.
      expect(shiftsBox?.y ?? 0).toBeGreaterThan(notifBox?.y ?? 0);
    });
  });

  test.describe('Markup validity', () => {
    test('should not nest interactive controls inside one another', async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.locator('[aria-label="Hours summary"]')).toBeVisible({
        timeout: 10000,
      });

      // A <button> inside a <button> (or an anchor) is invalid HTML. The
      // browser closes the outer element early, so the inner control escapes
      // its row and assistive technology receives a broken tree. React only
      // logs this to the console, where it is easy to miss.
      const nested = await page.locator('button button, button a[href], a[href] button').count();
      expect(nested).toBe(0);
    });
  });

  test.describe('Empty State', () => {
    test('should show empty state messages when no data is available', async ({ page }) => {
      await gotoDashboard(page, { empty: true });

      await expect(page.getByText(/no notifications/i).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/no upcoming shifts scheduled/i).first()).toBeVisible({ timeout: 10000 });
    });
  });
});
