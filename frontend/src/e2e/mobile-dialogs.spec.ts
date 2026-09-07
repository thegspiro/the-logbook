import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { signIn } from './helpers';
import { BASE_PERMISSIONS, NARROW, PHONE, ROUTES } from './mobile-routes';

/**
 * The dialogs, measured — not just the routes that open them.
 *
 * The presentation and accessibility passes only ever see a route's landing
 * state. A dialog is where the things they check actually bite: it is the
 * densest form layout in the application, it traps focus, and it is the one
 * surface that can render taller than the viewport with no way to reach either
 * end (see Pitfall #21).
 *
 * This walks each route, clicks the first create-shaped control in the page
 * body, and measures whatever dialog opens. It found three defects on its first
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

/** Labels that open something, as opposed to submitting or navigating. */
const OPENER = /^(add|new|create|record|log|invite|upload|schedule|request)\b/i;

const AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe('mobile dialogs', () => {
  test('every dialog is named, labelled and fits a phone', async ({ page }) => {
    test.setTimeout(1_800_000);

    let granted = BASE_PERMISSIONS;
    await signIn(page, { permissions: granted });

    const unnamed: string[] = [];
    const axeFailures: string[] = [];
    const unreachable: string[] = [];
    const overflowing: string[] = [];
    const measured: string[] = [];

    for (const route of ROUTES) {
      const needed = route.permissions ? [...BASE_PERMISSIONS, ...route.permissions] : BASE_PERMISSIONS;
      if (needed.join() !== granted.join()) {
        granted = needed;
        await signIn(page, { permissions: granted });
      }

      await page.setViewportSize(PHONE);
      await page.goto(route.path);
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(350);

      const opened = await page.evaluate((source) => {
        const re = new RegExp(source, 'i');
        const root = document.getElementById('main-content') ?? document.body;
        const el = [...root.querySelectorAll('button, [role="button"]')].find((candidate) => {
          const box = candidate.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) return false;
          const name = ((candidate as HTMLElement).innerText || candidate.getAttribute('aria-label') || '').trim();
          return re.test(name);
        });
        if (!el) return null;
        const label = ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40);
        (el as HTMLElement).click();
        return label;
      }, OPENER.source);

      if (!opened) continue;
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

      if (!shape) continue;
      measured.push(`${route.path} — "${opened}"`);

      if (!shape.named) unnamed.push(`${route.path} — "${opened}" dialog has no accessible name`);
      if (shape.strandedEnd) {
        unreachable.push(
          `${route.path} — "${opened}" panel spans ${shape.top}..${shape.bottom} in a ${shape.viewportHeight}px viewport and does not scroll`
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
      if (violations.length) axeFailures.push(`${route.path} — "${opened}":\n    ${violations.join('\n    ')}`);

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
        overflowing.push(`${route.path} — "${opened}" at ${NARROW.width}px:\n    ${spill.join('\n    ')}`);

      await page.setViewportSize(PHONE);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
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
