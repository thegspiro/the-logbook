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
 *   Ratcheted budgets — undersized tap targets and sub-12px text are a known
 *   backlog, not something to fix in one go. Each route carries the count
 *   measured when this was written; the assertion is `<=`, so the numbers can
 *   never grow but any improvement passes. Lower the number when you fix some.
 *   This mirrors how `vitest.config.ts` treats coverage thresholds.
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
  /** Interactive elements rendering under 44x44. Ratchet down, never up. */
  maxSmallTargets: number;
  /** Text nodes rendering below 12px. Ratchet down, never up. */
  maxTinyText: number;
  /**
   * Renders only layout chrome under the E2E mock — the permission gate hides
   * the body, or the endpoints it needs are not mocked. Not a defect here, but
   * it does mean this route proves less than the others.
   */
  chromeOnly?: boolean;
}

const ROUTES: RouteCheck[] = [
  { path: '/dashboard', maxSmallTargets: 13, maxTinyText: 9 },
  { path: '/events', maxSmallTargets: 10, maxTinyText: 7 },
  { path: '/members', maxSmallTargets: 9, maxTinyText: 7 },
  { path: '/members/admin', maxSmallTargets: 4, maxTinyText: 7, chromeOnly: true },
  { path: '/documents', maxSmallTargets: 6, maxTinyText: 7 },
  { path: '/training/my-training', maxSmallTargets: 6, maxTinyText: 7 },
  { path: '/training/submit', maxSmallTargets: 19, maxTinyText: 7 },
  { path: '/training/courses', maxSmallTargets: 7, maxTinyText: 7 },
  { path: '/training/programs', maxSmallTargets: 6, maxTinyText: 7 },
  { path: '/scheduling', maxSmallTargets: 6, maxTinyText: 7 },
  { path: '/scheduling/reports', maxSmallTargets: 4, maxTinyText: 7, chromeOnly: true },
  { path: '/admin-hours', maxSmallTargets: 6, maxTinyText: 7 },
  { path: '/notifications?tab=inbox', maxSmallTargets: 10, maxTinyText: 6 },
  { path: '/inventory', maxSmallTargets: 14, maxTinyText: 7 },
  { path: '/inventory/my-equipment', maxSmallTargets: 7, maxTinyText: 7 },
  { path: '/apparatus', maxSmallTargets: 7, maxTinyText: 7 },
  { path: '/apparatus-basic', maxSmallTargets: 3, maxTinyText: 7 },
  { path: '/locations', maxSmallTargets: 4, maxTinyText: 7 },
  { path: '/facilities', maxSmallTargets: 7, maxTinyText: 7 },
  { path: '/elections', maxSmallTargets: 8, maxTinyText: 7 },
  { path: '/minutes', maxSmallTargets: 5, maxTinyText: 7 },
  { path: '/action-items', maxSmallTargets: 5, maxTinyText: 7 },
  { path: '/forms', maxSmallTargets: 4, maxTinyText: 7, chromeOnly: true },
  { path: '/store', maxSmallTargets: 4, maxTinyText: 7 },
  { path: '/prospective-members', maxSmallTargets: 4, maxTinyText: 7, chromeOnly: true },
  { path: '/analytics', maxSmallTargets: 13, maxTinyText: 9 },
  { path: '/messages', maxSmallTargets: 4, maxTinyText: 7, chromeOnly: true },
  { path: '/settings', maxSmallTargets: 4, maxTinyText: 7, chromeOnly: true },
  { path: '/profile', maxSmallTargets: 13, maxTinyText: 9 },
];

/** iPhone 14/15 class — the narrow end of what members actually carry. */
const PHONE = { width: 390, height: 844 };

/** Apple's HIG and WCAG 2.5.5 both land here; the codebase already uses it. */
const MIN_TAP = 44;
const MIN_FONT_PX = 12;

interface Measurement {
  crashed: boolean;
  overflow: boolean;
  scrollWidth: number;
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
    await signIn(page);

