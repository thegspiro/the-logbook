import { test, expect } from '@playwright/test';
import { MIN_FONT_PX, MIN_TAP, PHONE, ROUTES, signInForRoute } from './mobile-routes';
import type { SignInState } from './mobile-routes';

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
 * The route list lives in ./mobile-routes.ts, shared with the accessibility
 * pass and the coverage-integrity check.
 *
 * Adding a route there is the cheapest way to stop a whole feature silently
 * regressing to a dead screen on mobile.
 */

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
    let granted: SignInState | null = null;

    const crashed: string[] = [];
    const wrongPage: string[] = [];
    const unchangedStates: string[] = [];
    const overflowed: string[] = [];
    const invalidScrollRegions: string[] = [];
    const tapBudgetBusted: string[] = [];
    const textBudgetBusted: string[] = [];
    const blank: string[] = [];
    const table: string[] = [];

    for (const route of ROUTES) {
      // Re-signs only when what the route needs actually changed, so the common
      // case stays one sign-in for the whole pass.
      granted = await signInForRoute(page, route, granted);

      await page.goto(route.path);
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(400);

      // Did this visit reach the page the entry names? Every budget below is
      // meaningless on a route that quietly rendered something else, and this
      // pass has shipped that twice: /analytics and /profile reporting the
      // dashboard's numbers, and /scheduling/admin/settings/platoons reporting
      // General's because the fixture had platoons off and the page substituted
      // a section. Opt-in per route via `expectText`, since most routes have no
      // second page they could plausibly be confused with.
      //
      // `exact: true`, and it is the whole difference between a check and a
      // decoration. The first version of this used the default substring match,
      // which is case-insensitive, so "Platoon Roster" — the heading of the
      // panel that was not rendering — was satisfied by the General tab's own
      // body copy, "...and show platoon rosters on shifts". The guard passed on
      // exactly the page it was written to catch.
      if (route.expectText && !(await page.getByText(route.expectText, { exact: true }).first().isVisible())) {
        wrongPage.push(`${route.path}: expected text "${route.expectText}" is not on the page`);
      }

      const measure = (): Promise<Measurement> =>
        page.evaluate(
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
              // WCAG 2.5.5 and 2.5.8 both carve out the Inline case: "the target
              // is in a sentence, or its size is otherwise constrained by the
              // line-height of non-target text." A link inside running prose
              // cannot be padded to 44px without breaking the paragraph it sits
              // in, and enlarging it is not what the rule asks for. Detected as
              // an anchor with non-whitespace text beside it in the same
              // parent — which is what "in a sentence" means structurally.
              // A sibling *text node* specifically, not a sibling element: a row
              // of `<a>Edit</a> <a>Delete</a>` would otherwise have each link
              // excuse the other, which is a row of controls, not a sentence.
              if (el.tagName === 'A' && el.parentElement) {
                const inSentence = [...el.parentElement.childNodes].some(
                  (node) => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()
                );
                if (inSentence) return false;
              }
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
                // WCAG 2.1.1 asks that the off-screen end be reachable without a
                // mouse, not specifically that the container be focusable. A
                // strip of buttons already satisfies it — tabbing to the last
                // button scrolls it into view — and forcing tabIndex=0 on top of
                // that adds a redundant stop. It is actively wrong on a
                // `role="tablist"`, which ARIA APG requires to stay out of the
                // tab order because its tabs use roving tabindex.
                //
                // So the container must be focusable only when nothing inside it
                // is: a wide table, a chart, a timeline. That is the case the
                // rule was written for and it still fails here.
                const focusableChild = el.querySelector(
                  'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if ((el as HTMLElement).tabIndex !== 0 && !focusableChild) {
                  failures.push('is not keyboard reachable: give it tabIndex={0} or focusable children');
                }
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

      // `label` rather than `route.path`, because a route can be measured more
      // than once: once on arrival, then once per state below. Everything a
      // failure prints has to say *which* of those it came from, or a red run
      // sends someone looking at the wrong screen.
      const record = (label: string, m: Measurement) => {
        if (m.crashed) crashed.push(label);
        if (m.overflowExamples.length) {
          overflowed.push(`${label} (page scroll width ${m.scrollWidth}px):\n    ${m.overflowExamples.join('\n    ')}`);
        }
        if (m.invalidScrollRegions.length) {
          invalidScrollRegions.push(`${label}:\n    ${m.invalidScrollRegions.join('\n    ')}`);
        }
        if (m.smallTargets > route.maxSmallTargets) {
          tapBudgetBusted.push(
            `${label}: ${m.smallTargets} under ${MIN_TAP}px, budget ${route.maxSmallTargets}` +
              (m.smallExamples.length ? ` — e.g. ${m.smallExamples.join(', ')}` : '')
          );
        }
        if (m.tinyText > route.maxTinyText) {
          textBudgetBusted.push(`${label}: ${m.tinyText} nodes under ${MIN_FONT_PX}px, budget ${route.maxTinyText}`);
        }
        // Reported, not asserted: under the E2E mock a page can legitimately be
        // empty, so this cannot distinguish "no data" from "rendered nothing".
        if (m.textLength < 600) blank.push(label);

        table.push(
          [
            label.padEnd(28),
            m.crashed ? 'CRASH' : 'ok   ',
            `tap ${String(m.smallTargets).padStart(2)}/${String(m.totalTargets).padEnd(3)}`,
            `tiny ${String(m.tinyText).padStart(2)}`,
            `text ${String(m.textLength).padStart(5)}`,
            m.smallExamples.join(', '),
          ].join('  ')
        );
      };

      record(route.path, await measure());

      // Drive the route's other states, if it has any. See `states` in
      // mobile-routes.ts for why arrival alone is not the whole of a screen.
      if (route.states) {
        const { selector, label: stateLabel, max } = route.states;
        // Only what a phone can actually see. These panels ship a `md:hidden`
        // strip and a desktop `<aside>` holding the same controls, and the
        // hidden copy is still in the DOM — enumerating both drives the loop
        // into elements that will never become clickable.
        const controls = page.locator(selector).filter({ visible: true });
        const count = Math.min(await controls.count(), max ?? Number.MAX_SAFE_INTEGER);
        const seen = new Set<string>();
        for (let i = 0; i < count; i++) {
          const control = controls.nth(i);
          const name = (await control.innerText().catch(() => '')).trim() || `${stateLabel} ${i + 1}`;
          // Dispatched on the element, not aimed at a point on the screen.
          // These strips scroll smoothly, so an ordinary click never passes the
          // stability check, and `{ force: true }` is worse than it looks: force
          // skips the actionability checks but Playwright still computes a click
          // point first, and the strip slides out from under it — every click
          // landed on the neighbouring tab, so seven tabs produced five distinct
          // screens and two subsections were measured twice under the wrong
          // names. The trade is that a synthetic click skips hit-testing, so an
          // overlay covering a control would go unnoticed here; this pass
          // measures geometry, and mis-measuring the wrong screen is the worse
          // failure of the two.
          await control.dispatchEvent('click');
          await page.waitForTimeout(350);
          const m = await measure();

          // A state that did not change the page is not a state. Without this,
          // the bug above stayed silent: a subsection never reached still gets a
          // row and a green budget, which is the whole failure this pass exists
          // to stop, one level in.
          const fingerprint = `${m.textLength}:${m.totalTargets}`;
          if (seen.has(fingerprint)) {
            unchangedStates.push(`${route.path} [${name}]: rendered the same content as an earlier state`);
          }
          seen.add(fingerprint);

          record(`${route.path} [${name}]`, m);
        }
      }
    }

    console.log('\nMobile presentation — 390x844\n' + table.join('\n'));
    if (blank.length) {
      console.log(`\nRendered little content (check these are genuinely empty, not broken):\n  ${blank.join('\n  ')}`);
    }

    expect(crashed, 'routes that hit the ErrorBoundary').toEqual([]);
    // Before the budgets: a route measuring the wrong page makes every number
    // below it a statement about somewhere else.
    expect(wrongPage, 'routes that did not render the page their entry names').toEqual([]);
    expect(unchangedStates, 'driven states that rendered content already measured').toEqual([]);
    expect(overflowed, 'routes with visible elements extending outside the viewport').toEqual([]);
    expect(invalidScrollRegions, 'intentional scroll regions that break the accessibility contract').toEqual([]);
    expect(tapBudgetBusted, `routes that grew tap targets under ${MIN_TAP}px`).toEqual([]);
    expect(textBudgetBusted, `routes that grew text under ${MIN_FONT_PX}px`).toEqual([]);
  });
});
