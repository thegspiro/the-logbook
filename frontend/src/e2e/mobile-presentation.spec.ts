import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * One pass over every feature at phone size, checking each one is presentable.
 *
 * Two kinds of check run per route:
 *
 *   Hard failures — a crash or a horizontally scrolling page is always a bug,
 *   so these assert against zero.
 *
 *   Ratcheted budgets — the assertion is `<=` a per-route count, so numbers can
 *   never grow but any improvement passes. These started as a real backlog —
 *   212 tap targets under 44px and ~200 sub-12px text nodes — and were
 *   ratcheted down as it was cleared. Both are now 0 on every route, which
 *   makes them hard rules rather than budgets: no new control may ship below
 *   the touch minimum, and no ordinary UI text below 12px. This mirrors how
 *   `vitest.config.ts` treats coverage thresholds.
 *
 * Why this catches real defects rather than tautologies: the mock in helpers.ts
 * answers unmatched endpoints with a permissive catch-all, so every page here
 * renders against payloads that do not match what its service layer declares.
 * `api.get<T[]>` asserts a wire format rather than verifying it, so a page that
 * maps or measures a result unchecked dies through the ErrorBoundary instead of
 * rendering empty. Ten routes were crashing when this was written. On a phone
 * that failure mode is realistic — a captive portal on station Wi-Fi or a
 * carrier interception page answers HTTP 200 with an HTML body.
 *
 * Adding a route here is the cheapest way to stop a whole feature silently
 * regressing to a dead screen on mobile.
 */

interface RouteCheck {
  path: string;
  /**
   * Interactive elements rendering under 44x44. Now 0 for every route — treat
   * a failure here as "this control needs a mobile size", not "raise the
   * number". Checkbox and radio inputs are measured by their wrapping <label>,
   * since a native checkbox is 16px by design and cannot be padded.
   */
  maxSmallTargets: number;
  /**
   * Text nodes rendering below 12px. Now 0 everywhere — a failure means new
   * copy needs a mobile size, not a raised number. The 12px floor is applied
   * centrally in index.css for text-[10px]/text-[11px]; genuinely dense
   * fixed-size labels (chart axes, the pattern-builder grid) use smaller
   * arbitrary values and are deliberately exempt there.
   */
  maxTinyText: number;
  /**
   * Permissions this route needs on top of the base grant, when it is gated
   * behind something the base set does not carry.
   *
   * Per-route rather than one wider grant for everyone, because widening the
   * base set changes what *other* routes render: a route that had been quietly
   * measuring the dashboard starts measuring its real body, and any debt that
   * body carries turns this pass red for reasons unrelated to the route being
   * added. Scoping the grant keeps each addition to its own page.
   *
   * The cost is a re-sign-in when the set changes, so keep routes needing the
   * same extras adjacent in the list below.
   */
  permissions?: string[];
}

/** Granted for every route; see the per-route `permissions` note above. */
const BASE_PERMISSIONS = ['inventory.manage', 'facilities.manage'];

