import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { signIn } from './helpers';
import { BASE_PERMISSIONS, NARROW, PHONE, ROUTES } from './mobile-routes';

/**
 * WCAG conformance over the same routes the presentation pass measures.
 *
 * The presentation pass checks what a phone screen does to a layout — overflow,
 * touch targets, text size. This one checks what a person using a screen
 * reader, a switch, a magnifier or a high-contrast display runs into, none of
 * which is visible in a screenshot.
 *
 * Five measurements per route:
 *
 *   1. axe WCAG 2.1 + 2.2, A and AA — asserted at zero, in the light theme.
 *      The AA floor the application claims, measured on the rendered DOM
 *      rather than inferred from source.
 *
 *   2. axe contrast in dark and high-contrast — also asserted at zero. Contrast
 *      is the one thing that changes with the theme, so measuring only the
 *      light one says nothing about the other two. High-contrast had no test
 *      coverage anywhere in the repository before this, and it is the mode
 *      somebody turns on *because* they need contrast: it was carrying four AA
 *      failures, from `text-red-600` (4.35:1 on black) used where the
 *      theme-aware `--accent-red` token belongs.
 *
 *   3. axe best-practice + WCAG 2.2 AA — ratcheted per route. These are the
 *      screen-reader navigation rules: heading order, landmarks, region,
 *      dialog names, target-size. None had ever run. The first run found 132
 *      findings, dominated by one structural bug — `AppLayout` declared
 *      `role="main"` and 41 pages inside it declared a second `<main>`, so
 *      every one of those routes shipped two main landmarks, nested.
 *
 *   4. axe color-contrast-enhanced (AAA, 7:1) — ratcheted per route. The shared
 *      fills in index.css are all AAA and `primaryFillContrast.test.ts` holds
 *      them there; individual call sites are held to AA.
 *
 *   5. Reflow at 320px — asserted at zero. SC 1.4.10 names 320 CSS px, and the
 *      presentation pass measures 390. A layout can fit an iPhone 14 and still
 *      strand content off the edge of the narrowest phone in service.
 *
 * axe is injected from the installed axe-core rather than @axe-core/playwright,
 * which would be a new dependency for the same result.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/** The asserted floor: A and AA, across WCAG 2.0, 2.1 and 2.2. */
const AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Advisory rules — ratcheted rather than asserted. See #3 above. */
const ADVISORY_TAGS = ['best-practice'];

const CONTRAST_RULES = ['color-contrast', 'color-contrast-enhanced'];

/**
 * Per-route budget of advisory (best-practice) findings. Absent means zero.
 *
 * Lower a number when you clear one; never raise one. A rule that reaches zero
 * everywhere is worth promoting into AA_TAGS' assertion instead.
 */
const ADVISORY_BUDGET: Record<string, number> = {
  '/dashboard': 1,
  '/scheduling/admin/closeout': 1,
  '/notifications?tab=inbox': 1,
  '/inventory/admin/checklists': 1,
  '/apparatus': 1,
  '/apparatus-basic': 1,
  '/locations': 1,
  '/locations/qr-codes': 1,
  '/minutes': 1,
  '/prospective-members': 1,
  '/reports': 1,
  '/admin/public-portal': 1,
};

/**
 * Per-route budget of AAA-only contrast findings (7:1), summed across all three
 * themes. Every entry is a call site whose colour clears AA and not AAA.
 */
/**
 * Per-route budget of contrast nodes axe reported as *undecided*, summed across
 * all three themes.
 *
 * These are not passes. axe files a node here when it cannot compute the ratio
 * — text over a CSS gradient or an image, a partly transparent fill — and
 * counting them as clean is how a gradient CTA slips through a pass that claims
 * an AA floor. They are ratcheted rather than asserted at zero because
 * resolving one takes a human looking at the rendered pixels, and the ratchet
 * is what stops the set growing while that happens.
 */
const UNDECIDED_CONTRAST_BUDGET: Record<string, number> = {};

