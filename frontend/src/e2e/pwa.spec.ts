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

  // /.well-known/ documents (security.txt, OAuth discovery) are answered by
  // the backend. The test server 404s them, so a 200 HTML body here would be
  // the worker's precached app shell standing in for the real file.
  const wellKnown = await page.goto('/.well-known/security.txt');
  expect(wellKnown?.status()).toBe(404);
  await page.goto('/login');

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

test('an embedded form does not install the worker on the embedding site', async ({ page }) => {
  // A department's own website, on a different site from the app. Every
  // visitor to that page loads the iframe, and must not be handed the whole
  // intranet's precache along with the form. The test server answers it, as
  // http://localhost — a different site from 127.0.0.1, yet still loopback: a
  // page.route() document counts as public to Chrome's local-network checks,
  // which then refuse to let it frame a loopback address at all.
  await page.goto('http://localhost:4173/__pwa-test/embedding-site');

  const frame = page.frameLocator('iframe');
  await expect(frame.locator('#root > *').first()).toBeAttached();
  const embedded = page.frames().find((f) => f.url().includes('/embed/f/'));
  expect(embedded).toBeDefined();

  // Registration is attempted on `load`; give a registration that was going
  // to happen time to appear before asserting that none did.
  await page.waitForTimeout(2_000);
  const state = await embedded?.evaluate(async () => ({
    registered: Boolean(await navigator.serviceWorker.getRegistration()),
    caches: await caches.keys(),
  }));
  expect(state).toEqual({ registered: false, caches: [] });
});