const ALL_ROUTES: RouteCheck[] = [
  { path: '/dashboard', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/events', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members/admin', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members/check-in-station', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/documents', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members/1/training', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/admin/audit-log', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/admin?page=dashboard&tab=compliance', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/events/1/monitoring', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/my-training', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/submit', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/courses', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/programs', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/scheduling', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/scheduling/admin', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/scheduling/admin/planning', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/scheduling/admin/reports', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/admin-hours', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/notifications?tab=inbox', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/inventory', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/inventory/my-equipment', maxSmallTargets: 0, maxTinyText: 0 },
  // inventory.check_manage is a distinct grant from inventory.manage, and
  // checkPermission compares literally — without it this hub renders Access
  // Denied, which passes both budgets while measuring an error page.
  {
    path: '/inventory/admin/checklists',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: ['inventory.check_manage'],
  },
  // Also needs settings.manage: its four values are written through the
  // organization-settings endpoint, so the checklist grant is not enough.
  {
    path: '/inventory/admin/checklists/settings',
    maxSmallTargets: 0,
    maxTinyText: 0,
    permissions: ['inventory.check_manage', 'settings.manage'],
  },
  { path: '/apparatus', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/apparatus-basic', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/locations', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/locations/qr-codes', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/facilities', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/facilities/settings', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/governance/org-chart', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/elections', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/minutes', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/action-items', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/forms', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/store', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/prospective-members', maxSmallTargets: 0, maxTinyText: 0 },
  // /analytics and /profile were listed here from the day this file was written
  // and match no <Route>: both fell through the catch-all to the dashboard,
  // which is why the three of them reported an identical 24 targets and 1249
  // characters. The real analytics dashboard is /admin/analytics behind
  // analytics.view; the real account screen is /account, below.
  { path: '/admin/analytics', maxSmallTargets: 0, maxTinyText: 0, permissions: ['analytics.view'] },
  { path: '/messages', maxSmallTargets: 0, maxTinyText: 0 },
  // Without settings.manage this route redirects and the pass measures the
  // dashboard under the name "/settings" — a green line for a page that never
  // rendered. Granting it is what makes the entry mean anything.
  { path: '/settings', maxSmallTargets: 0, maxTinyText: 0, permissions: ['settings.manage'] },
  // The second of the seven SettingsLayout screens, and the only other one that
  // needs no grant. Two screens is what keeps the shared shell honest: a fix to
  // the section strip that only suits one screen's section list fails here.
  //
  // The remaining five are not listed, and each has a reason:
  // /scheduling/admin/settings/*,
  // /elections/settings and /communications/email-templates carry non-shell debt
  // of their own (17, 2 and 4 controls under 44px — mostly `toggle-track`, which
  // is 44x24 at every one of its call sites app-wide), and the events and
  // department-setup panels render inside a hub route rather than at a path of
  // their own. Adding any of them means fixing that debt first, not raising a
  // budget.
  { path: '/account', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/testing', maxSmallTargets: 0, maxTinyText: 0 },
];

// Useful when diagnosing one newly exposed permission-gated body locally;
// omitted in CI and normal runs, where the complete ratchet always executes.
const routeFilter = process.env.MOBILE_ROUTE_FILTER;
const ROUTES = routeFilter ? ALL_ROUTES.filter(({ path }) => path.includes(routeFilter)) : ALL_ROUTES;

/** iPhone 14/15 class — the narrow end of what members actually carry. */
const PHONE = { width: 390, height: 844 };

/** Apple's HIG and WCAG 2.5.5 both land here; the codebase already uses it. */
const MIN_TAP = 44;
const MIN_FONT_PX = 12;

interface Measurement {
  crashed: boolean;
  scrollWidth: number;
  overflowExamples: string[];
  invalidScrollRegions: string[];
  textLength: number;
  totalTargets: number;
  smallTargets: number;
  smallExamples: string[];
  tinyText: number;
}

test.describe('mobile presentation', () => {
  test('every feature is presentable at phone width', async ({ page }) => {
    // ~30 routes, each with a settle delay and a full render.
    test.setTimeout(400_000);
    await page.setViewportSize(PHONE);
    // The fixture user has no permissions by default (`signIn` sets
    // `permissions: []`, overriding TEST_USER's list), so a manager-gated route
    // in the list below redirects and this pass silently measures the
    // dashboard instead of the page it names. `inventory.manage` is granted for
    // /inventory, which is manager-only — without it the run reported
    // "rendered little content" for a page that renders plenty. `facilities.manage`
    // is granted for the same reason: /facilities/settings requires it, and
    // without it that route (and /facilities itself, which only needs
    // facilities.view) would silently measure the dashboard instead.
    let granted = BASE_PERMISSIONS;
    await signIn(page, { permissions: granted });

    const crashed: string[] = [];
    const overflowed: string[] = [];
    const invalidScrollRegions: string[] = [];
    const tapBudgetBusted: string[] = [];
    const textBudgetBusted: string[] = [];
    const blank: string[] = [];
    const table: string[] = [];

    for (const route of ROUTES) {
      // Re-sign-in only when the needed set actually changes, so the common
      // case stays one sign-in for the whole pass.
      const needed = route.permissions ? [...BASE_PERMISSIONS, ...route.permissions] : BASE_PERMISSIONS;
      if (needed.join() !== granted.join()) {
        granted = needed;
        await signIn(page, { permissions: granted });
      }

      await page.goto(route.path);
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(400);

      const m: Measurement = await page.evaluate(
        ({ minTap, minFont }) => {
          const doc = document.documentElement;
          const isVisible = (el: Element) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && b.right > 0 && b.left < doc.clientWidth;
          };

          const targets = [
            ...document.querySelectorAll('button, a[href], [role="button"], select, input:not([type=hidden])'),
          ].filter(isVisible);

          const small = targets.filter((el) => {
            // A checkbox or radio is 16px by design and cannot be padded — the
            // <label> wrapping it is what the finger actually lands on, so
            // measure that instead of flagging every checkbox forever.
            const box =
              (el instanceof HTMLInputElement &&
                (el.type === 'checkbox' || el.type === 'radio') &&
                el.closest('label')) ||
              el;
            const b = box.getBoundingClientRect();
            // The "skip to main content" link is deliberately 1x1 until
            // focused; counting it would flag every page forever.
            if (b.width <= 2 && b.height <= 2) return false;
            return b.height < minTap || b.width < minTap;
          });

          const tiny = [...document.querySelectorAll('p, span, div, td, li, label')].filter(
            (el) => isVisible(el) && !!el.textContent?.trim() && parseFloat(getComputedStyle(el).fontSize) < minFont
          );

          // Intentionally wide tables, charts, timelines, and tab strips opt
          // out at their nearest boundary with data-mobile-scroll-region.
          // Everything else must fit: checking descendant rectangles catches
          // clipped controls even when an ancestor hides the page overflow and
          // documentElement.scrollWidth therefore still equals the viewport.
          const viewportWidth = document.documentElement.clientWidth;
          const overflowing = [...document.body.querySelectorAll('*')].filter((el) => {
            if (!isVisible(el) || el.closest('[data-mobile-scroll-region]')) return false;
            const b = el.getBoundingClientRect();
            return b.left < -1 || b.right > viewportWidth + 1;
          });

          const describe = (el: Element) => {
            const b = el.getBoundingClientRect();
            const name = (
              el.getAttribute('aria-label') ||
              el.getAttribute('title') ||
              (el as HTMLElement).innerText ||
              el.tagName
            )
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 48);
            const identity = [
              el.tagName.toLowerCase(),
              el.id ? `#${el.id}` : '',
              ...[...el.classList].slice(0, 2).map((className) => `.${className}`),
            ].join('');
            return `${identity} "${name}" [left=${Math.round(b.left)}, right=${Math.round(b.right)}, width=${Math.round(b.width)}]`;
          };

          const invalidScrollRegions = [...document.querySelectorAll('[data-mobile-scroll-region]')]
            .filter(isVisible)
            .flatMap((el) => {
              const failures: string[] = [];
              const overflowX = getComputedStyle(el).overflowX;
              if (overflowX !== 'auto' && overflowX !== 'scroll') failures.push(`overflow-x is ${overflowX}`);
              if (!el.getAttribute('aria-label')?.trim() && !el.getAttribute('aria-labelledby')?.trim()) {
                failures.push('has no accessible label');
              }
              if ((el as HTMLElement).tabIndex !== 0) failures.push('is not keyboard focusable');
              return failures.length ? [`${describe(el)}: ${failures.join(', ')}`] : [];
            });

          return {
            crashed: document.body.innerText.includes('Oops! Something went wrong'),
            scrollWidth: doc.scrollWidth,
            overflowExamples: overflowing.slice(0, 8).map(describe),
            invalidScrollRegions,
            textLength: document.body.innerText.trim().length,
            totalTargets: targets.length,
            smallTargets: small.length,
            smallExamples: small.slice(0, 4).map((el) => {
              const b = el.getBoundingClientRect();
              const label = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.tagName)
                .trim()
                .slice(0, 24);
              return `${label} ${Math.round(b.width)}x${Math.round(b.height)}`;
            }),
            tinyText: tiny.length,
          };
        },
        { minTap: MIN_TAP, minFont: MIN_FONT_PX }
      );

      if (m.crashed) crashed.push(route.path);
      if (m.overflowExamples.length) {
        overflowed.push(
          `${route.path} (page scroll width ${m.scrollWidth}px):\n    ${m.overflowExamples.join('\n    ')}`
        );
      }
      if (m.invalidScrollRegions.length) {
        invalidScrollRegions.push(`${route.path}:\n    ${m.invalidScrollRegions.join('\n    ')}`);
      }
      if (m.smallTargets > route.maxSmallTargets) {
        tapBudgetBusted.push(
          `${route.path}: ${m.smallTargets} under ${MIN_TAP}px, budget ${route.maxSmallTargets}` +
            (m.smallExamples.length ? ` — e.g. ${m.smallExamples.join(', ')}` : '')
        );
      }
      if (m.tinyText > route.maxTinyText) {
        textBudgetBusted.push(`${route.path}: ${m.tinyText} nodes under ${MIN_FONT_PX}px, budget ${route.maxTinyText}`);
      }
      // Reported, not asserted: under the E2E mock a page can legitimately be
      // empty, so this cannot distinguish "no data" from "rendered nothing".
      if (m.textLength < 600) blank.push(route.path);

      table.push(
        [
          route.path.padEnd(28),
          m.crashed ? 'CRASH' : 'ok   ',
          `tap ${String(m.smallTargets).padStart(2)}/${String(m.totalTargets).padEnd(3)}`,
          `tiny ${String(m.tinyText).padStart(2)}`,
          `text ${String(m.textLength).padStart(5)}`,
          m.smallExamples.join(', '),
        ].join('  ')
      );
    }

    console.log('\nMobile presentation — 390x844\n' + table.join('\n'));
    if (blank.length) {
      console.log(`\nRendered little content (check these are genuinely empty, not broken):\n  ${blank.join('\n  ')}`);
    }

    expect(crashed, 'routes that hit the ErrorBoundary').toEqual([]);
    expect(overflowed, 'routes with visible elements extending outside the viewport').toEqual([]);
    expect(invalidScrollRegions, 'intentional scroll regions that break the accessibility contract').toEqual([]);
    expect(tapBudgetBusted, `routes that grew tap targets under ${MIN_TAP}px`).toEqual([]);
    expect(textBudgetBusted, `routes that grew text under ${MIN_FONT_PX}px`).toEqual([]);
  });
});
