import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { signIn } from './helpers';
import { BASE_PERMISSIONS, NARROW, PHONE, ROUTES } from './mobile-routes';

/**
 * WCAG conformance over the same routes the presentation pass measures.
 *
 * The presentation pass checks what a phone screen does to a layout — overflow,
 * touch targets, text size. This one checks the things a person using a screen
 * reader, a switch, or a magnifier runs into, which are invisible to a
 * screenshot and to every check that existed before it:
 *
 *   axe WCAG 2.1 A + AA — asserted at zero. Unnamed controls, unlabelled
 *   fields, invalid ARIA, contrast below 4.5:1. This is the AA floor the
 *   application claims, measured on the rendered DOM rather than inferred from
 *   the source. The baseline when it was written was four violations across
 *   the whole application, all critical and all fixed in the same change:
 *   two `aria-controls` values naming ids that could not exist (the nav
 *   submenu id was built from a label with spaces in it, so it parsed as
 *   several ids, none of them real), and the department name and timezone
 *   controls on /settings, whose labels sat beside them without ever being
 *   associated.
 *
 *   axe color-contrast-enhanced (AAA, 7:1) — ratcheted, not asserted at zero.
 *   The shared fills in index.css are all AAA and `primaryFillContrast.test.ts`
 *   holds them there; individual call sites are held to AA. A budget rather
 *   than a rule, so the number can fall and never rise.
 *
 *   Reflow at 320px — asserted at zero. SC 1.4.10 names 320 CSS px, and the
 *   presentation pass measures 390. A layout can fit an iPhone 14 and still
 *   strand content off the edge of the narrowest phone in service.
 *
 * axe is injected from the installed axe-core rather than @axe-core/playwright,
 * which would be a new dependency for the same result.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Per-route budget of AAA-only contrast findings (7:1). Absent means zero.
 *
 * Every entry here is a call site whose colour clears AA and not AAA. Lower a
 * number when you darken one; never raise one.
 */
const AAA_CONTRAST_BUDGET: Record<string, number> = {
  '/dashboard': 6,
  '/members/admin': 1,
  '/scheduling/admin/closeout': 5,
  '/admin-hours': 2,
  '/notifications?tab=inbox': 1,
  '/inventory/admin/checklists': 2,
  '/elections': 1,
  '/admin/analytics': 1,
  '/grants': 7,
  '/reports': 8,
  '/integrations': 1,
  '/admin/public-portal': 3,
  '/onboarding/start': 5,
};

interface AxeViolation {
  id: string;
  impact: string;
  help: string;
  nodes: Array<{ target: string[]; html: string; failureSummary: string }>;
}

test.describe('mobile accessibility', () => {
  test('every feature meets WCAG 2.1 AA and reflows to 320px', async ({ page }) => {
    // ~50 routes, each with a navigation, two axe runs and a reflow
    // measurement. A clean run is about three and a half minutes; the headroom
    // is for CI, where this shares a runner with whatever else is scheduled and
    // a 900s cap was reached by load alone rather than by any route being slow.
    test.setTimeout(1_500_000);
    await page.setViewportSize(PHONE);

    let granted = BASE_PERMISSIONS;
    await signIn(page, { permissions: granted });

    const aaFailures: string[] = [];
    const aaaBusted: string[] = [];
    const reflowed: string[] = [];
    const table: string[] = [];

    for (const route of ROUTES) {
      const needed = route.permissions ? [...BASE_PERMISSIONS, ...route.permissions] : BASE_PERMISSIONS;
      if (needed.join() !== granted.join()) {
        granted = needed;
        await signIn(page, { permissions: granted });
      }

      await page.setViewportSize(PHONE);
      await page.goto(route.path);
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(400);
      await page.addScriptTag({ path: AXE_PATH });

      const { aa, aaa } = await page.evaluate(async (tags) => {
        const axe = (
          window as unknown as {
            axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> };
          }
        ).axe;
        const summarize = (violations: AxeViolation[]) =>
          violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            count: v.nodes.length,
            examples: v.nodes
              .slice(0, 3)
              .map((n) => `${n.target.join(' ')} :: ${n.html.replace(/\s+/g, ' ').slice(0, 120)}`),
          }));
        const aaRun = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
        const aaaRun = await axe.run(document, {
          runOnly: { type: 'rule', values: ['color-contrast-enhanced'] },
          resultTypes: ['violations'],
        });
        return { aa: summarize(aaRun.violations), aaa: summarize(aaaRun.violations) };
      }, AA_TAGS);

      // Reflow is measured by narrowing the rendered page rather than by
      // reloading it: that is what a magnifier or a rotated phone actually does
      // to a live layout, and it exercises the media-query listeners too.
      await page.setViewportSize(NARROW);
      await page.waitForTimeout(250);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const viewportWidth = doc.clientWidth;
        const isVisible = (el: Element) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && b.right > 0 && b.left < viewportWidth;
        };
        return [...document.body.querySelectorAll('*')]
          .filter((el) => {
            if (!isVisible(el) || el.closest('[data-mobile-scroll-region]')) return false;
            const b = el.getBoundingClientRect();
            return b.left < -1 || b.right > viewportWidth + 1;
          })
          .slice(0, 6)
          .map((el) => {
            const b = el.getBoundingClientRect();
            const name = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName)
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 40);
            return `${el.tagName.toLowerCase()}${[...el.classList]
              .slice(0, 2)
              .map((c) => `.${c}`)
              .join('')} "${name}" [left=${Math.round(b.left)}, right=${Math.round(b.right)}]`;
          });
      });

      const aaCount = aa.reduce((sum, v) => sum + v.count, 0);
      const aaaCount = aaa.reduce((sum, v) => sum + v.count, 0);
      const budget = AAA_CONTRAST_BUDGET[route.path] ?? 0;

      if (aaCount > 0) {
        aaFailures.push(
          `${route.path}:\n    ` +
            aa
              .map((v) => `${v.id} (${v.impact}) x${v.count} — ${v.help}\n      ${v.examples.join('\n      ')}`)
              .join('\n    ')
        );
      }
      if (aaaCount > budget) {
        aaaBusted.push(
          `${route.path}: ${aaaCount} nodes below 7:1, budget ${budget}` +
            (aaa[0]?.examples.length ? ` — e.g. ${aaa[0].examples[0]}` : '')
        );
      }
      if (overflow.length) {
        reflowed.push(`${route.path} at ${NARROW.width}px:\n    ${overflow.join('\n    ')}`);
      }

      table.push(
        [
          route.path.padEnd(44),
          `AA ${String(aaCount).padStart(2)}`,
          `AAA ${String(aaaCount).padStart(3)}`,
          `reflow ${String(overflow.length).padStart(2)}`,
        ].join('  ')
      );
    }

    console.log(`\nMobile accessibility — axe at ${PHONE.width}px, reflow at ${NARROW.width}px\n` + table.join('\n'));

    expect(aaFailures, 'routes with WCAG 2.1 A/AA violations').toEqual([]);
    expect(reflowed, `routes with content outside the viewport at ${NARROW.width}px (SC 1.4.10)`).toEqual([]);
    expect(aaaBusted, 'routes that grew AAA-only contrast findings').toEqual([]);
  });
});
