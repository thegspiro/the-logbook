/**
 * Manual "force refresh" escape hatch.
 *
 * useAppUpdate + serviceWorkerUpdate handle the normal case: a deployment
 * lands, the version check notices, the service worker is swapped and the page
 * reloads. This file covers the case where that loop has *already* failed and
 * a device is stuck showing an old build — a wedged precache, a service worker
 * that never finished installing, a home-screen PWA resumed after weeks in the
 * background, or branding cached in localStorage that the department has since
 * changed. Those devices have no automatic way out, so this gives a member (or
 * whoever is helping them over the phone) one deliberate action that clears
 * every client-side copy of the app and reboots it from the network.
 *
 * What it deliberately does NOT touch:
 *
 *  - **The service worker registration.** Unregistering would be the more
 *    thorough nuke, but a push subscription belongs to the registration and
 *    nothing re-subscribes automatically (usePushNotifications only subscribes
 *    on an explicit tap). Silently killing push on a device that relies on it
 *    for callouts is a worse failure than the one being fixed. Deleting the
 *    caches is enough: workbox's precache strategy falls back to the network on
 *    a miss and re-caches what it fetches, so the precache heals itself on the
 *    reload this triggers.
 *  - **The offline queues (IndexedDB).** Those hold work the member has done
 *    but not yet synced. A refresh must never be the thing that loses a shift
 *    report.
 *  - **`has_session` / auth cookies.** This is a refresh, not a logout.
 */

import { clearCache } from './apiCache';
import { activateFreshServiceWorker } from './serviceWorkerUpdate';
import { fetchServerBuildId } from './appVersion';

/**
 * localStorage keys holding a copy of server-owned display data.
 *
 * AppLayout writes branding here and then only re-fetches when
 * `departmentName` is missing, so a department that renames itself or changes
 * its logo leaves every existing device showing the old one indefinitely.
 * Dropping these keys makes the next load re-fetch from `/auth/branding`.
 */
const STALE_DISPLAY_CACHE_KEYS = ['departmentName', 'logoData'] as const;

/**
 * Delete every Cache Storage entry — the workbox precache holding index.html
 * and the app shell, plus the `app-chunks` runtime cache holding lazily loaded
 * route chunks.
 *
 * Resolves even when the Cache Storage API is unavailable (older browsers,
 * insecure contexts, jsdom) or a single delete fails: a partial purge followed
 * by a reload is still strictly better than no purge at all.
 */
export async function purgeCacheStorage(): Promise<void> {
  if (typeof caches === 'undefined') return;

  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
  } catch {
    // Storage unavailable or blocked — fall through to the reload.
  }
}

/**
 * Drop client-side copies of app code and server-owned display data, without
 * reloading. Exposed separately so callers that already control the navigation
 * (or tests) can purge without triggering one.
 */
export async function purgeAppCaches(): Promise<void> {
  clearCache();

  for (const key of STALE_DISPLAY_CACHE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage disabled (private mode, blocked cookies) — nothing to purge.
    }
  }

  await purgeCacheStorage();
}

export type ForceRefreshOutcome =
  /** Caches dropped and the page is reloading onto the served build. */
  | 'reloading'
  /** Nothing was touched: the server could not be reached, so a purge would
      have discarded the only working copy of the app. */
  | 'unreachable';

/**
 * Whether the real app server is reachable right now.
 *
 * Deliberately stricter than `navigator.onLine`, which reports true for a
 * device attached to station Wi-Fi behind a captive portal — a network that
 * answers every request with a login page. Requiring a parseable
 * `/version.json` proves we reached The Logbook itself and not an interception
 * page, which is the same failure mode already documented for blank screens on
 * station Wi-Fi.
 *
 * `navigator.onLine === false` is checked first purely as a fast path: it is
 * unreliable when true but conclusive when false, so it saves a doomed request.
 *
 * Note this refuses in development, where versionJsonPlugin does not run and
 * there is no `/version.json`. That is not worth special-casing: the service
 * worker is only registered in production builds, so in dev there is no
 * precache to lose and nothing for this function to protect.
 */
export async function canReachServer(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  return (await fetchServerBuildId()) !== null;
}

/**
 * Purge every client-side copy of the app, pull the newest service worker, and
 * reload onto the current build.
 *
 * **Refuses to do anything while the server is unreachable.** The precache is
 * the app's only offline copy, and workbox only heals a deleted precache entry
 * by fetching it — so purging offline deletes the shell, and the reload that
 * follows has nothing to load and no way to get it. The installed PWA would be
 * bricked until connectivity returned, which is a far worse outcome than the
 * stale build the member was trying to fix, and it would land hardest on the
 * rural cellular connections this app is used from.
 *
 * A member who taps this *because* something looks wrong is exactly the person
 * likely to be out of signal at the time, so the guard is not a corner case.
 *
 * Order otherwise matters: the caches are dropped *before* the service worker
 * swap so the incoming worker precaches the new build rather than having its
 * fresh precache deleted out from under it. Past the reachability check the
 * reload is unconditional — if the purge or the worker swap fails, the user
 * still gets the reload they asked for.
 *
 * Connectivity can still drop between the check and the reload; that window is
 * milliseconds and cannot be closed from the page, since the precache is keyed
 * by workbox's own revisioned URLs and cannot be repopulated from here.
 */
export async function forceAppRefresh(): Promise<ForceRefreshOutcome> {
  if (!(await canReachServer())) return 'unreachable';

  try {
    await purgeAppCaches();
  } catch {
    // Never let a purge failure block the reload.
  }

  try {
    await activateFreshServiceWorker();
  } catch {
    // Never let a service worker failure block the reload.
  }

  window.location.reload();
  return 'reloading';
}
