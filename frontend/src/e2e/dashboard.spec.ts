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
 * Covers the station-board layout: greeting, the seven-day list that merges
 * shifts, open slots and events, the three quick actions, the personal updates feed,
 * training progress and the hours breakdown — plus empty states and the mobile
 * layout.
 *
 * Note on locators: the dashboard renders mobile and desktop variants of the
 * same content side by side (Tailwind `sm:hidden` / `hidden sm:inline`), so a
 * bare text locator legitimately matches twice. Assertions here scope to a
 * heading or region, or use `visibleText`, rather than asserting a single match.
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
      // Rendered in a long format such as "Monday, January 1".
      await expect(page.locator('text=/\\w+day,/').first()).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test.describe('Readiness verdict', () => {
    // The fixtures return no certification data, and "no data" is not "clear".
    // A green verdict derived from an empty set would assert a clearance the
    // department has no basis for, so the line must stay off the page entirely.
    test('should stay off the page when there is no certification data', async ({ page }) => {
      await gotoDashboard(page);

      await expect(page.getByRole('heading', { name: /next 7 days/i }).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/clear to respond/i)).toHaveCount(0);
      await expect(page.getByText(/certifications only/i)).toHaveCount(0);
    });
  });

  test.describe('Quick Actions', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    // Log Training used to be the only headline action. Signing up for a shift
    // and clocking in are just as common, so all three sit at the same level.
    test('should offer all three primary actions', async ({ page }) => {
      for (const label of ['Log Training', 'Take a Shift', 'Clock In']) {
        await expect(page.getByRole('button', { name: new RegExp(label, 'i') }).first()).toBeVisible({
          timeout: 10000,
        });
      }
    });
  });

  test.describe('Next 7 Days', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the Next 7 Days section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /next 7 days/i }).first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('should list the member’s own shifts, marked as theirs', async ({ page }) => {
      await expect(visibleText(page, SHIFT_OFFICER)).toBeVisible({ timeout: 10000 });
      await expect(page.getByText('Yours').first()).toBeVisible({ timeout: 10000 });
    });

    // A shift's start_time is a time of day, not an instant. Running it through
    // an instant formatter yields Invalid Date, and every row read "N/A – N/A".
    test('should render shift times rather than N/A', async ({ page }) => {
      const timeline = page.getByRole('region', { name: /next 7 days/i });
      await expect(timeline).toBeVisible({ timeout: 10000 });
      await expect(timeline.getByText('N/A')).toHaveCount(0);
    });

    test('should have a "Full Schedule" control for the scheduling page', async ({ page }) => {
      const fullSchedule = page.getByRole('button', { name: /full schedule/i });
      await expect(fullSchedule.first()).toBeVisible({ timeout: 10000 });
      await expect(fullSchedule.first()).toHaveCSS('min-height', '44px');
    });
  });

  test.describe('My Updates', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the My Updates section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /my updates/i }).first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('should display notification items from the API', async ({ page }) => {
      for (const subject of NOTIFICATION_SUBJECTS) {
        await expect(visibleText(page, subject)).toBeVisible({ timeout: 10000 });
      }
    });

    test('should have an "Older Items" control for the notifications page', async ({ page }) => {
      const olderItems = page.getByRole('button', { name: /older items/i }).first();
      await expect(olderItems).toBeVisible({ timeout: 10000 });
      await expect(olderItems).toHaveCSS('min-height', '44px');
    });
  });

  test.describe('Training Progress Section', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the training progress section heading', async ({ page }) => {
      const heading = page.getByRole('heading', { name: /my training/i }).first();
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

  test.describe('Hours Breakdown', () => {
    test.beforeEach(async ({ page }) => {
      await gotoDashboard(page);
    });

    test('should display the hours region', async ({ page }) => {
      await expect(page.getByRole('region', { name: /my hours/i })).toBeVisible({
        timeout: 10000,
      });
    });

    test('should break the month down into training, standby and administrative', async ({ page }) => {
      const hours = page.getByRole('region', { name: /my hours/i });
      for (const label of ['Training', 'Standby', 'Administrative']) {
        await expect(hours.getByText(label).first()).toBeVisible({ timeout: 10000 });
      }
    });
  });

  test.describe('Responsive Layout', () => {
    test('should render the dashboard correctly on a mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await gotoDashboard(page);

      const greeting = page.getByRole('heading', { level: 2 }).first();
      await expect(greeting).toBeVisible({ timeout: 10000 });

      await expect(page.getByRole('heading', { name: /next 7 days/i }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: /my updates/i }).first()).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
    });

    test('should stack the rail below the main column on narrow screens', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await gotoDashboard(page);

      const timeline = page.getByRole('heading', { name: /next 7 days/i }).first();
      const feed = page.getByRole('heading', { name: /my updates/i }).first();
      await expect(timeline).toBeVisible({ timeout: 10000 });
      await expect(feed).toBeVisible();

      const timelineBox = await timeline.boundingBox();
      const feedBox = await feed.boundingBox();
      expect(timelineBox).not.toBeNull();
      expect(feedBox).not.toBeNull();
      // Single-column layout: the rail sits below the seven-day list.
      expect(feedBox?.y ?? 0).toBeGreaterThan(timelineBox?.y ?? 0);
    });
  });

  test.describe('Markup validity', () => {
    test('should not nest interactive controls inside one another', async ({ page }) => {
      await gotoDashboard(page);
      await expect(page.getByRole('region', { name: /my hours/i })).toBeVisible({
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
    // A quiet week must not cost a screen of "nothing here" cards — the panels
    // that have nothing to say collapse to one line each.
    test('should show empty state messages when no data is available', async ({ page }) => {
      await gotoDashboard(page, { empty: true });

      await expect(page.getByText(/nothing scheduled through/i).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText(/nothing new/i).first()).toBeVisible({ timeout: 10000 });
    });

    test('should hide the "Needs you" panel when nothing needs the member', async ({ page }) => {
      await gotoDashboard(page, { empty: true });

      await expect(page.getByText(/nothing scheduled through/i).first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByRole('heading', { name: /needs you/i })).toHaveCount(0);
    });
  });
});
