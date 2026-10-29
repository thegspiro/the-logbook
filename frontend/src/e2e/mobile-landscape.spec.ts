/**
 * Phones held sideways.
 *
 * A phone on its side is 844px wide and 390px tall. Wider than 767px, it gets
 * the tablet layout — the side navigation, `sm:`/`md:` sizes — while still
 * being driven by a finger on a very short screen. The phone passes measure
 * portrait only, so everything here was invisible to them: a menu list left
 * ~130px tall, tap targets that `sm:` shrank back to desktop size, a calendar
 * squeezed to 18px day cells, and search boxes crushed to their icon.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROUTES, signInForRoute } from './mobile-routes';

const LANDSCAPE = { width: 844, height: 390 };
const PORTRAIT = { width: 390, height: 844 };
const MIN_TAP = 44;
/** About 8em at 16px: enough of a value or placeholder to read what it is. */
const READABLE_PX = 128;

test.use({ hasTouch: true, isMobile: true });

const open = async (page: Page, path: string, viewport: { width: number; height: number }) => {
  const route = ROUTES.find((r) => r.path === path);
  if (!route) throw new Error(`${path} is not in the mobile route list`);
  await page.setViewportSize(viewport);
  await signInForRoute(page, route, null);
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
  await page.waitForTimeout(400);
};

test.describe('Side navigation on a phone held sideways', () => {
  test('gives the menu the height and keeps the footer reachable', async ({ page }) => {
    await open(page, '/dashboard', LANDSCAPE);
    const list = page.locator('[data-nav-list]');
    await expect(list).toBeVisible();
    // The header and footer took ~260px of 390, leaving the list ~130px.
    const box = await list.boundingBox();
    if (!box) throw new Error('The navigation list has no bounding box');
    expect(box.height, 'menu list height').toBeGreaterThan(LANDSCAPE.height);

    const logout = page.getByRole('button', { name: 'Logout' });
    await logout.scrollIntoViewIfNeeded();
    await expect(logout).toBeInViewport();
  });
});

// Every one of these rendered at least one control under 44px at 844x390 while
// measuring clean at 390x844.
const TAP_ROUTES = [
  '/training/submit',
  '/scheduling',
  '/admin/audit-log',
  '/members/admin?tab=add',
  '/training/admin?page=setup&tab=manual-entry',
];

test.describe('Tap targets on a phone held sideways', () => {
  for (const path of TAP_ROUTES) {
    test(path, async ({ page }) => {
      await open(page, path, LANDSCAPE);
      const small = await page.evaluate((minTap) => {
        const vw = document.documentElement.clientWidth;
        return [
          ...document.querySelectorAll('main :is(button, a[href], [role="button"], select, input:not([type=hidden]))'),
        ]
          .filter((el) => {
            const box =
              (el instanceof HTMLInputElement &&
                (el.type === 'checkbox' || el.type === 'radio') &&
                el.closest('label')) ||
              el;
            const b = box.getBoundingClientRect();
            if (b.width <= 2 || b.height <= 2 || b.right <= 0 || b.left >= vw) return false;
            // A link inside running text is exempt (WCAG 2.5.8, Inline).
            if (el.tagName === 'A' && el.parentElement) {
              const inSentence = [...el.parentElement.childNodes].some(
                (n) => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim()
              );
              if (inSentence) return false;
            }
            return b.height < minTap || b.width < minTap;
          })
          .map((el) => {
            const b = el.getBoundingClientRect();
            const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.tagName).trim();
            return `${name.slice(0, 40)} ${Math.round(b.width)}x${Math.round(b.height)}`;
          });
      }, MIN_TAP);
      expect(small, `${path}: targets under ${MIN_TAP}px`).toEqual([]);
    });
  }
});

// Each sat in a row as `flex-1` with a zero basis, so the row shrank it instead
// of wrapping it: some showed only the magnifying glass.
const SEARCH_FIELDS: { path: string; placeholder: string }[] = [
  { path: '/training/admin?page=skills-testing&tab=templates', placeholder: 'Search templates...' },
  { path: '/training/admin?page=skills-testing&tab=tests', placeholder: 'Search tests...' },
  { path: '/prospective-members', placeholder: 'Search applicants...' },
  { path: '/locations/qr-codes', placeholder: 'Search rooms or apparatus...' },
  { path: '/scheduling/admin/settings/outside-apparatus', placeholder: 'e.g. Township Fire Company' },
];

