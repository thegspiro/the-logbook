/**
 * Tablet layout regressions.
 *
 * A tablet is the width the viewport breakpoints guess wrong most often: the
 * sidebar is already expanded at 820px, so the content area is ~550px while
 * every `sm:`/`md:` rule believes it has the whole screen. These checks cover
 * what a tablet audit found that the unit suite cannot see, because they are
 * properties of the laid-out page.
 */

import { test, expect } from '@playwright/test';
import { mockApi, TEST_USER } from './helpers';
import { ROUTES, signInForRoute } from './mobile-routes';

const TABLETS = [
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad Pro portrait', width: 1024, height: 1366 },
];

test.describe('Reports page on a tablet', () => {
  for (const viewport of TABLETS) {
    // The reporting-period date inputs carry `w-full` from `form-input-sm` and
    // were `flex-none` from `sm` up, so each claimed the whole row and the end
    // date ran ~180px off the right edge of the screen.
    test(`does not scroll sideways — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockApi(page, { permissions: [...TEST_USER.permissions, 'reports.view'] });
      await page.goto('/login');
      await page.evaluate(() => {
        localStorage.setItem('has_session', '1');
      });

      await page.goto('/reports');
      await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible({ timeout: 15_000 });
      const endDate = page.getByLabel('Reporting period end date');
      await expect(endDate).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `the page is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(0);

      const box = await endDate.boundingBox();
      if (!box) throw new Error('The end-date input has no bounding box');
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    });
  }
});

// Each of these scrolled sideways on a tablet while the phone and desktop
// passes were clean, because the sidebar leaves a tablet far less room than its
// viewport width suggests and every `sm:` rule believes it has the whole
// screen. The causes were a shared header whose title block refused to shrink,
// a wizard step bar that showed its labels from `sm`, steps that could not wrap
// their descriptions, and a `mobile-touch-target` label without `shrink-0`.
const TABLET_ROUTES = [
  '/medical-supplies',
  '/inventory/my-equipment',
  '/apparatus-basic',
  '/facilities',
  '/training/admin?page=curriculum&tab=pipelines&view=new',
  '/inventory/admin/setup',
  '/inventory/admin/pool',
];

test.describe('Pages do not scroll sideways on a tablet', () => {
  for (const viewport of TABLETS) {
    for (const path of TABLET_ROUTES) {
      test(`${path} — ${viewport.name}`, async ({ page }) => {
        const route = ROUTES.find((r) => r.path === path);
        if (!route) throw new Error(`${path} is not in the mobile route list`);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await signInForRoute(page, route, null);
        await page.goto(path);
        await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(400);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${path} is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(0);
      });
    }
  }
});

// Form fields on a touch tablet. Two failures, both invisible on a phone (one
// column) and on a laptop (room to spare):
//
//   - `sm:grid-cols-3` beside the 16rem side navigation split an iPad-portrait
//     card into ~124px columns, so a label that wrapped pushed its input 20px
//     below the inputs beside it, and Organization Settings' own section rail
//     left its panel ~200px wide. index.css holds such grids at two columns
//     until `lg`; SettingsLayout keeps its rail as a strip until `lg`.
//   - A search box sharing a row with a `w-full` select, or with flex-1 in a
//     wrapping row, was crushed to its icon.
//
// Run with a coarse pointer, as an iPad reports, so the touch sizes apply.
const FORM_ROUTES = [
  '/members/admin/edit/1',
  '/account',
  '/settings',
  '/training/admin?page=setup&tab=pipelines',
  '/training/admin?page=records&tab=sessions',
  '/events/admin?tab=create',
  '/scheduling/admin/settings/general',
  '/events',
  '/inventory/admin/pool',
  '/inventory/admin/store?tab=orders',
];
/** About 8em at 16px: enough of a value or placeholder to read what it is. */
const READABLE_PX = 128;
const TOUCH_TABLETS = [
  { name: 'iPad portrait', width: 820, height: 1180 },
  { name: 'iPad landscape', width: 1180, height: 820 },
];

