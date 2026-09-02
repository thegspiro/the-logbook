import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Quick Add — the bottom bar's one action.
 *
 * What is checked here rather than in a unit test, and why — each of these is a
 * property of the live layout rather than of the component:
 *
 *  1. The rows clear the 44px touch minimum that `mobile-presentation.spec.ts`
 *     ratchets to zero everywhere else. That pass only measures what a route
 *     renders on arrival, so a control that exists solely inside an overlay is
 *     invisible to it — which is exactly the gap a new dialog slips through.
 *  2. The bar gets out of the sheet's way. It is `fixed bottom-0 z-50` and
 *     painted after the page, so without the overlay-surface registration it
 *     covers the rows nearest the thumb and swallows their taps.
 *  3. The sheet survives the bar disappearing. It is rendered from the same
 *     component, so a careless tree shape unmounts it the instant it opens.
 *  4. Focus comes back to the Add tab on dismissal. The sheet's arrival removes
 *     the button that opened it, so the focus trap's restore targets a detached
 *     node and silently does nothing — focus measured on `<body>` before this
 *     was handled.
 */

const PHONE = { width: 390, height: 844 };
const MIN_TAP = 44;
const MIN_FONT_PX = 12;

test.describe('quick add', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page);
    await page.goto('/dashboard');
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('opens from the centre of the bottom bar and offers the member actions', async ({ page }) => {
    const bar = page.getByRole('navigation', { name: 'Primary' });
    const add = bar.getByRole('button', { name: 'Add' });
    await expect(add).toBeVisible();

    // Centred, not at an edge: the tab's midpoint should sit near the middle
    // of the bar rather than in its outer third.
    const barBox = await bar.boundingBox();
    const addBox = await add.boundingBox();
    expect(barBox).not.toBeNull();
    expect(addBox).not.toBeNull();
    const addCentre = (addBox?.x ?? 0) + (addBox?.width ?? 0) / 2;
    expect(addCentre).toBeGreaterThan((barBox?.width ?? 0) * 0.33);
    expect(addCentre).toBeLessThan((barBox?.width ?? 0) * 0.67);

    await add.click();

    const sheet = page.getByRole('dialog', { name: 'Quick add' });
    await expect(sheet).toBeVisible();
    // The rows a member with no granted permissions must still be offered.
    await expect(sheet.getByRole('button', { name: /Log training hours/ })).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Clock in/ })).toBeVisible();
    // …and one they must not be.
    await expect(sheet.getByRole('button', { name: /Add a member/ })).toHaveCount(0);
  });

  test('gets the bottom bar out of its way and stays open', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Add' }).click();

    const sheet = page.getByRole('dialog', { name: 'Quick add' });
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);

    // Nothing is painted over the last row: the point in it is the row itself.
    const rows = sheet.getByRole('button');
    const last = rows.nth((await rows.count()) - 1);
    await expect(last).toBeInViewport();
    const covered = await last.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit === null || !node.contains(hit);
    });
    expect(covered, 'something is painted over the bottom row of the sheet').toBe(false);
  });

  test('meets the touch and text minimums the rest of the app is ratcheted to', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();

    const offences = await page.evaluate(
      ({ minTap, minFont }) => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { small: ['no dialog found'], tiny: ['no dialog found'] };

        const visible = (el: Element) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };

        const small = [...dialog.querySelectorAll('button, a[href], [role="button"]')]
          .filter(visible)
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.height < minTap || box.width < minTap;
          })
          .map((el) => `${el.tagName}: ${el.textContent?.trim().slice(0, 40) ?? ''}`);

        const tiny = [...dialog.querySelectorAll('p, span, div, li, h4')]
          .filter((el) => visible(el) && !!el.textContent?.trim())
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < minFont)
          .map((el) => `${el.tagName}: ${el.textContent?.trim().slice(0, 40) ?? ''}`);

        return { small, tiny };
      },
      { minTap: MIN_TAP, minFont: MIN_FONT_PX }
    );

    expect(offences.small, 'quick add controls below the 44px touch minimum').toEqual([]);
    expect(offences.tiny, 'quick add text below the 12px minimum').toEqual([]);
  });

  // Only reproducible end to end: it depends on the bar actually unmounting
  // behind the sheet, which is a live-layout effect the unit test stands in for
  // rather than reproduces. Focus landed on <body> before this was handled.
  test('hands focus back to the Add tab when dismissed', async ({ page }) => {
    const add = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Add' });
    await add.click();
    await expect(page.getByRole('dialog', { name: 'Quick add' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog', { name: 'Quick add' })).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('lands on the page the row names', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Add' }).click();
    await page
      .getByRole('dialog', { name: 'Quick add' })
      .getByRole('button', { name: /Log training hours/ })
      .click();

    await page.waitForURL(/\/training\/submit/, { timeout: 15_000 });
    // The sheet closed rather than staying open behind the new page.
    await expect(page.getByRole('dialog', { name: 'Quick add' })).toHaveCount(0);
    // And the bar came back with it.
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  });
});
