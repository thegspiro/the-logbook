import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Every report card on /reports generates and renders without tripping the
 * report's error boundary.
 *
 * The API fixtures answered POST /reports/generate with the catch-all `{}`,
 * so each renderer read a list the real generator always sends (`entries`,
 * `events`, `summary`) as undefined and threw. The boundary kept the page up,
 * which is why nothing failed, but the sweep logged six TypeErrors on every
 * run and nothing exercised a renderer on a well-formed empty report.
 */
test('every report renders an empty, well-formed result without error', async ({ page }) => {
  // One page load per report card, about a dozen in all.
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('TypeError')) errors.push(message.text());
  });

  await signIn(page, { permissions: ['*'] });
  await page.goto('/reports');
  const generate = page.getByRole('button', { name: 'Generate Report' });
  await expect(generate.first()).toBeVisible();
  const count = await generate.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    await page.goto('/reports');
    await generate.nth(i).click();
    // Let the request settle and the renderer mount before checking it.
    await page.waitForLoadState('networkidle');
    await expect(page.getByText("This report's data could not be read.")).toHaveCount(0);
  }

  expect(errors).toEqual([]);
});
