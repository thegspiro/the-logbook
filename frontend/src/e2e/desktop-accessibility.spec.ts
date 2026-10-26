import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { ROUTES, signInForRoute } from './mobile-routes';

/**
 * WCAG A/AA at the widths the accessibility pass does not measure.
 *
 * `mobile-accessibility.spec.ts` runs axe at phone width, where an
 * administration hub's section cards are chips showing their label alone. From
 * `sm` up the same buttons also show a description, and that visible text
 * inside the button but outside its name failed WCAG 2.5.3 (Label in Name) on
 * all six hubs — 73 routes at desktop width, none at phone width. A tablet
 * also lays tables out wider than their card, which a phone's stacked cards
 * never do. One route per hub at 1440px, and the tablet table, asserted at
 * zero.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const runAxe = async (page: Page): Promise<string[]> => {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async (tags) => {
    type Result = { id: string; help: string; nodes: { target: string[] }[] };
    const axe = (window as unknown as { axe: { run: (d: Document, o: unknown) => Promise<{ violations: Result[] }> } })
      .axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return result.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  }, AA_TAGS);
};

const open = async (page: Page, path: string, viewport: { width: number; height: number }) => {
  const route = ROUTES.find((r) => r.path === path);
  if (!route) throw new Error(`${path} is not in the mobile route list`);
  await page.setViewportSize(viewport);
  await signInForRoute(page, route, null);
  await page.goto(path);
  await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
  await page.waitForTimeout(400);
};

// One route inside each administration hub that renders AdminHubCardTabs,
// and a control inside one that failed the same criterion on its own.
const HUB_ROUTES = [
  '/members/admin',
  '/inventory/admin',
  '/training/admin?page=setup&tab=pipelines',
  '/scheduling/admin/planning',
  '/events/admin?tab=create',
  '/inventory/admin/store?tab=orders',
  // The CSV drop zone: named by an aria-label that its own text did not match.
  '/members/admin?tab=import',
];

test.describe('WCAG A/AA at desktop width', () => {
  for (const path of HUB_ROUTES) {
    test(path, async ({ page }) => {
      await open(page, path, { width: 1440, height: 900 });
      expect(await runAxe(page), `${path} at 1440px`).toEqual([]);
    });
  }
});

test.describe('WCAG A/AA at tablet width', () => {
  test.use({ hasTouch: true });

  test('/members/admin', async ({ page }) => {
    await open(page, '/members/admin', { width: 820, height: 1180 });
    expect(await runAxe(page), '/members/admin at 820px').toEqual([]);
  });
});

test.describe('A hub card is clickable across its whole face', () => {
  // The description moved out of the button for 2.5.3; the button's ::after
  // is what keeps a click on it selecting the section.
  test('a click on the description selects the card', async ({ page }) => {
    await open(page, '/members/admin', { width: 1440, height: 900 });
    const tab = page.locator('[role="tab"]').nth(1);
    await expect(tab).toHaveAttribute('aria-selected', 'false');
    const describedBy = await tab.getAttribute('aria-describedby');
    // By position: the ::after covering the description is the point, and a
    // locator click refuses an element something else lies over.
    const box = await page.locator(`[id="${describedBy}"]`).boundingBox();
    if (!box) throw new Error('the description has no box at desktop width');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});
