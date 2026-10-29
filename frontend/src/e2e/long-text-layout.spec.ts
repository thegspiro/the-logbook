/**
 * Layout with realistic, long names in it.
 *
 * The fixtures are written with short, tidy strings — "Engine 1", "Alex
 * Tester", "Oakville Fire Department" — and a layout that fits those says
 * little about a department called "Greater Northfield-Oakville Township
 * Volunteer Fire & Rescue". `longText` lengthens every display string the mock
 * serves (see helpers.ts), so this measures the screens whose content comes
 * from fixtures, plus the shell's department and member names on every screen.
 *
 * Only these routes: most pages are answered by the catch-all `{}` and render
 * an empty state, with no record whose name could be long, so sweeping them
 * here would report the absence of data as a pass.
 */

import { test, expect } from '@playwright/test';
import { BASE_PERMISSIONS, ROUTES } from './mobile-routes';
import { signIn } from './helpers';
import { findSpilledText } from './spilledText';

const PATHS = [
  '/dashboard',
  '/notifications?tab=inbox',
  '/admin/audit-log',
  '/admin/security-alerts',
  '/events/admin?tab=settings',
  '/scheduling/admin/closeout',
  '/inventory/admin/store',
  '/training/my-training',
];

const SIZES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

test.describe('Long names stay inside their boxes', () => {
  for (const path of PATHS) {
    test(path, async ({ page }) => {
      const route = ROUTES.find((r) => r.path === path);
      if (!route) throw new Error(`${path} is not in the mobile route list`);
      await page.setViewportSize(SIZES[0] ?? { width: 320, height: 568 });
      await signIn(page, {
        ...route.fixture,
        permissions: [...BASE_PERMISSIONS, ...(route.permissions ?? [])],
        longText: true,
      });
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
      // The long department name is the proof the fixture reached the page.
      await expect(page.getByText(/Greater Northfield-Oakville Township/).first()).toBeAttached();

      const failures: string[] = [];
      for (const size of SIZES) {
        await page.setViewportSize(size);
        await page.waitForTimeout(250);
        const spilled = await page.evaluate(findSpilledText);
        const pageWider = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        if (spilled.length) failures.push(`${size.width}px, text outside its box:\n    ${spilled.join('\n    ')}`);
        if (pageWider > 0) failures.push(`${size.width}px: the page scrolls sideways by ${pageWider}px`);
      }
      expect(failures).toEqual([]);
    });
  }
});
