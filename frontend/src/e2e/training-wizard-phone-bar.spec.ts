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

/**
 * Whether the focused control and its first description (its refusal, when
 * it has one) came to rest between the phone's fixed header and the bar, each
 * what a tap at its middle reaches. Read once the page has stopped scrolling,
 * since the browser's own focus scroll is smooth here and the form's
 * correction to it lands a frame later.
 */
const focusedDescription = async (page: Page) => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = window.scrollY;
        let still = 0;
        let frames = 0;
        const tick = () => {
          frames += 1;
          still = window.scrollY === last ? still + 1 : 0;
          last = window.scrollY;
          if (still >= 10 || frames > 300) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
  );
  return page.evaluate(() => {
    const control = document.activeElement;
    const id = control?.getAttribute('aria-describedby')?.split(/\s+/)[0] ?? '';
    const description = id ? document.getElementById(id) : null;
    const bar = document.querySelector('[role="group"][aria-label="Step navigation"]');
    const header = document.querySelector('header[role="banner"]');
    if (!control || !description || !bar || !header) return { control: control?.id ?? null, text: null, clear: false };
    const between = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2);
      return (
        rect.top >= header.getBoundingClientRect().bottom &&
        rect.bottom <= bar.getBoundingClientRect().top &&
        hit !== null &&
        el.contains(hit)
      );
    };
    return { control: control.id, text: description.textContent, clear: between(control) && between(description) };
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
  // A refused field is focused so its reason is read; on a phone the reason,
  // under the control, has to clear the bar too, or a sighted member sees a
  // focused field and no message. Smooth scrolling, the default: the form's
  // correction to a focus scroll still under way is what left the reason
  // behind the bar.
  test('brings a refused Next field and its reason clear of the bar', async ({ page }) => {
    await openWizard(page);
    await page.getByLabel(/Start Date & Time/).fill('2030-05-01');
    // The page's top, where an officer who has not scrolled presses Next:
    // the refused field then comes into view from below, up to the bar.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await next(page).click();

    await expect(page.locator('#event-title')).toBeFocused();
    expect(await focusedDescription(page)).toEqual({
      control: 'event-title',
      text: 'Enter a title for the event.',
      clear: true,
    });
  });

  test('brings a refused Days of the Week group and its reason clear of the bar', async ({ page }) => {
    await openWizard(page);
    await page.getByLabel(/^Title/).fill('Ladder Drill');
    await page.getByLabel(/Start Date & Time/).fill('2030-05-01');
    await page.getByLabel('Make this a recurring event').check();
    await page.getByLabel(/^Repeats/).selectOption('custom');
    await page.getByLabel(/^Series end date/).fill('2030-08-01');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await next(page).click();

    await expect(page.locator('#recurrence-day-0')).toBeFocused();
    const result = await focusedDescription(page);
    expect(result.control).toBe('recurrence-day-0');
    expect(result.clear).toBe(true);
    // The whole row of days sits between the control and its reason.
    const barTop = (await page.getByRole('group', { name: 'Step navigation' }).boundingBox())?.y ?? 0;
    const sunday = await page.getByRole('button', { name: 'Sun', exact: true }).boundingBox();
    expect((sunday?.y ?? 0) + (sunday?.height ?? 0)).toBeLessThanOrEqual(barTop);
  });

  test("brings a 422's refused fields and their reasons clear of the bar, on each step", async ({ page }) => {
    await openWizard(page);
    await page.route('**/api/v1/events', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: [
            { field: 'title', message: 'String should have at most 200 characters' },
            { field: 'training_details.credit_hours', message: 'Input should be greater than or equal to 0' },
          ],
        }),
      });
    });
    await page.getByLabel(/^Title/).fill('Ladder Drill');
    await page.getByLabel(/Start Date & Time/).fill('2030-05-01');
    await next(page).click();
    await expect(page.getByText('Step 2 of 4 · Training Info')).toBeVisible();
    await next(page).click();
    await expect(page.getByText('Step 3 of 4 · Settings')).toBeVisible();
    await next(page).click();
    await expect(page.getByText('Step 4 of 4 · Review')).toBeVisible();
    await page.getByRole('button', { name: 'Create Training Session' }).click();

    await expect(page.getByText('Step 1 of 4 · Event Details')).toBeVisible();
    await expect(page.locator('#event-title')).toBeFocused();
    expect(await focusedDescription(page)).toEqual({
      control: 'event-title',
      text: 'Title is too long — keep it to 200 characters.',
      clear: true,
    });

    await next(page).click();
    await expect(page.getByText('Step 2 of 4 · Training Info')).toBeVisible();
    await expect(page.locator('#training-credit-hours')).toBeFocused();
    expect(await focusedDescription(page)).toEqual({
      control: 'training-credit-hours',
      text: 'Credit hours must be 0 or more.',
      clear: true,
    });
  });
});
