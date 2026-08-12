/**
 * Service worker update helpers for installed PWAs.
 *
 * The browser only re-checks `/sw.js` on a real navigation or on its own
 * ~24h timer. An installed PWA is a long-lived SPA — client-side route
 * changes are not navigations — so without these helpers a member who keeps
 * the app on their home screen can run a stale build for a day or more.
 *
 * Worse, when the user does reload, the OLD service worker serves its OLD
 * precached index.html: the new worker installs during that navigation but
 * the page has already booted with stale assets, so a single reload appears
 * to do nothing ("I reloaded and it's still broken"). The fix is to update
 * the registration FIRST, wait for the new worker to take control (the
 * generated worker uses skipWaiting + clientsClaim, so it claims the page
 * without a navigation), and only then reload — one reload, fresh shell.
 */

/**
 * How long to wait for a freshly installed worker to take control before
 * reloading anyway. Covers the pathological cases (SW fetch hangs on a bad
 * cellular link, controllerchange never fires) so the user's tap on
 * "Reload now" can never wedge.
 */
const ACTIVATE_TIMEOUT_MS = 4_000;

/**
 * Ask the browser to re-fetch `/sw.js` and install any new version, without
 * waiting for the result. Deliberately has no triggers or rate limiting of
 * its own: it rides useAppUpdate's version checks, which already fire on
 * route changes, on tab/app resume (visibilitychange — the trigger that
 * matters for an installed PWA re-opened from the home screen), and on a
 * periodic fallback, all rate-limited to once a minute.
 */
export function nudgeServiceWorkerUpdate(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .getRegistration()
    .then((registration) => registration?.update())
    .catch(() => {
      // Offline or SW fetch failed — the next check will retry.
    });
}

/**
 * Fetch the latest service worker and wait until it controls the page (or a
 * timeout elapses). After this resolves, a reload is served from the NEW
 * worker's precache — new index.html, new chunk references.
 *
 * Resolves immediately when there is no SW support, no registration, or the
 * update check finds the worker already current.
 */
export async function activateFreshServiceWorker(timeoutMs = ACTIVATE_TIMEOUT_MS): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.getRegistration();
  } catch {
    return;
  }
  if (!registration) return;

  // Subscribe BEFORE calling update() — with skipWaiting + clientsClaim the
  // new worker can take control while update() is still resolving.
  const controllerChanged = new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
      once: true,
    });
  });

  try {
    await registration.update();
  } catch {
    return;
  }

  // Nothing installing and nothing waiting: the background nudge (or the
  // browser's own check) already activated the new worker, or there is no
  // new worker. Either way a reload is already safe — don't burn the timeout.
  if (!registration.installing && !registration.waiting) return;

  await Promise.race([controllerChanged, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

/**
 * Apply a detected update: swap in the fresh service worker, then reload.
 * The reload always happens, even if the SW steps fail — worst case is the
 * old behavior (reload now, new worker finishes installing for next time).
 */
export async function reloadForNewVersion(): Promise<void> {
  try {
    await activateFreshServiceWorker();
  } catch {
    // Never let a SW failure block the reload.
  }
  window.location.reload();
}
