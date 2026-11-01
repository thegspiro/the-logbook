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

test('a page chunk that stays unreachable reloads once, then shows the error', async ({ browser }) => {
  // Without a worker, as on a first visit or an embedded form. Aborting the
  // chunk stands in for any way it can stay out of reach: a deploy that
  // removed it, or station Wi-Fi's captive portal answering for it.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route(/\/assets\/PublicFormPage-[^/]+\.js$/, (route) => route.abort());
  const page = await context.newPage();

  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  await page.goto('/f/abcdef123456');

  // One automatic reload is the recovery; a second is the loop.
  await expect(page.getByText('New Version Available')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000);
  expect(loads).toBe(2);

  await context.close();
});

test('a background sync sends a queued training submission from the service worker', async ({ context, page }) => {
  await page.goto('/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  });
  await context.addCookies([{ name: 'csrf_token', value: 'csrf-e2e', url: 'http://127.0.0.1:4173' }]);

  // Queued exactly as genericOfflineQueue stores it, owned by the member the
  // stand-in /auth/me reports, so the worker's owner check lets it through.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('logbook-offline-generic', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('pendingMutations', { keyPath: 'id' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('open failed'));
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('pendingMutations', 'readwrite');
      tx.objectStore('pendingMutations').put({
        id: 'g-e2e',
        ownerId: 'member-e2e',
        kind: 'training-submission',
        url: '/training/submissions',
        body: { course_name: 'Ladder drill', client_request_id: 'e2e-request-0001' },
        label: 'Training: Ladder drill',
        queuedAt: Date.now(),
        retries: 0,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('put failed'));
    });
    db.close();
  });

  // The browser decides when to fire a real sync; DevTools fires one now.
  const cdp = await context.newCDPSession(page);
  const registrationId = await new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
      const live = registrations.find((r: { isDeleted: boolean }) => !r.isDeleted);
      if (live) resolve(live.registrationId);
    });
    void cdp.send('ServiceWorker.enable');
  });
  await cdp.send('ServiceWorker.dispatchSyncEvent', {
    origin: 'http://127.0.0.1:4173',
    registrationId,
    tag: 'logbook-offline-sync',
    lastChance: false,
  });

  await expect
    .poll(async (): Promise<unknown> => (await (await page.request.get('/__pwa-test/received')).json()) as unknown, {
      timeout: 10_000,
    })
    .toEqual([{ body: { course_name: 'Ladder drill', client_request_id: 'e2e-request-0001' }, csrf: 'csrf-e2e' }]);

  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('logbook-offline-generic', 1);
        open.onsuccess = () => {
          const req = open.result.transaction('pendingMutations').objectStore('pendingMutations').count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error ?? new Error('count failed'));
        };
        open.onerror = () => reject(open.error ?? new Error('open failed'));
      })
  );
  expect(left).toBe(0);
});
