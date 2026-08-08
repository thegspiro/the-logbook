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
   * Renders only layout chrome under the E2E mock — the permission gate hides
   * the body, or the endpoints it needs are not mocked. Not a defect here, but
   * it does mean this route proves less than the others.
   */
  chromeOnly?: boolean;
}

const ROUTES: RouteCheck[] = [
  { path: '/dashboard', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/events', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/members/admin', maxSmallTargets: 0, maxTinyText: 0, chromeOnly: true },
  { path: '/documents', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/my-training', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/submit', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/courses', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/training/programs', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/scheduling', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/scheduling/reports', maxSmallTargets: 0, maxTinyText: 0, chromeOnly: true },
  { path: '/admin-hours', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/notifications?tab=inbox', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/inventory', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/inventory/my-equipment', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/apparatus', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/apparatus-basic', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/locations', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/facilities', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/elections', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/minutes', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/action-items', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/forms', maxSmallTargets: 0, maxTinyText: 0, chromeOnly: true },
  { path: '/store', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/prospective-members', maxSmallTargets: 0, maxTinyText: 0, chromeOnly: true },
  { path: '/analytics', maxSmallTargets: 0, maxTinyText: 0 },
  { path: '/messages', maxSmallTargets: 0, maxTinyText: 0, chromeOnly: true },
  { path: '/settings', maxSmallTargets: 0, maxTinyText: 0, chromeOnly: true },
  { path: '/profile', maxSmallTargets: 0, maxTinyText: 0 },
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
