import { expect, test } from '@playwright/test';

test('installs its production worker and launches the app shell offline', async ({ context, page }) => {
  await page.goto('/login');

  const manifestResponse = await page.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  expect(manifestResponse.headers()['content-type']).toContain('application/manifest+json');
  await expect(manifestResponse.json()).resolves.toMatchObject({
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
  });

  // ready proves installation; controller proves clientsClaim has taken over
  // this tab, which is required before an offline navigation can use the shell.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/sw\.js$/);

  // API traffic contains member data and must never enter any Cache Storage
  // cache, even when a request fails because no backend is attached to preview.
  await page.evaluate(() => fetch('/api/v1/health').catch(() => undefined));
  const cachedApiRequests = await page.evaluate(async () => {
    const requests = (
      await Promise.all((await caches.keys()).map((name) => caches.open(name).then((cache) => cache.keys())))
    ).flat();
    return requests.map((request) => request.url).filter((url) => new URL(url).pathname.startsWith('/api/'));
  });
  expect(cachedApiRequests).toEqual([]);

  // Change the bytes returned for /sw.js, then prove Workbox's skipWaiting +
  // clientsClaim lifecycle replaces the controller without closing the SPA.
  await page.evaluate(() => fetch('/__pwa-test/upgrade-worker', { method: 'POST' }));
  const controllerWasReplaced = await page.evaluate(async () => {
    const previousController = navigator.serviceWorker.controller;
    const changed = new Promise<boolean>((resolve) => {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        () => resolve(navigator.serviceWorker.controller !== previousController),
        { once: true }
      );
    });
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
    return changed;
  });
  expect(controllerWasReplaced).toBe(true);

  await context.setOffline(true);
  await page.goto('/login?offline-smoke=1');
  await expect(page.getByRole('form', { name: 'Sign in form' })).toBeVisible();
  await expect(page).toHaveTitle(/The Logbook/);
});
