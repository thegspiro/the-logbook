import { test, expect } from '@playwright/test';

import { signIn } from './helpers';

const NARROW_PHONE = { width: 320, height: 568 };
const MIN_TOUCH_TARGET = 44;

test.describe('calendar month navigation', () => {
  test('keeps every month control visible and touch-sized at 320px', async ({ page }) => {
    await page.setViewportSize(NARROW_PHONE);
    await signIn(page);
    await page.goto('/events');
    await page.getByRole('button', { name: 'Calendar view' }).click();

    const previousMonth = page.getByRole('button', { name: 'Previous month' });
    const nextMonth = page.getByRole('button', { name: 'Next month' });
    const today = page.getByRole('button', { name: 'Today', exact: true });
    const controls = [previousMonth, nextMonth, today];

    for (const control of controls) {
      await expect(control).toBeVisible();
      const bounds = await control.evaluate((element) => {
        const { x, width, height } = element.getBoundingClientRect();
        return { x, width, height };
      });
      expect(bounds.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(bounds.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(NARROW_PHONE.width);
    }

    const monthHeading = page.getByRole('heading', { level: 2 }).filter({ hasText: /\w+ \d{4}/ });
    await expect(monthHeading).toBeVisible();
    const headingBounds = await monthHeading.evaluate((element) => {
      const { x, width } = element.getBoundingClientRect();
      return { x, width };
    });
    const getHorizontalBounds = (control: typeof previousMonth) =>
      control.evaluate((element) => {
        const { x, width } = element.getBoundingClientRect();
        return { x, width };
      });
    const [previousBounds, nextBounds] = await Promise.all([
      getHorizontalBounds(previousMonth),
      getHorizontalBounds(nextMonth),
    ]);
    const navigationCenter = (previousBounds.x + nextBounds.x + nextBounds.width) / 2;
    expect(headingBounds.x + headingBounds.width / 2).toBeCloseTo(navigationCenter, 0);
  });
});
