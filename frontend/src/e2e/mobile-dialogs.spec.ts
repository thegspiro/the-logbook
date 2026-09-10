import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { NARROW, PHONE, ROUTES, signInForRoute } from './mobile-routes';
import type { SignInState } from './mobile-routes';

/**
 * The dialogs, measured — not just the routes that open them.
 *
 * The presentation and accessibility passes only ever see a route's landing
 * state. A dialog is where the things they check actually bite: it is the
 * densest form layout in the application, it traps focus, and it is the one
 * surface that can render taller than the viewport with no way to reach either
 * end (see Pitfall #21).
 *
 * This walks each route, clicks every create-shaped control in the page body in
 * turn, and measures whatever dialog opens. It found three defects on its first
 * run: the Add Station and Add Requirement dialogs had no accessible name (a
 * screen reader announces "dialog", and nothing else), and Add Station and Add
 * Facility had eleven form fields between them whose visible labels were never
 * associated with their inputs.
 *
 * Two things it must get right, both learned by getting them wrong:
 *
 *   The opener is searched for inside `#main-content` only. Searched over the
 *   whole document, the bottom navigation's global "Add" sorts first on nearly
 *   every route, and the pass then measures one quick-add sheet forty-two times
 *   while reporting it as forty-two dialogs.
 *
 *   The dialog measured is the last one in the DOM, not the first.
 *   `querySelector('[role="dialog"]')` returns whichever is earliest in source
 *   order, which on a page holding more than one is not the one that just
 *   opened — that reported the focus trap as broken on a dialog whose trap
 *   works.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

/**
 * Labels that open something, as opposed to submitting or navigating.
 *
 * `receive`, `issue`, `assign`, `import` and `generate` are here because a
 * create-shaped control does not always start with "Add": medical supplies'
 * second dialog is "Receive delivery", and measuring only the openers that
 * happened to be phrased as additions left it out of a pass named "every
 * dialog".
 */
const OPENER = /^(add|new|create|record|log|invite|upload|schedule|request|receive|issue|assign|import|generate)\b/i;

const AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * A ceiling per route, so a screen with a long toolbar cannot turn one pass
 * into a hundred dialogs and push the shared E2E job past its 30-minute cap.
 * No route in the inventory currently reaches it.
 */
const MAX_OPENERS_PER_ROUTE = 6;

