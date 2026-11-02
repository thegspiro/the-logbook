/**
 * Ask the browser to fire a Background Sync for the offline queues.
 *
 * Called whenever an item is queued. Where the browser supports it (Chromium),
 * the service worker sends the queue once signal returns, even after the app
 * has been closed; see sw/backgroundSync.ts. Elsewhere this does nothing and
 * the page drains in useOfflineSyncEngine remain the only way out.
 *
 * Looks the registration up with `getRegistration()` rather than waiting on
 * `navigator.serviceWorker.ready`, which never settles without a worker, and
 * never throws: queuing an item must not fail because a sync could not be
 * asked for. Resolves whether the browser took the registration, so a caller
 * can tell a member the worker will send something.
 */

import { BACKGROUND_SYNC_TAG } from '../sw/backgroundSyncProtocol';

interface SyncManagerLike {
  register: (tag: string) => Promise<void>;
}

export async function requestBackgroundSync(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    // SyncManager is not in TypeScript's DOM library: it exists only in
    // Chromium, which is also the reason this has to check for it.
    const sync = (registration as (ServiceWorkerRegistration & { sync?: SyncManagerLike }) | undefined)?.sync;
    if (!sync) return false;
    await sync.register(BACKGROUND_SYNC_TAG);
    return true;
  } catch {
    // Unsupported here, or refused. The page drains still send the item.
    return false;
  }
}
