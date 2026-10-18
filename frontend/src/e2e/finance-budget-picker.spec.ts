import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * The budget picker on the request forms, as a member holding only
 * `finance.request` sees it.
 *
 * The server decides whether an amount is sent (finance.view / finance.manage
 * and the line's owner get one; everyone else gets `null`). These tests pin
 * what the page does with each answer, in a real browser against the form's
 * actual <select>.
 */

const openForm = async (page: Page, path: string, budgetOptions: unknown[]) => {
  await signIn(page, { permissions: ['finance.request'] });
  // `signIn` installs a catch-all for /api/v1/**, and Playwright runs the most
  // recently registered matching route first, so these go on after it.
  await page.route('**/api/v1/finance/fiscal-years/options', (route) => {
    void route.fulfill(json([{ id: 'fy-1', name: 'FY2026', status: 'active' }]));
  });
  await page.route('**/api/v1/finance/budgets/options**', (route) => void route.fulfill(json(budgetOptions)));
  await page.route('**/api/v1/finance/funds', (route) => void route.fulfill(json([])));
  await page.goto(path);
  // The check request form leaves the fiscal year for the member to pick, and
  // the budget lines load once it is chosen; the purchase form has it already.
  await page.locator('select', { has: page.locator('option', { hasText: 'FY2026' }) }).selectOption('fy-1');
};

// The Budget label is not bound to its select, so find the select by its
// first option.
const budgetOptionsOf = (page: Page) =>
  page.locator('select', { has: page.locator('option', { hasText: 'No budget linked' }) }).locator('option');

for (const [name, path] of [
  ['purchase request', '/finance/purchase-requests/new'],
  ['check request', '/finance/check-requests/new'],
] as const) {
  test.describe(`budget picker on the ${name} form`, () => {
    test('lists lines by name only when the server sends no amount', async ({ page }) => {
      await openForm(page, path, [
        { id: 'b-1', label: 'Training', amountRemaining: null },
        { id: 'b-2', label: 'Apparatus (Station 2)', amountRemaining: null },
      ]);

      await expect(budgetOptionsOf(page)).toHaveText(['No budget linked', 'Training', 'Apparatus (Station 2)']);
      await expect(page.getByText('remaining')).toHaveCount(0);
    });

    test('shows the amount for a line the server sends one for', async ({ page }) => {
      await openForm(page, path, [
        { id: 'b-1', label: 'Training', amountRemaining: '1250.00' },
        { id: 'b-2', label: 'Apparatus (Station 2)', amountRemaining: null },
      ]);

      await expect(budgetOptionsOf(page)).toHaveText([
        'No budget linked',
        'Training — $1,250.00 remaining',
        'Apparatus (Station 2)',
      ]);
    });
  });
}
