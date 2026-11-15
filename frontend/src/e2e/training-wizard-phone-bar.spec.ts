import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * The training-event form's Previous/Next bar on a phone.
 *
 * Under 768px the bar is `position: fixed` above the bottom nav. A `.card`'s
 * `backdrop-filter` makes it the containing block of anything fixed inside
 * it, so while the bar sat inside the form's card it was pinned to the card's
 * bottom edge rather than the viewport's: below the screen until the card's
 * end scrolled up, and then over the last control on each step, so a tap on
 * Save as Draft landed on Previous. Only a real browser lays this out; jsdom
 * has no containing blocks. The position checks are soft, so one run reports
 * every step where the bar misbehaves.
 */

test.use({ viewport: { width: 390, height: 844 } });

const openWizard = async (page: Page) => {
  await signIn(page, { permissions: ['training.manage', 'events.manage'] });
  // Registered after signIn's catch-all, which answers `{}`: these pickers
  // read lists.
  await page.route('**/api/v1/training/courses**', (route) => void route.fulfill(json([])));
  await page.route('**/api/v1/users', (route) => void route.fulfill(json([])));
  await page.goto('/training/admin?page=records&tab=sessions');
  await expect(page.getByText('Step 1 of 4 · Event Details')).toBeVisible();
};

const next = (page: Page) => page.getByRole('group', { name: 'Step navigation' }).getByRole('button', { name: 'Next' });

/** The bar's Next sits inside the viewport and wholly above the bottom nav. */
const expectPinnedAboveBottomNav = async (page: Page) => {
  const bottomNav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
  const box = await next(page).boundingBox();
  expect(bottomNav).not.toBeNull();
  expect(box).not.toBeNull();
  expect.soft(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect.soft((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(bottomNav?.y ?? 0);
  expect(bottomNav?.y ?? 0).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
};

/**
 * Whether a tap at the control's centre reaches it with the page scrolled to
 * its end, where a step's last control comes to rest above the bar. Instant,
 * since the app scrolls smoothly and a rect read mid-scroll proves nothing.
 */
const tapReaches = async (control: Locator) => {
  await control.page().evaluate(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });
  return control.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === el;
  });
};

test.describe('training-event form on a phone', () => {
  test('pins Previous and Next above the bottom nav and leaves the last control reachable', async ({ page }) => {
    await openWizard(page);
    await expectPinnedAboveBottomNav(page);

    await page.getByLabel(/^Title/).fill('Ladder Drill');
    await page.getByLabel(/Start Date & Time/).fill('2030-05-01');
    await next(page).click();
    await expect(page.getByText('Step 2 of 4 · Training Info')).toBeVisible();
    await expectPinnedAboveBottomNav(page);
    expect.soft(await tapReaches(page.getByRole('checkbox', { name: /Require sign-off/ }))).toBe(true);

    await next(page).click();
    await expect(page.getByText('Step 3 of 4 · Settings')).toBeVisible();
    await next(page).click();
    await expect(page.getByText('Step 4 of 4 · Review')).toBeVisible();

    const saveAsDraft = page.getByRole('checkbox', { name: 'Save as Draft' });
    expect.soft(await tapReaches(saveAsDraft)).toBe(true);
    await saveAsDraft.click();
    await expect(saveAsDraft).toBeChecked();
  });
  // WCAG 2.4.11: a control reached by Tab, from a hardware keyboard or switch
  // access, is scrolled only as far as the viewport's edge, which is behind
  // the bar unless the bar's height is reserved for it.
  test('keeps a control reached by Tab clear of the bar', async ({ page }) => {
    // Instant scrolling, so each rect is read where the focus scroll ended.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWizard(page);
    await page.getByLabel(/^Title/).fill('Ladder Drill');
    await page.getByLabel(/Start Date & Time/).fill('2030-05-01');
    await next(page).click();
    await expect(page.getByText('Step 2 of 4 · Training Info')).toBeVisible();

    const barTop = (await page.getByRole('group', { name: 'Step navigation' }).boundingBox())?.y ?? 0;
    expect(barTop).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.locator('#training-wizard-step').focus();

    const obscured: string[] = [];
    let checked = 0;
    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!(el instanceof HTMLElement) || !el.closest('form')) return null;
        if (el.closest('[role="group"][aria-label="Step navigation"]')) return null;
        const rect = el.getBoundingClientRect();
        return { name: el.id || el.getAttribute('name') || el.textContent?.trim() || el.tagName, bottom: rect.bottom };
      });
      if (!focused) continue;
      checked += 1;
      if (focused.bottom > barTop)
        obscured.push(`${focused.name} (bottom ${Math.round(focused.bottom)} > ${Math.round(barTop)})`);
    }
    expect(checked).toBeGreaterThan(3);
    expect(obscured).toEqual([]);
  });

  // Chrome scrolls a focused textarea by its caret, not its box, so the
  // scroll margin above left Description, reached by Tab from its toolbar,
  // almost wholly behind the bar.
  test('keeps Description, reached by Tab from its toolbar, clear of the bar', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWizard(page);
    const barTop = (await page.getByRole('group', { name: 'Step navigation' }).boundingBox())?.y ?? 0;
    expect(barTop).toBeGreaterThan(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.locator('#training-wizard-step').focus();

    let reached = false;
    for (let press = 0; press < 15 && !reached; press += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.id === 'event-description');
    }
    expect(reached).toBe(true);
    // Past the next frame, where a correction to the browser's own scroll lands.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const bottom = await page.locator('#event-description').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(barTop);
  });
});
