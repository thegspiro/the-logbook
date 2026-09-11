import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { NARROW, PHONE, ROUTES, signInForRoute } from './mobile-routes';
import type { SignInState } from './mobile-routes';

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
 * Why axe is allowed to abstain on a contrast node.
 *
 * Reading only `violations` reported zero for every node axe could not decide,
 * which is a false floor — so the abstentions are collected. But their *count*
 * is not the signal. This app paints its page background as a
 * `linear-gradient`, so axe abstains on essentially every element sitting
 * directly on it: 2,200-odd nodes across the inventory, from the dashboard `h1`
 * down. Ratcheting that number would be noise that moves with the fixture data.
 *
 * The reason is the signal. Each one below is a limitation of the engine rather
 * than a property of the page, and each is covered by something that does not
 * need to sample pixels:
 *
 *   gradient background — `themeGradientContrast.test.ts` measures every text
 *     tier against every gradient stop in all three themes, and
 *     `primaryFillContrast.test.ts` measures the `from-`/`via-`/`to-` stops of
 *     every gradient fill carrying white text.
 *   background image — same: the class strings are measured statically.
 *   content too short — axe declines to judge whether a one- or two-character
 *     node is text at all (an avatar initial, a badge count). Their colours come
 *     from the same utilities and theme tokens the two sweeps above measure.
 *   partially obscured / overlapping — axe cannot resolve a background it
 *     cannot see through. Thirteen nodes, all in overlay-heavy report screens.
 *
 * A reason outside this list means axe hit something none of that covers, and
 * that is worth a person looking at it — which is the whole point of asserting
 * the reason instead of the number.
 */