test.describe('Form fields line up on a touch tablet', () => {
  test.use({ hasTouch: true });

  for (const viewport of TOUCH_TABLETS) {
    for (const path of FORM_ROUTES) {
      test(`${path} — ${viewport.name}`, async ({ page }) => {
        const route = ROUTES.find((r) => r.path === path);
        if (!route) throw new Error(`${path} is not in the mobile route list`);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await signInForRoute(page, route, null);
        await page.goto(path);
        await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(400);

        const problems = await page.evaluate((READABLE_PX) => {
          const fields = [
            ...document.querySelectorAll<HTMLElement>(
              'main input:is([type=text], [type=search], [type=email], [type=tel], [type=number], [type=date], [type=url], :not([type])), main select, main textarea'
            ),
          ].filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden';
          });
          const name = (el: HTMLElement) =>
            el.getAttribute('aria-label') || el.id || el.getAttribute('placeholder') || el.tagName.toLowerCase();
          const found: string[] = [];
          const ctx = document.createElement('canvas').getContext('2d');
          const fit = (el: HTMLElement) => {
            if (!ctx || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'date')) {
              return { text: 0, room: Infinity };
            }
            const text =
              el instanceof HTMLSelectElement
                ? (el.selectedOptions[0]?.text ?? '')
                : (el as HTMLInputElement).value || el.getAttribute('placeholder') || '';
            const cs = getComputedStyle(el);
            ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            // A native select draws its arrow inside the content box.
            const arrow = el instanceof HTMLSelectElement && cs.appearance !== 'none' ? 20 : 0;
            const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - arrow;
            return { text: ctx.measureText(text).width, room };
          };

          // Only fields that share a grid or flex container are a "row"; an
          // inline number box inside a sentence is meant to be narrow.
          const container = (el: HTMLElement) => {
            let p = el.parentElement;
            for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
              const display = getComputedStyle(p).display;
              if (display.includes('grid') || display.includes('flex')) return p;
            }
            return null;
          };
          const rows = new Map<Element, HTMLElement[]>();
          for (const field of fields) {
            const c = container(field)?.parentElement;
            if (!c) continue;
            rows.set(c, [...(rows.get(c) ?? []), field]);
          }

          // A field painting over another — the AM/PM picker that ran into
          // the next column. Checked across the whole page, not per row.
          for (const [i, field] of fields.entries()) {
            const b = field.getBoundingClientRect();
            for (const other of fields.slice(i + 1)) {
              if (field.contains(other) || other.contains(field)) continue;
              const o = other.getBoundingClientRect();
              const overlapX = Math.min(b.right, o.right) - Math.max(b.left, o.left);
              const overlapY = Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top);
              if (overlapX > 2 && overlapY > 2) found.push(`"${name(field)}" overlaps "${name(other)}"`);
            }
          }

          // A field must stay inside its own grid cell. The time picker's
          // AM/PM ran out of its column into empty space, which no overlap
          // check sees, and on the right-hand column past the card edge.
          for (const field of fields) {
            let cell: HTMLElement | null = field.parentElement;
            while (cell?.parentElement && !getComputedStyle(cell.parentElement).display.includes('grid')) {
              cell = cell.parentElement;
            }
            if (!cell?.parentElement || cell.tagName === 'MAIN') continue;
            const b = field.getBoundingClientRect();
            const c = cell.getBoundingClientRect();
            if (b.left < c.left - 2 || b.right > c.right + 2) {
              found.push(
                `"${name(field)}" runs ${Math.round(Math.max(c.left - b.left, b.right - c.right))}px out of its column`
              );
            }
          }

          for (const group of rows.values()) {
            if (group.length < 2) continue;
            for (const field of group) {
              const b = field.getBoundingClientRect();
              // Crushed means it can no longer show its own text — not a pixel
              // floor, since an hour or AM/PM picker is narrow by design. A
              // long option may still truncate, as native selects do, provided
              // a readable stretch of it shows.
              const { text, room } = fit(field);
              if (room < Math.min(text, READABLE_PX) - 2) {
                found.push(`"${name(field)}" shows ${Math.round(room)}px of ${Math.round(text)}px of text`);
              }
              for (const other of group) {
                if (other === field) continue;
                const o = other.getBoundingClientRect();
                const sameLine = b.top < o.bottom - 4 && o.top < b.bottom - 4;
                if (sameLine && Math.abs(b.top - o.top) > 3) {
                  found.push(`"${name(field)}" sits ${Math.round(b.top - o.top)}px off "${name(other)}"`);
                }
              }
            }
          }
          return [...new Set(found)];
        }, READABLE_PX);

        expect(problems, `${path} on ${viewport.name}`).toEqual([]);
      });
    }
  }
});
