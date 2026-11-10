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

/**
 * WebKit's notice that a navigation cancelled a request still in flight.
 *
 * Each `page.goto` below leaves the previous page mid-request — the login
 * page's onboarding and branding reads, or an error report being posted —
 * and WebKit logs every cancelled XHR or fetch as "XMLHttpRequest cannot load
 * <url> due to access control checks.", which Playwright surfaces as a
 * `pageerror` although no script threw and no promise went unhandled.
 * Chromium logs nothing for the same cancellation. Counting it made the
 * Mobile Safari run fail on whichever request happened to be in flight.
 */
const isWebKitCancelledRequest = (error: Error) =>
  /^(XMLHttpRequest|Fetch API) cannot load\b/.test(error.name) &&
  error.message.endsWith(' due to access control checks.');

test('every report renders an empty, well-formed result without error', async ({ page }) => {
  // One page load per report card, thirteen in all. Under Mobile Safari each
  // click is the slow part: Playwright's Linux WebKit composites the cards'
  // backdrop blur in software and drew no frame of /reports in three seconds,
  // so every click waits 4-9s for the frames its stability check needs. A
  // whole pass measured 78-102s locally and 108s on a CI runner, against the
  // 120s this budget used to be.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (!isWebKitCancelledRequest(error)) errors.push(error.message);
  });
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