const AAA_CONTRAST_BUDGET: Record<string, number> = {
  '/dashboard': 9,
  '/members/admin': 3,
  // Both render substantive bodies now that helpers.ts serves them a
  // correctly shaped payload; before, each measured an empty state.
  // 2, not 1: raising the warning badge to amber-800 cleared its AA failure
  // (4.47:1) and left it AAA-only (6.31:1), which is where the other two
  // severity badges already sit. Call sites are held to AA by policy.
  '/admin/audit-log': 2,
  '/events/1/monitoring': 1,
  '/scheduling/admin/closeout': 5,
  '/admin-hours': 2,
  '/notifications?tab=inbox': 3,
  '/inventory/admin/checklists': 6,
  '/elections': 3,
  '/admin/analytics': 1,
  '/grants': 12,
  '/reports': 8,
  '/integrations': 3,
  '/admin/public-portal': 2,
  '/onboarding/start': 5,
};

interface Summary {
  id: string;
  impact: string;
  help: string;
  count: number;
  examples: string[];
}

type Theme = 'light' | 'dark' | 'high-contrast';

const THEMES: Theme[] = ['light', 'dark', 'high-contrast'];

test.describe('mobile accessibility', () => {
  // No retries. This audit is deterministic — it drives mocked routes, so a
  // failure is a finding, not a flake — and a clean run is around ten minutes.
  // The `frontend-e2e` job is capped at 30 minutes for the whole suite, so the
  // config's two CI retries would spend the entire budget re-deriving the same
  // result and replace the assertion's report with a job timeout.
  test.describe.configure({ retries: 0 });

  test('every feature meets WCAG AA in every theme and reflows to 320px', async ({ page }) => {
    // ~50 routes, each rendered in three themes with an axe run apiece. A clean
    // run is around ten minutes; the headroom is for CI, where this shares a
    // runner and a tighter cap was once reached by load alone.
    test.setTimeout(2_400_000);

    let granted = BASE_PERMISSIONS;
    await signIn(page, { permissions: granted });

    /**
     * Both of axe's result arrays, from one run.
     *
     * `incomplete` is the one a pass like this quietly loses. When axe cannot
     * compute a result it does not report a violation — it files the node under
     * `incomplete` with a reason, and text over a CSS gradient (`bgGradient`)
     * is the common case here, the onboarding CTA among them. Reading only
     * `violations` therefore reports zero for the nodes nobody has measured,
     * which is the same false assurance this whole change is about.
     */
    const runAxe = async (options: unknown): Promise<{ violations: Summary[]; incomplete: Summary[] }> => {
      await page.addScriptTag({ path: AXE_PATH });
      return page.evaluate(async (opts) => {
        type Result = {
          id: string;
          impact: string;
          help: string;
          nodes: Array<{ target: string[]; html: string }>;
        };
        const axe = (
          window as unknown as {
            axe: {
              run: (context: Document, options: unknown) => Promise<{ violations: Result[]; incomplete: Result[] }>;
            };
          }
        ).axe;
        const summarise = (results: Result[]) =>
          results.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            count: v.nodes.length,
            examples: v.nodes
              .slice(0, 2)
              .map((n) => `${n.target.join(' ')} :: ${n.html.replace(/\s+/g, ' ').slice(0, 120)}`),
          }));
        const result = await axe.run(document, opts);
        return { violations: summarise(result.violations), incomplete: summarise(result.incomplete) };
      }, options);
    };

    const setTheme = (theme: Theme) => page.evaluate((t) => localStorage.setItem('theme-preference', t), theme);

    const aaFailures: string[] = [];
    const advisoryBusted: string[] = [];
    const aaaBusted: string[] = [];
    const reflowed: string[] = [];
    const advisoryDetail: string[] = [];
    const undecidedDetail: string[] = [];
    const undecidedBusted: string[] = [];
    const notRendered: string[] = [];
    const table: string[] = [];

    for (const route of ROUTES) {
      const needed = route.permissions ? [...BASE_PERMISSIONS, ...route.permissions] : BASE_PERMISSIONS;
      if (needed.join() !== granted.join()) {
        granted = needed;
        await signIn(page, { permissions: granted });
      }

      await page.setViewportSize(PHONE);
      let aaCount = 0;
      let aaaCount = 0;
      let advisoryCount = 0;
      let undecidedCount = 0;
      const perTheme: string[] = [];

      for (const theme of THEMES) {
        await setTheme(theme);
        // First theme lands via goto; the rest need a reload to re-read the
        // preference, which is also what a real theme switch does to the page.
        if (theme === 'light') await page.goto(route.path);
        else await page.reload();
        await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
        // The `networkidle` timeout above is swallowed on purpose — several
        // routes hold a long-poll open and never reach idle — so it cannot be
        // what says the page is ready. Without this, a slow chunk on a loaded
        // runner meant auditing `PageLoadingFallback`'s spinner and reporting
        // zero violations for a screen that had not rendered.
        const ready = await page
          .waitForFunction(
            () => {
              if (document.querySelector('.page-loading-fallback')) return false;
              const main = document.getElementById('main-content');
              if (!main) return false;
              return !!main.querySelector('h1, h2, h3') || (main.innerText ?? '').trim().length > 40;
            },
            undefined,
            { timeout: 15_000 }
          )
          .then(() => true)
          .catch(() => false);
        if (!ready) {
          notRendered.push(`${route.path} [${theme}] never left its loading state`);
          continue;
        }
        await page.waitForTimeout(350);

        // Everything but contrast is theme-independent, so the full rule sets
        // run once, in light. The other two themes measure contrast only.
        const rules = theme === 'light' ? { type: 'tag', values: [...AA_TAGS, ...ADVISORY_TAGS] } : null;
        if (rules) {
          const all = (await runAxe({ runOnly: rules, resultTypes: ['violations'] })).violations;
          const advisoryIds = new Set(
            (
              await runAxe({ runOnly: { type: 'tag', values: ADVISORY_TAGS }, resultTypes: ['violations'] })
            ).violations.map((v) => v.id)
          );
          const aa = all.filter((v) => !advisoryIds.has(v.id));
          const advisory = all.filter((v) => advisoryIds.has(v.id));
          aaCount += aa.reduce((sum, v) => sum + v.count, 0);
          advisoryCount = advisory.reduce((sum, v) => sum + v.count, 0);
          if (aa.length) {
            aaFailures.push(
              `${route.path} [${theme}]:\n    ` +
                aa
                  .map((v) => `${v.id} (${v.impact}) x${v.count} — ${v.help}\n      ${v.examples.join('\n      ')}`)
                  .join('\n    ')
            );
          }
          if (advisory.length) {
            // Named, not just counted: a budget that says "1" tells you nothing
            // about which rule, and these cluster — one shared component is
            // usually behind the same finding on twenty routes.
            advisoryDetail.push(
              `${route.path}: ${advisory.map((v) => `${v.id} x${v.count}`).join(', ')}\n      ${advisory[0]?.examples[0] ?? ''}`
            );
          }
        }

        // One run, both arrays: a second axe pass per route per theme would add
        // a third to this test's wall clock for a result the first already has.
        const { violations: contrast, incomplete: undecided } = await runAxe({
          runOnly: { type: 'rule', values: CONTRAST_RULES },
          resultTypes: ['violations', 'incomplete'],
        });
        undecidedCount += undecided.reduce((sum, v) => sum + v.count, 0);
        if (undecided.length) {
          undecidedDetail.push(
            `${route.path} [${theme}]: ${undecided.map((v) => `${v.id} x${v.count}`).join(', ')}\n      ${undecided[0]?.examples[0] ?? ''}`
          );
        }
        const themeAa = contrast.filter((v) => v.id === 'color-contrast');
        const themeAaa = contrast.find((v) => v.id === 'color-contrast-enhanced')?.count ?? 0;
        aaaCount += themeAaa;
        // The light theme's contrast is already inside the AA run above; only
        // the other two need reporting here, or every finding is counted twice.
        if (theme !== 'light' && themeAa.length) {
          aaCount += themeAa.reduce((sum, v) => sum + v.count, 0);
          aaFailures.push(
            `${route.path} [${theme}] contrast:\n    ` +
              themeAa.map((v) => `${v.id} x${v.count}\n      ${v.examples.join('\n      ')}`).join('\n    ')
          );
        }
        perTheme.push(`${theme[0]}:${themeAaa}`);
      }

      // Reflow is measured by narrowing the rendered page rather than by
      // reloading it: that is what a magnifier or a rotated phone does to a
      // live layout, and it exercises the media-query listeners too.
      await setTheme('light');
      await page.setViewportSize(NARROW);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const viewportWidth = doc.clientWidth;
        const isVisible = (el: Element) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        };
        // Overflow is directional, and the two edges mean different things.
        //
        // Past the RIGHT edge is the reflow defect, and it counts even when the
        // element sits entirely beyond the viewport — requiring it to intersect
        // first discards the very worst case, content stranded wholly
        // off-screen.
        //
        // Past the LEFT edge only counts when the element still reaches into
        // the viewport. A closed navigation drawer is parked at left=-256,
        // right=0 by design; flagging that reports the shell of the app as a
        // reflow bug on every route.
        const overflows = (b: DOMRect) => b.right > viewportWidth + 1 || (b.left < -1 && b.right > 0);
        return [...document.body.querySelectorAll('*')]
          .filter((el) => {
            if (!isVisible(el) || el.closest('[data-mobile-scroll-region]')) return false;
            return overflows(el.getBoundingClientRect());
          })
          .slice(0, 6)
          .map((el) => {
            const b = el.getBoundingClientRect();
            const name = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName)
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 40);
            const classes = [...el.classList]
              .slice(0, 2)
              .map((c) => `.${c}`)
              .join('');
            return `${el.tagName.toLowerCase()}${classes} "${name}" [left=${Math.round(b.left)}, right=${Math.round(b.right)}]`;
          });
      });

      if (overflow.length) {
        reflowed.push(`${route.path} at ${NARROW.width}px:\n    ${overflow.join('\n    ')}`);
      }
      const advisoryBudget = ADVISORY_BUDGET[route.path] ?? 0;
      if (advisoryCount > advisoryBudget) {
        advisoryBusted.push(`${route.path}: ${advisoryCount} advisory findings, budget ${advisoryBudget}`);
      }
      const aaaBudget = AAA_CONTRAST_BUDGET[route.path] ?? 0;
      if (aaaCount > aaaBudget) {
        aaaBusted.push(`${route.path}: ${aaaCount} nodes below 7:1 across themes, budget ${aaaBudget}`);
      }
      const undecidedBudget = UNDECIDED_CONTRAST_BUDGET[route.path] ?? 0;
      if (undecidedCount > undecidedBudget) {
        undecidedBusted.push(
          `${route.path}: ${undecidedCount} contrast nodes axe could not decide across themes, budget ${undecidedBudget}`
        );
      }

      table.push(
        [
          route.path.padEnd(44),
          `AA ${String(aaCount).padStart(2)}`,
          `adv ${String(advisoryCount).padStart(3)}`,
          `AAA ${String(aaaCount).padStart(3)}`,
          `undec ${String(undecidedCount).padStart(2)}`,
          `reflow ${String(overflow.length).padStart(2)}`,
          perTheme.join(' '),
        ].join('  ')
      );
    }

    console.log(
      `\nMobile accessibility — axe at ${PHONE.width}px in ${THEMES.join('/')}, reflow at ${NARROW.width}px\n` +
        table.join('\n')
    );

    if (advisoryDetail.length) {
      console.log('\nBest-practice findings (ratcheted, not asserted):\n  ' + advisoryDetail.join('\n  '));
    }

    if (undecidedDetail.length) {
      console.log('\nContrast axe could not decide (ratcheted, needs a human eye):\n  ' + undecidedDetail.join('\n  '));
    }

    // Asserted first: a route that never rendered makes every count below it
    // meaningless, and reporting those counts as clean is the failure mode this
    // whole pass exists to stop.
    expect(notRendered, 'routes audited before their body rendered').toEqual([]);
    expect(aaFailures, 'routes with WCAG A/AA violations in some theme').toEqual([]);
    expect(reflowed, `routes with content outside the viewport at ${NARROW.width}px (SC 1.4.10)`).toEqual([]);
    expect(advisoryBusted, 'routes that grew best-practice findings').toEqual([]);
    expect(aaaBusted, 'routes that grew AAA-only contrast findings').toEqual([]);
    expect(undecidedBusted, 'routes that grew contrast nodes axe could not decide').toEqual([]);
  });
});
