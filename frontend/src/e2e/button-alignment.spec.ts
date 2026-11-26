/**
 * Buttons that sit side by side are one height, an icon in an icon button is
 * centred, and a label that wraps reads from the left.
 *
 * An audit of every route and the dialogs it opens, at 1280px and 390px, found
 * each of these out of line:
 *
 *   - btn-secondary's 1px border, which the filled buttons lacked: every
 *     Cancel beside a Save was 42px against 40px on a desktop;
 *   - a hand-built button beside a btn-* one: "Card Readers" against a padded
 *     "Print All", "Send Test to Me" (44px everywhere) against "Save", the
 *     pipeline wizard's "Back" (min-h-11) against "Next";
 *   - an icon in a button that is not a flex container: Prospective Members'
 *     refresh icon sat 6px off centre in its 44px box, and the wizard's phone
 *     step icons 3px left of centre in theirs;
 *   - a label that wraps inside a button, which centres text by default:
 *     "SMTP (any provider)" and "Officer Signature Variables" read centred
 *     beside left-aligned siblings, and the registry import icon was squeezed
 *     smaller by "Import NREMT — Advanced EMT (AEMT)".
 */

import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { ALL_ROUTES, signInForRoute } from './mobile-routes';

// Each block declares its device rather than resizing whichever project runs
// it: under Mobile Safari (an iPhone profile) a desktop-sized viewport still
// laid the page out at phone width, as side-navigation-full-height.spec.ts
// found.
const LAPTOP = { viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };

const open = async (page: Page, path: string) => {
  const base = path.split('?')[0] ?? path;
  const route = [...ALL_ROUTES]
    .filter((r) => {
      const p = r.path.split('?')[0] ?? '';
      return base === p || base.startsWith(`${p}/`);
    })
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!route) throw new Error(`${path} is not in the mobile route list`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInForRoute(page, route, null);
  await page.goto(path);
  // Settings and the training hub load their panels as lazy chunks after the
  // shell. Under parallel WebKit workers on the dev server CI runs, the first
  // request for a chunk compiles it, and a lookup made before it arrives found
  // an empty panel.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
};

const height = async (el: Locator) => Math.round((await el.boundingBox())?.height ?? -1);

/** How far an icon's centre sits from the centre of its button's content box, in px. */
const iconOffset = (button: Locator) =>
  button.evaluate((el) => {
    const icon = el.querySelector('svg');
    if (!icon) throw new Error('button holds no icon');
    const b = el.getBoundingClientRect();
    const s = icon.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cx = (b.left + parseFloat(cs.paddingLeft) + b.right - parseFloat(cs.paddingRight)) / 2;
    const cy = (b.top + parseFloat(cs.paddingTop) + b.bottom - parseFloat(cs.paddingBottom)) / 2;
    return Math.max(Math.abs((s.left + s.right) / 2 - cx), Math.abs((s.top + s.bottom) / 2 - cy));
  });

/** The left edge of each line of a button's label, and how many lines it has. */
const labelLines = (button: Locator, text: string) =>
  button.evaluate((el, label) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.includes(label)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter((r) => r.width > 1);
      return lines.map((r) => Math.round(r.left));
    }
    throw new Error(`no text "${label}" in the button`);
  }, text);

