/**
 * Desktop toolbar rows.
 *
 * With a mouse there is no 44px floor, so each control keeps its own natural
 * height and a row mixed them: a 42px search box beside a 38px "Filters"
 * button or a 30px "Add", and a 38px field beside a button carrying an
 * unconditional 44px touch minimum. index.css gives a button in a field's row
 * the field's height on a mouse-driven screen; these pin the rows a desktop
 * sweep found, at the two most common laptop and monitor sizes.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROUTES, signInForRoute } from './mobile-routes';

const DESKTOPS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
];

// Path, the field, and the button sharing its row.
const ROWS: { path: string; field: string; button: string }[] = [
  { path: '/training/courses', field: 'input[placeholder^="Search courses"]', button: 'button:has-text("Filters")' },
  { path: '/events', field: '[aria-label="Sort events"]', button: 'button:has-text("My Events")' },
  { path: '/testing', field: 'input[aria-label="Search pages"]', button: 'button:has-text("Only pages")' },
  {
    path: '/prospective-members',
    field: 'input[placeholder^="Search applicants"]',
    button: 'button:has-text("Filter")',
  },
  { path: '/scheduling/admin/planning', field: 'input[type="date"]', button: 'button:has-text("Refresh")' },
  {
    path: '/scheduling/admin/settings/general',
    field: 'input[placeholder="e.g. Water Rescue"]',
    button: 'button:has-text("Add")',
  },
  { path: '/admin/audit-log', field: 'select.form-input-sm', button: '[aria-label="First page"]' },
  // A field whose text size comes from the page rather than a class: an
  // assumed 16px lifted its 38px row's button to 42px.
  { path: '/scheduling/admin/settings/general', field: 'input.form-input.w-28', button: 'button:has-text("Save")' },
];

const open = async (page: Page, path: string, viewport: { width: number; height: number }) => {
  const route = ROUTES.find((r) => r.path === path);
  if (!route) throw new Error(`${path} is not in the mobile route list`);
  await page.setViewportSize(viewport);
  await signInForRoute(page, route, null);
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
  await page.waitForTimeout(300);
};

const heightOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no bounding box`);
  return box.height;
};

test.describe('A button matches the field in its row on a desktop', () => {
  for (const viewport of DESKTOPS) {
    for (const { path, field, button } of ROWS) {
      test(`${path} [${button}] — ${viewport.name}`, async ({ page }) => {
        await open(page, path, viewport);
        const fieldHeight = await heightOf(page, field);
        const buttonHeight = await heightOf(page, button);
        expect(
          Math.abs(buttonHeight - fieldHeight),
          `field ${Math.round(fieldHeight)}px, button ${Math.round(buttonHeight)}px`
        ).toBeLessThanOrEqual(2);
      });
    }
  }
});

test.describe('A touch screen keeps its 44px targets', () => {
  // The rule is for a mouse. The same rows on a touch tablet must keep the
  // finger-sized buttons the touch passes require.
  test.use({ hasTouch: true });

  test('/prospective-members — touch tablet', async ({ page }) => {
    await open(page, '/prospective-members', { width: 1180, height: 820 });
    expect(await heightOf(page, 'button:has-text("Filter")')).toBeGreaterThanOrEqual(44);
  });
});