test.describe('Search fields stay readable on a phone', () => {
  for (const viewport of [
    { name: 'portrait', ...PORTRAIT },
    { name: 'landscape', ...LANDSCAPE },
  ]) {
    for (const { path, placeholder } of SEARCH_FIELDS) {
      test(`${path} — ${viewport.name}`, async ({ page }) => {
        await open(page, path, viewport);
        const field = page.getByPlaceholder(placeholder, { exact: true });
        await expect(field).toBeVisible();
        const { text, room } = await field.evaluate((el) => {
          const input = el as HTMLInputElement;
          const cs = getComputedStyle(input);
          const ctx = document.createElement('canvas').getContext('2d');
          if (!ctx) return { text: 0, room: Infinity };
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          return {
            text: ctx.measureText(input.placeholder).width,
            room: input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          };
        });
        expect(room, `"${placeholder}" shows ${Math.round(room)}px of ${Math.round(text)}px`).toBeGreaterThanOrEqual(
          Math.min(text, READABLE_PX) - 2
        );
      });
    }
  }
});

test.describe('Shift calendar day cells', () => {
  // From 768px the calendar sat beside a fixed day panel and the side
  // navigation took 256px more: 18px day cells at 844 and 820px, 33px at 1024.
  // On a 360px phone the compact strip's cells came to 43px.
  for (const viewport of [
    { name: 'phone landscape', grid: 'Month calendar', ...LANDSCAPE },
    { name: 'iPad portrait', grid: 'Month calendar', width: 820, height: 1180 },
    { name: 'iPad landscape', grid: 'Month calendar', width: 1024, height: 768 },
    { name: '360px phone', grid: 'Month calendar, compact', width: 360, height: 780 },
  ]) {
    test(viewport.name, async ({ page }) => {
      await open(page, '/scheduling', viewport);
      const grid = page.getByRole('grid', { name: viewport.grid, exact: true });
      await expect(grid).toBeVisible();
      const widths = await grid
        .getByRole('gridcell')
        .evaluateAll((els) =>
          els.filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.getBoundingClientRect().width)
        );
      expect(widths.length, 'visible day cells').toBeGreaterThanOrEqual(7);
      expect(Math.min(...widths), 'narrowest day cell').toBeGreaterThanOrEqual(MIN_TAP);
    });
  }
});

// A phone whose width keeps the phone layout (under 768px) held sideways: an
// iPhone SE is 568x320. The 64px top bar and 56px bottom bar left it 198px of
// page. On a screen this short both bars drop to 48px, which keeps every label
// and the 44px touch minimum; a portrait phone keeps its usual bars.
test.describe('Bars on a small phone held sideways', () => {
  const bars = async (page: Page) =>
    page.evaluate(() => {
      const header = document.querySelector('header[role="banner"]')?.getBoundingClientRect();
      const bottom = document.querySelector('nav[aria-label="Primary"]')?.getBoundingClientRect();
      const offset = document.querySelector('.mobile-header-offset');
      return {
        header: Math.round(header?.height ?? 0),
        tabs: [...document.querySelectorAll('nav[aria-label="Primary"] li > :is(a, button)')].map((el) =>
          Math.round(el.getBoundingClientRect().height)
        ),
        room: Math.round((bottom?.top ?? 0) - (header?.bottom ?? 0)),
        offset: offset ? parseFloat(getComputedStyle(offset).paddingTop) : 0,
      };
    });

  test('568x320 gets compact bars and the page offset follows them', async ({ page }) => {
    await open(page, '/events', { width: 568, height: 320 });
    const m = await bars(page);
    // The header box includes its 1px bottom border.
    expect(m.header, 'top bar height').toBe(49);
    expect(m.offset, 'content offset below the top bar').toBe(48);
    expect(m.tabs.length, 'bottom bar tabs').toBeGreaterThan(0);
    for (const height of m.tabs) expect(height, 'bottom bar tab height').toBe(48);
    expect(m.room, 'page between the bars').toBeGreaterThanOrEqual(220);
  });

  test('390x844 keeps the full-size bars', async ({ page }) => {
    await open(page, '/events', PORTRAIT);
    const m = await bars(page);
    expect(m.header).toBe(65);
    expect(m.offset).toBe(64);
    for (const height of m.tabs) expect(height).toBe(56);
  });
});