const ALLOWED_UNDECIDED = [
  /background gradient/i,
  /background image/i,
  /too short to determine/i,
  /partially obscured/i,
  /partially overlaps/i,
];

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
  // One node: the `alert-warning` heading that tells an officer this ladder
  // decides who votes. `--alert-warning-title` is amber-800 on amber-50 and
  // measures 6.83:1 — AA-clean, AAA short by a hair, and the same shortfall the
  // audit log's severity badges carry two entries above. It is a shared token at
  // 65 call sites, so clearing it is a palette decision taken app-wide (see the
  // 2026-08-23 and 2026-09-07 notes in CLAUDE.md), not one this screen makes on
  // its own. Call sites are held to AA by policy.
  '/members/admin/settings/tiers': 1,
  // The scheduling settings sections, measured the first time they went on the
  // pass. Every node is a shared status colour rather than a decision these
  // screens make: `text-*-700` on a matching `/10` tint (the required, optional
  // and apparatus-position badges), `text-theme-text-muted` on
  // `bg-theme-surface-hover`, the `text-violet-600` action links, and white on
  // `bg-violet-600`. All AA-clean — this file asserts that at zero — and short
  // of 7:1. Platoons and Shift Reports are absent because they measure zero.
  //
  // Apparatus is 123 for one reason: it lists every apparatus and resource type
  // the department has and each row carries three or four of those badges. It is
  // the same handful of tokens counted many times over, not a screen with a
  // palette problem of its own.
  //
  // General is 6 rather than the 5 it first measured, and the extra one is a fix
  // rather than a regression: the "Safety" badge beside EVOC enforcement failed
  // AA at emerald-700 and clears it at emerald-800, which moves it out of the
  // asserted count and into this one — exactly what the audit log's amber-800
  // severity badges did five entries above.
  //
  // Platoons briefly had 6 here too, which was the tell that something was
  // wrong: it was General's number, measured twice, because the fixture had
  // platoons off and the page substituted a section. `fixture` and `expectText`
  // in mobile-routes.ts are what stop that, and the real Platoons body has no
  // AAA shortfall at all.
  //
  // Shift Reports is one node counted twice — the active subsection tab,
  // text-violet-700 on bg-violet-500/10, measuring 6.43:1 in the light and
  // high-contrast themes and clean in dark. It appeared without anyone touching
  // a colour: the tab labels used to overlap each other, which axe reports as
  // partially obscured and declines to judge, and laying them out properly is
  // what let it measure them at all.
  '/scheduling/admin/settings/general': 6,
  '/scheduling/admin/settings/apparatus': 123,
  '/scheduling/admin/settings/eligibility': 3,
  '/scheduling/admin/settings/notifications': 17,
  '/scheduling/admin/settings/shift-reports': 2,
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
  reasons: string[];
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

    let granted: SignInState | null = null;

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
        type Check = { message: string };
        type Result = {
          id: string;
          impact: string;
          help: string;
          nodes: Array<{ target: string[]; html: string; any: Check[]; all: Check[]; none: Check[] }>;
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
            // Why axe abstained, verbatim. The count of undecided nodes is not
            // the useful signal — the reason is.
            reasons: [...new Set(v.nodes.flatMap((n) => [...n.any, ...n.all, ...n.none].map((c) => c.message)))],
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
      granted = await signInForRoute(page, route, granted);

      // PhoneMonth's past-day dimming (`isPastDay`) reads the real wall-clock
      // date, so how much of this route renders dimmed depends on the day the
      // suite happens to run on — none on a Sunday, up to six on a Saturday.
      // Freezing to a fixed Monday makes it exactly one prior day, every run.
      //
      // This and the dim's own contrast arrived as two answers to one defect,
      // on separate branches, and both are kept because they cover different
      // ground. The dim measures 7.95:1 (opacity-75 in PhoneMonth), so no date
      // fails AAA whatever the calendar says, which is why there is
      // deliberately no /scheduling entry in AAA_CONTRAST_BUDGET. Freezing the
      // clock is what stops any *other* finding on this route from moving with
      // the date — a budget is a ratchet only while what it counts holds still.
      if (route.path === '/scheduling') {
        await page.clock.setFixedTime(new Date('2026-01-12T12:00:00'));
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
        for (const finding of undecided) {
          for (const reason of finding.reasons) {
            if (ALLOWED_UNDECIDED.some((allowed) => allowed.test(reason))) continue;
            undecidedBusted.push(`${route.path} [${theme}] ${finding.id}: ${reason}`);
          }
        }
        if (undecided.length) {
          undecidedDetail.push(
            `${route.path} [${theme}]: ${undecided.map((v) => `${v.id} x${v.count}`).join(', ')} — ${undecided.flatMap((v) => v.reasons).join('; ')}`
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

      if (route.path === '/scheduling') {
        // No true "uninstall" in Playwright's Clock API (setFixedTime/
        // setSystemTime only) — reset to a fresh real timestamp so later
        // routes in this same loop don't inherit the frozen Jan 2026 date.
        await page.clock.setFixedTime(new Date());
      }
    }

    console.log(
      `\nMobile accessibility — axe at ${PHONE.width}px in ${THEMES.join('/')}, reflow at ${NARROW.width}px\n` +
        table.join('\n')
    );

    if (advisoryDetail.length) {
      console.log('\nBest-practice findings (ratcheted, not asserted):\n  ' + advisoryDetail.join('\n  '));
    }

    if (undecidedDetail.length) {
      console.log(
        '\nContrast axe could not decide, by stated reason (measured by value in themeGradientContrast.test.ts):\n  ' +
          undecidedDetail.join('\n  ')
      );
    }

    // Asserted first: a route that never rendered makes every count below it
    // meaningless, and reporting those counts as clean is the failure mode this
    // whole pass exists to stop.
    expect(notRendered, 'routes audited before their body rendered').toEqual([]);
    expect(aaFailures, 'routes with WCAG A/AA violations in some theme').toEqual([]);
    expect(reflowed, `routes with content outside the viewport at ${NARROW.width}px (SC 1.4.10)`).toEqual([]);
    expect(advisoryBusted, 'routes that grew best-practice findings').toEqual([]);
    expect(aaaBusted, 'routes that grew AAA-only contrast findings').toEqual([]);
    expect(
      [...new Set(undecidedBusted)],
      'contrast nodes axe could not decide for a reason nothing else measures'
    ).toEqual([]);
  });
});