    const crashed: string[] = [];
    const overflowed: string[] = [];
    const tapBudgetBusted: string[] = [];
    const textBudgetBusted: string[] = [];
    const blank: string[] = [];
    const table: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route.path);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(400);

      const m: Measurement = await page.evaluate(
        ({ minTap, minFont }) => {
          const doc = document.documentElement;
          const isVisible = (el: Element) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0;
          };

          const targets = [
            ...document.querySelectorAll(
              'button, a[href], [role="button"], select, input:not([type=hidden])',
            ),
          ].filter(isVisible);

          const small = targets.filter((el) => {
            const b = el.getBoundingClientRect();
            // The "skip to main content" link is deliberately 1x1 until
            // focused; counting it would flag every page forever.
            if (b.width <= 2 && b.height <= 2) return false;
            return b.height < minTap || b.width < minTap;
          });

          const tiny = [
            ...document.querySelectorAll('p, span, div, td, li, label'),
          ].filter(
            (el) =>
              isVisible(el) &&
              !!el.textContent?.trim() &&
              parseFloat(getComputedStyle(el).fontSize) < minFont,
          );

          return {
            crashed: document.body.innerText.includes('Oops! Something went wrong'),
            // A page wider than the viewport means something is not fitting: a
            // fixed pixel width, an unwrapped row, a table with no scroller.
            overflow: doc.scrollWidth > doc.clientWidth + 1,
            scrollWidth: doc.scrollWidth,
            textLength: document.body.innerText.trim().length,
            totalTargets: targets.length,
            smallTargets: small.length,
            smallExamples: small.slice(0, 4).map((el) => {
              const b = el.getBoundingClientRect();
              const label = (
                el.getAttribute('aria-label') ||
                (el as HTMLElement).innerText ||
                el.tagName
              )
                .trim()
                .slice(0, 24);
              return `${label} ${Math.round(b.width)}x${Math.round(b.height)}`;
            }),
            tinyText: tiny.length,
          };
        },
        { minTap: MIN_TAP, minFont: MIN_FONT_PX },
      );

      if (m.crashed) crashed.push(route.path);
      if (m.overflow) overflowed.push(`${route.path} (${m.scrollWidth}px wide)`);
      if (m.smallTargets > route.maxSmallTargets) {
        tapBudgetBusted.push(
          `${route.path}: ${m.smallTargets} under ${MIN_TAP}px, budget ${route.maxSmallTargets}` +
            (m.smallExamples.length ? ` — e.g. ${m.smallExamples.join(', ')}` : ''),
        );
      }
      if (m.tinyText > route.maxTinyText) {
        textBudgetBusted.push(
          `${route.path}: ${m.tinyText} nodes under ${MIN_FONT_PX}px, budget ${route.maxTinyText}`,
        );
      }
      // Reported, not asserted: under the E2E mock a page can legitimately be
      // empty, so this cannot distinguish "no data" from "rendered nothing".
      if (!route.chromeOnly && m.textLength < 600) blank.push(route.path);

      table.push(
        [
          route.path.padEnd(28),
          m.crashed ? 'CRASH' : 'ok   ',
          `tap ${String(m.smallTargets).padStart(2)}/${String(m.totalTargets).padEnd(3)}`,
          `tiny ${String(m.tinyText).padStart(2)}`,
          `text ${String(m.textLength).padStart(5)}`,
          route.chromeOnly ? '(chrome only)' : '',
        ].join('  '),
      );
    }

    console.log('\nMobile presentation — 390x844\n' + table.join('\n'));
    if (blank.length) {
      console.log(
        `\nRendered little content (check these are genuinely empty, not broken):\n  ${blank.join('\n  ')}`,
      );
    }

    expect(crashed, 'routes that hit the ErrorBoundary').toEqual([]);
    expect(overflowed, 'routes wider than the viewport').toEqual([]);
    expect(tapBudgetBusted, `routes that grew tap targets under ${MIN_TAP}px`).toEqual([]);
    expect(textBudgetBusted, `routes that grew text under ${MIN_FONT_PX}px`).toEqual([]);
  });
});
