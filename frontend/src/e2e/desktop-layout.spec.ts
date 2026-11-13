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
import { json, signIn, TEST_USER } from './helpers';
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

// The roster's Actions column sat past the right edge of its card on a laptop,
// and the only way to reach it was a horizontal scrollbar at the foot of the
// table, a full page of members below the first row's missing buttons. Every
// identity cell refused to wrap and each of seven columns carried 48px of
// padding, so three ordinary members were 58px wider than the card at
// 1366x768. Long names, usernames and membership labels are what force it,
// so the fixture carries them.
// A tablet keeps the side navigation open, so the page body there is narrower
// than seven columns need however they wrap. The roster reflows into one card
// per member when its own card is under 64rem, which a viewport breakpoint
// cannot see: a 1024px iPad Pro leaves it ~690px. A 1280px laptop lands just
// under the line too.
const ROSTER_TABLETS = [
  { name: 'iPad portrait 820x1180', width: 820, height: 1180 },
  { name: 'tablet 1000x800', width: 1000, height: 800 },
  { name: 'iPad Pro portrait 1024x1366', width: 1024, height: 1366 },
  { name: 'laptop 1280x800', width: 1280, height: 800 },
];

test.describe('The member roster fits its card on a laptop or tablet', () => {
  const position = (id: string, name: string) => ({
    id,
    name,
    slug: id,
    is_system: true,
    permissions: [],
  });
  const member = (
    n: number,
    first: string,
    last: string,
    status: string,
    membershipType: string,
    memberStatus: string,
    roles: unknown[]
  ) => ({
    id: `roster-${n}`,
    organization_id: 'org-1',
    username: `${first}${last}`.toLowerCase(),
    first_name: first,
    last_name: last,
    membership_number: `64${n}0`,
    rank: 'emt',
    status,
    membership_type: membershipType,
    member_class: 'operational',
    member_status: memberStatus,
    roles,
    mfa_enabled: true,
    has_passkey: false,
    locked_until: null,
  });
  const ROSTER = [
    member(1, 'Alexandra', 'Ayala-Montgomery', 'probationary', 'probationary', 'probationary', [
      position('probationary', 'Probationary Member'),
      position('member', 'Member'),
    ]),
    member(2, 'Jonathan', 'Babbitt', 'active', 'active', 'regular', [position('member', 'Member')]),
    member(3, 'Elizabeth', 'Zach', 'active', 'life', 'life', [
      position('life', 'Life Member'),
      position('member', 'Member'),
    ]),
  ];

  for (const viewport of [...DESKTOPS, ...ROSTER_TABLETS]) {
    test(`/members/admin — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'members.manage'] });
      await page.route('**/api/v1/users/with-roles**', (route) => void route.fulfill(json(ROSTER)));
      await page.goto('/members/admin');
      const region = page.getByRole('region', { name: 'Members and their positions' });
      // The last column's control on the last row: once it is attached the
      // table has rendered. Delete moved into this "⋯" menu (2026-11-10).
      await expect(region.getByRole('button', { name: 'More actions for Elizabeth Zach' })).toBeAttached({
        timeout: 15_000,
      });

      const overflow = await region.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `the roster is ${overflow}px wider than its card`).toBeLessThanOrEqual(0);
    });
  }

  // The row's "⋯" menu, on the last row. Rendered inside the table it was laid
  // out against the blurred container rather than the window, and focusing
  // its first item scrolled the page, which closed it again at once.
  test('/members/admin — the last row’s action menu opens in view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, { permissions: [...TEST_USER.permissions, 'members.manage'] });
    await page.route('**/api/v1/users/with-roles**', (route) => void route.fulfill(json(ROSTER)));
    await page.goto('/members/admin');
    const trigger = page.getByRole('button', { name: 'More actions for Elizabeth Zach' });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.click();

    const del = page.getByRole('menuitem', { name: 'Delete Elizabeth Zach' });
    await expect(del).toBeVisible();
    await page.waitForTimeout(500);
    await expect(del, 'the menu closed itself straight after opening').toBeVisible();
    await expect(del).toBeInViewport();
  });
});
