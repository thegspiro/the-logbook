import { expect, test } from '@playwright/test';
import type { Page, Request } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * The purchase request form, as a member holding only `finance.request` uses
 * it: the draft is kept on the server while they type, and they are asked
 * before losing entries the server cannot hold.
 *
 * Run in a real browser rather than a unit test because the behaviour is a
 * property of timers, the page lifecycle and the network together: the
 * debounce, the browser's own leave prompt, and what actually goes over the
 * wire.
 */

const FISCAL_YEAR = { id: 'fy-1', name: 'FY2026', status: 'active' };
const DRAFT_ID = 'pr-draft-1';

interface Wire {
  creates: Request[];
  updates: Request[];
  cancels: Request[];
}

const stubFinance = async (page: Page): Promise<Wire> => {
  const wire: Wire = { creates: [], updates: [], cancels: [] };
  await page.route('**/api/v1/finance/fiscal-years/options', (route) => void route.fulfill(json([FISCAL_YEAR])));
  await page.route('**/api/v1/finance/budgets/options**', (route) => void route.fulfill(json([])));
  await page.route('**/api/v1/finance/funds', (route) => void route.fulfill(json([])));
  await page.route('**/api/v1/finance/purchase-requests', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      wire.creates.push(request);
      void route.fulfill(
        json(
          {
            id: DRAFT_ID,
            status: 'draft',
            title: 'Ladder',
            fiscalYearId: FISCAL_YEAR.id,
            estimatedAmount: '400.00',
          },
          201
        )
      );
      return;
    }
    void route.fulfill(json([]));
  });
  await page.route(`**/api/v1/finance/purchase-requests/${DRAFT_ID}`, (route) => {
    const request = route.request();
    if (request.method() === 'PUT') {
      wire.updates.push(request);
      void route.fulfill(json({ id: DRAFT_ID, status: 'draft' }));
      return;
    }
    void route.fulfill(json({ id: DRAFT_ID, status: 'draft' }));
  });
  await page.route(`**/api/v1/finance/purchase-requests/${DRAFT_ID}/cancel`, (route) => {
    wire.cancels.push(route.request());
    void route.fulfill(json({ id: DRAFT_ID, status: 'cancelled' }));
  });
  return wire;
};

// Playwright runs the most recently registered matching route first, and
// `signIn` installs a catch-all for /api/v1/**, so the finance stubs must be
// registered after it or they are never reached.
const openForm = async (page: Page): Promise<Wire> => {
  await signIn(page, { permissions: ['finance.request'] });
  const wire = await stubFinance(page);
  await page.goto('/finance/purchase-requests/new');
  await expect(page.getByRole('heading', { name: 'New Purchase Request' })).toBeVisible();
  return wire;
};

const fillTitleAndAmount = async (page: Page) => {
  await page.getByPlaceholder('Brief title for the purchase').fill('Ladder');
  await page.getByPlaceholder('0.00').fill('400');
};

test.describe('purchase request draft', () => {
  test('is saved to the server while the member types, then updated in place', async ({ page }) => {
    const wire = await openForm(page);
    await expect(page.getByText('Add a title and an amount to start saving a draft.')).toBeVisible();

    await fillTitleAndAmount(page);
    await expect(page.getByText(/^Draft saved at/)).toBeVisible({ timeout: 10_000 });

    expect(wire.creates).toHaveLength(1);
    expect(wire.creates[0]?.postDataJSON()).toMatchObject({
      title: 'Ladder',
      estimatedAmount: '400.00',
      fiscalYearId: 'fy-1',
    });
    // Blank optional fields are left out of a create, never sent as "".
    expect(wire.creates[0]?.postDataJSON()).not.toHaveProperty('vendor');

    await page.getByPlaceholder('Vendor or supplier name').fill('Acme Ladders');
    await expect.poll(() => wire.updates.length, { timeout: 10_000 }).toBe(1);
    expect(wire.creates).toHaveLength(1);
    expect(wire.updates[0]?.postDataJSON()).toMatchObject({ vendor: 'Acme Ladders' });
  });

  test('says what is needed before anything can be saved, and sends nothing until then', async ({ page }) => {
    const wire = await openForm(page);

    await page.getByPlaceholder('Brief title for the purchase').fill('Lad');
    await page.waitForTimeout(2500);

    expect(wire.creates).toHaveLength(0);
    await expect(page.getByText('Add a title and an amount to start saving a draft.')).toBeVisible();
  });

  test('asks before leaving with entries the server cannot hold yet', async ({ page }) => {
    await openForm(page);
    await page.getByPlaceholder('Brief title for the purchase').fill('Lad');

    await page.getByRole('button', { name: 'Close' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Leave without saving?')).toBeVisible();

    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(page).toHaveURL(/\/finance\/purchase-requests\/new$/);
    await expect(page.getByPlaceholder('Brief title for the purchase')).toHaveValue('Lad');
  });

  test('warns before the tab is closed or reloaded with unsaved entries', async ({ page }) => {
    await openForm(page);
    await page.getByPlaceholder('Brief title for the purchase').fill('Lad');

    const prompt = new Promise<string>((resolve) => {
      page.once('dialog', (dialog) => {
        void dialog.dismiss();
        resolve(dialog.type());
      });
    });
    await page.close({ runBeforeUnload: true });

    expect(await prompt).toBe('beforeunload');
  });

  test('does not warn once the draft is saved', async ({ page }) => {
    await openForm(page);
    await fillTitleAndAmount(page);
    await expect(page.getByText(/^Draft saved at/)).toBeVisible({ timeout: 10_000 });

    let prompted = false;
    page.on('dialog', (dialog) => {
      prompted = true;
      void dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });

    expect(prompted).toBe(false);
  });

  test('a saved draft is withdrawn only after the member confirms', async ({ page }) => {
    const wire = await openForm(page);
    await fillTitleAndAmount(page);
    await expect(page.getByText(/^Draft saved at/)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Discard draft' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Keep draft' }).click();
    expect(wire.cancels).toHaveLength(0);

    await page.getByRole('button', { name: 'Discard draft' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Discard draft' }).click();

    await expect.poll(() => wire.cancels.length).toBe(1);
    await expect(page).toHaveURL(/\/finance\/purchase-requests$/);
    // The form's last save on the way out must not bring the draft back.
    expect(wire.creates).toHaveLength(1);
    expect(wire.updates).toHaveLength(0);
  });

  test('keeps every action at the 44px touch minimum on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openForm(page);
    await fillTitleAndAmount(page);
    await expect(page.getByText(/^Draft saved at/)).toBeVisible({ timeout: 10_000 });

    for (const name of ['Discard draft', 'Close', 'Save Draft']) {
      const button = page.getByRole('button', { name });
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44);
    }
  });
});