test.describe('Buttons side by side are one height', () => {
  test.use(LAPTOP);

  test('btn-secondary beside each filled button', async ({ page }) => {
    // btn-secondary has a 1px border; the filled buttons had none, so on a
    // desktop a Cancel beside a Save was 42px against 40px wherever the row
    // centres its items rather than stretching them.
    await open(page, '/forms');
    const heights = await page.evaluate(() => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      for (const cls of ['btn-secondary', 'btn-primary', 'btn-success', 'btn-info', 'btn-warning']) {
        const button = document.createElement('button');
        button.className = cls;
        button.textContent = 'Save';
        row.append(button);
      }
      document.getElementById('main-content')?.append(row);
      return [...row.children].map((b) => `${b.className} ${Math.round(b.getBoundingClientRect().height)}`);
    });
    const secondary = heights[0]?.split(' ')[1];
    expect(heights).toEqual(heights.map((h) => `${h.split(' ')[0]} ${secondary}`));
  });

  test('an icon button beside a text button: the Forms header', async ({ page }) => {
    // btn-icon is 36px with a mouse; beside a 42px "Create Form" the Refresh
    // square sat 6px short. It now takes its row's height, and stays square.
    await open(page, '/forms');
    const refresh = page.getByRole('button', { name: 'Refresh forms' });
    const create = page.getByRole('button', { name: 'Create Form' }).first();
    await expect(create).toBeVisible();
    const box = await refresh.boundingBox();
    expect(Math.round(box?.height ?? -1)).toBe(await height(create));
    expect(Math.round(box?.width ?? -1)).toBe(Math.round(box?.height ?? -2));
  });

  test('a menu trigger beside a text button: the Events header', async ({ page }) => {
    // The "More" button sits in the relative box its menu hangs from, one
    // level below the row, and was 38px beside a 42px "Create Event".
    await open(page, '/events');
    const more = page.getByRole('button', { name: 'More event actions' });
    const create = page.getByRole('link', { name: 'Create Event' });
    await expect(create).toBeVisible();
    const box = await more.boundingBox();
    expect(Math.round(box?.height ?? -1)).toBe(await height(create));
    expect(Math.round(box?.width ?? -1)).toBe(Math.round(box?.height ?? -2));
  });

  test('an icon-only Refresh beside "New …": the inventory admin headers', async ({ page }) => {
    // A 16px icon in a btn-md is 4px shorter than the 20px text line beside it.
    for (const [path, refresh, add] of [
      ['/inventory/admin/allowances', 'Refresh', 'New Allowance'],
      ['/inventory/admin/reorder', 'Refresh', 'New Request'],
      ['/inventory/admin/vendors', 'Refresh vendors', 'New Vendor'],
    ] as const) {
      await open(page, path);
      const next = page.getByRole('button', { name: add });
      await expect(next, path).toBeVisible();
      expect(await height(page.getByRole('button', { name: refresh, exact: true })), path).toBe(await height(next));
    }
  });

  test('Check-In QR Codes header', async ({ page }) => {
    await open(page, '/locations/qr-codes');
    const readers = page.getByRole('link', { name: 'Card Readers' });
    const print = page.getByRole('button', { name: 'Print All' });
    await expect(print).toBeVisible();
    expect(await height(readers)).toBe(await height(print));
  });

  test('email template editor', async ({ page }) => {
    await open(page, '/communications/email-templates');
    const send = page.getByRole('button', { name: 'Send Test to Me' });
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(send).toBeVisible();
    expect(await height(send)).toBe(await height(save));
  });

  test('training pipeline wizard footer', async ({ page }) => {
    await open(page, '/training/admin?page=curriculum&tab=pipelines&view=new');
    const back = page.getByRole('button', { name: 'Back', exact: true });
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await expect(next).toBeVisible();
    expect(await height(back)).toBe(await height(next));
  });
});

test.describe('An icon is centred in its icon button', () => {
  test.use(LAPTOP);

  test('Prospective Members refresh', async ({ page }) => {
    await open(page, '/prospective-members');
    const refresh = page.getByRole('button', { name: 'Refresh' }).first();
    await expect(refresh).toBeVisible();
    expect(await iconOffset(refresh)).toBeLessThanOrEqual(1);
  });
});

test.describe('An icon is centred in its icon button, on a phone', () => {
  test.use(PHONE);

  test('training pipeline wizard steps', async ({ page }) => {
    await open(page, '/training/admin?page=curriculum&tab=pipelines&view=new');
    for (const name of ['Program Info', 'Requirements', 'Milestones', 'Review']) {
      const step = page.getByRole('button', { name, exact: true });
      await expect(step).toBeVisible();
      expect(await iconOffset(step), name).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('A label that wraps reads from the left', () => {
  test.use(LAPTOP);

  test('"SMTP (any provider)" in the email platform tiles', async ({ page }) => {
    await open(page, '/settings?tab=email');
    const tile = page.getByRole('button', { name: 'SMTP (any provider)' });
    await expect(tile).toBeVisible();
    const lines = await labelLines(tile, 'SMTP');
    expect(lines.length, 'the label no longer wraps at 1280px').toBeGreaterThan(1);
    expect(new Set(lines).size, `line starts ${lines.join(', ')}`).toBe(1);
  });

  test('a long registry name keeps its import icon full size', async ({ page }) => {
    await open(page, '/training/admin?page=setup&tab=requirements');
    const button = page.getByRole('button', { name: /Import NREMT — Advanced EMT/ });
    await button.scrollIntoViewIfNeeded();
    const icon = button.locator('svg').first();
    const box = await icon.boundingBox();
    expect(Math.round(box?.width ?? -1)).toBe(20);
  });
});

test.describe('A label that wraps reads from the left, on a phone', () => {
  test.use(PHONE);

  test('"Officer Signature Variables" in the template editor', async ({ page }) => {
    await open(page, '/communications/email-templates');
    const toggle = page.getByRole('button', { name: /Officer Signature Variables/ });
    await toggle.scrollIntoViewIfNeeded();
    const lines = await labelLines(toggle, 'Officer Signature');
    expect(lines.length, 'the label no longer wraps at 390px').toBeGreaterThan(1);
    expect(new Set(lines).size, `line starts ${lines.join(', ')}`).toBe(1);
  });
});
