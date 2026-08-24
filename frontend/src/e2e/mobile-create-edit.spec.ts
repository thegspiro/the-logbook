import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './helpers';

const PHONE = { width: 390, height: 844 };
const MIN_TAP = 44;

async function visibleButton(page: Page, name: string): Promise<Locator> {
  const matches = page.getByRole('button', { name, exact: true });
  for (let index = 0; index < (await matches.count()); index += 1) {
    const candidate = matches.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  throw new Error(`No visible button named "${name}"`);
}

async function expectMobileDialogUsable(page: Page) {
  const dialog = page.getByRole('dialog');
  const panel = page.getByTestId('modal-panel');
  const content = page.getByTestId('modal-content');
  const footer = page.getByTestId('modal-footer');

  await expect(dialog).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(footer).toBeVisible();

  const measurements = await dialog.evaluate((element, minTap) => {
    const panel = element.querySelector<HTMLElement>('[data-testid="modal-panel"]');
    const content = element.querySelector<HTMLElement>('[data-testid="modal-content"]');
    const footer = element.querySelector<HTMLElement>('[data-testid="modal-footer"]');
    const controls = [...element.querySelectorAll<HTMLElement>('button, input, select, textarea')].filter((control) => {
      const box = control.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const panelBox = panel?.getBoundingClientRect();
    const footerBox = footer?.getBoundingClientRect();
    const point = panelBox
      ? document.elementFromPoint(panelBox.left + panelBox.width / 2, panelBox.top + panelBox.height / 2)
      : null;

    return {
      documentOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      // This is intentionally strict: equality only proves that the content
      // fits, not that a long create/edit form can actually scroll.
      contentScrollable: !!content && content.scrollHeight > content.clientHeight,
      footerInsideViewport: !!footerBox && footerBox.bottom <= window.innerHeight && footerBox.top >= 0,
      panelReceivesPointer: !!point?.closest('[data-testid="modal-panel"]'),
      undersized: controls
        .filter((control) => {
          // A checkbox/radio's tap target is its wrapping label, when it has
          // one. Hoisted so the narrowing is real rather than asserted, and so
          // closest() runs once instead of twice.
          const label =
            control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')
              ? control.closest('label')
              : null;
          const box = (label ?? control).getBoundingClientRect();
          return box.width < minTap || box.height < minTap;
        })
        .map((control) => control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName),
    };
  }, MIN_TAP);

  expect(measurements.documentOverflows).toBe(false);
  expect(measurements.contentScrollable).toBe(true);
  expect(measurements.footerInsideViewport).toBe(true);
  expect(measurements.panelReceivesPointer).toBe(true);
  expect(measurements.undersized).toEqual([]);

  const scrollPosition = await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(scrollPosition).toBeGreaterThan(0);
  await expect(footer).toBeInViewport();
}

test.describe('mobile create and edit surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, { permissions: ['inventory.manage'] });
  });

  test('inventory create form remains usable and releases the page mask', async ({ page }, testInfo) => {
    await page.goto('/inventory/items');
    await expect(page.getByRole('heading', { name: 'Inventory Items' })).toBeVisible();

    const addItem = await visibleButton(page, 'Add Item');
    await addItem.click();
    await expectMobileDialogUsable(page);

    const name = page.getByLabel('Name *');
    await name.fill('Mobile test item');
    expect(await name.evaluate((input) => parseFloat(getComputedStyle(input).fontSize))).toBeGreaterThanOrEqual(16);

    await page.screenshot({ path: testInfo.outputPath('inventory-create-mobile.png'), fullPage: true });
    await (await visibleButton(page, 'Cancel')).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');

    // A real click after closure guards against a transparent, fixed mask that
    // is still mounted even though the dialog itself looks gone.
    await addItem.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