test.describe('mobile dialogs', () => {
  // No retries. Every request is mocked, so a failure here is a finding, not a
  // flake, and a re-run costs the shared `frontend-e2e` budget twice over.
  test.describe.configure({ retries: 0 });

  test('every dialog is named, labelled and fits a phone', async ({ page }) => {
    test.setTimeout(1_800_000);

    let granted: SignInState | null = null;

    const unnamed: string[] = [];
    const axeFailures: string[] = [];
    const unreachable: string[] = [];
    const overflowing: string[] = [];
    const measured: string[] = [];
    const seen = new Set<string>();

    /**
     * Click the nth opener on the current route and measure whatever it opens.
     *
     * Indexed rather than held as an element handle: Escape re-renders the page
     * body on several routes, so a handle taken before the first dialog is
     * stale by the second. The order is stable within a route because the query
     * is the same and the landing state is restored between dialogs; the label
     * is re-read after the click so the report names what was actually opened.
     */
    const measureNthOpener = async (routePath: string, index: number): Promise<void> => {
      const opened = await page.evaluate(
        ({ source, nth }) => {
          const re = new RegExp(source, 'i');
          const root = document.getElementById('main-content') ?? document.body;
          const el = [...root.querySelectorAll('button, [role="button"]')].filter((candidate) => {
            const box = candidate.getBoundingClientRect();
            if (box.width <= 0 || box.height <= 0) return false;
            const name = ((candidate as HTMLElement).innerText || candidate.getAttribute('aria-label') || '').trim();
            return re.test(name);
          })[nth];
          if (!el) return null;
          const label = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40);
          (el as HTMLElement).click();
          return label;
        },
        { source: OPENER.source, nth: index }
      );

      if (!opened) return;
      // A route often carries the same opener twice — a header button and the
      // empty state's own call to action — and measuring one dialog twice just
      // doubles its findings in the report.
      const key = `${routePath}::${opened}`;
      if (seen.has(key)) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        return;
      }
      seen.add(key);
      await page.waitForTimeout(700);

      const shape = await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter((d) => {
          const b = d.getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        });
        const panel = dialogs[dialogs.length - 1];
        if (!panel) return null;
        const viewportHeight = window.innerHeight;
        const inner =
          [...panel.querySelectorAll('*')].find((el) => {
            const b = el.getBoundingClientRect();
            return b.height > 80 && b.width > 100;
          }) ?? panel;
        const box = inner.getBoundingClientRect();
        const style = getComputedStyle(inner);
        return {
          named: !!(panel.getAttribute('aria-label')?.trim() || panel.getAttribute('aria-labelledby')?.trim()),
          // Both ends must be reachable: a panel centred by flex that outgrows
          // the viewport overflows in both directions and no scrollbar reaches
          // either edge, unless the panel itself scrolls.
          strandedEnd:
            (box.top < -1 || box.bottom > viewportHeight + 1) &&
            style.overflowY !== 'auto' &&
            style.overflowY !== 'scroll',
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          viewportHeight,
        };
      });

      if (!shape) return;
      measured.push(`${routePath} — "${opened}"`);

      if (!shape.named) unnamed.push(`${routePath} — "${opened}" dialog has no accessible name`);
      if (shape.strandedEnd) {
        unreachable.push(
          `${routePath} — "${opened}" panel spans ${shape.top}..${shape.bottom} in a ${shape.viewportHeight}px viewport and does not scroll`
        );
      }

      await page.addScriptTag({ path: AXE_PATH });
      const violations = await page.evaluate(async (tags) => {
        const axe = (
          window as unknown as {
            axe: {
              run: (
                context: Document,
                options: unknown
              ) => Promise<{ violations: Array<{ id: string; help: string; nodes: unknown[] }> }>;
            };
          }
        ).axe;
        const result = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
        return result.violations.map((v) => `${v.id} x${v.nodes.length} — ${v.help}`);
      }, AA_TAGS);
      if (violations.length) axeFailures.push(`${routePath} — "${opened}":\n    ${violations.join('\n    ')}`);

      await page.setViewportSize(NARROW);
      await page.waitForTimeout(300);
      const spill = await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
        const panel = dialogs[dialogs.length - 1];
        if (!panel) return [];
        const viewportWidth = document.documentElement.clientWidth;
        return [...panel.querySelectorAll('*')]
          .filter((el) => {
            if (el.closest('[data-mobile-scroll-region]')) return false;
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && (b.left < -1 || b.right > viewportWidth + 1);
          })
          .slice(0, 4)
          .map((el) => `${el.tagName.toLowerCase()} "${((el as HTMLElement).innerText || '').trim().slice(0, 30)}"`);
      });
      if (spill.length)
        overflowing.push(`${routePath} — "${opened}" at ${NARROW.width}px:\n    ${spill.join('\n    ')}`);

      await page.setViewportSize(PHONE);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    };

    for (const route of ROUTES) {
      granted = await signInForRoute(page, route, granted);

      await page.setViewportSize(PHONE);
      await page.goto(route.path);
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(350);

      // Every opener on the route, not just the first. Medical supplies offers
      // both "Add supply" and "Receive delivery"; measuring only the first left
      // the second free to lose its accessible name or outgrow the viewport
      // under a pass named "every dialog".
      const openerCount = await page.evaluate((source) => {
        const re = new RegExp(source, 'i');
        const root = document.getElementById('main-content') ?? document.body;
        return [...root.querySelectorAll('button, [role="button"]')].filter((candidate) => {
          const box = candidate.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) return false;
          const name = ((candidate as HTMLElement).innerText || candidate.getAttribute('aria-label') || '').trim();
          return re.test(name);
        }).length;
      }, OPENER.source);

      for (let index = 0; index < Math.min(openerCount, MAX_OPENERS_PER_ROUTE); index++) {
        await measureNthOpener(route.path, index);
      }
    }

    console.log(`\nDialogs measured (${measured.length}):\n  ` + measured.join('\n  '));

    // A guard against the pass quietly measuring nothing: if a refactor renames
    // the create controls, this is what says so, rather than a green run over
    // zero dialogs.
    expect(measured.length, 'the pass found no dialogs to measure').toBeGreaterThanOrEqual(6);
    expect(unnamed, 'dialogs with no accessible name').toEqual([]);
    expect(unreachable, 'dialog panels with an end no one can reach (see Pitfall #21)').toEqual([]);
    expect(axeFailures, 'dialogs with WCAG A/AA violations').toEqual([]);
    expect(overflowing, `dialog content outside the viewport at ${NARROW.width}px`).toEqual([]);
  });
});
