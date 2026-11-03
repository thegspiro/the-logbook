/**
 * The service worker's Background Sync listener.
 *
 * Not part of the app bundle: vite.config.ts compiles this file with esbuild
 * and concatenates the result into the generated dist/sw.js, the same way it
 * inlines the push handlers, so the build stays on Workbox's generateSW.
 *
 * Supplies the real browser pieces sw/backgroundSync.ts takes as parameters.
 * The types below are local because TypeScript's DOM library has no service
 * worker scope, SyncEvent or Cookie Store API; this file is compiled for the
 * worker, never type-checked as one.
 */

import { BackgroundSyncRetryLater, runBackgroundSync } from './backgroundSync';
import { BACKGROUND_SYNC_TAG, withOfflineDrainLock } from './backgroundSyncProtocol';

interface SyncEventLike extends Event {
  readonly tag: string;
  /** True on the browser's final attempt for this registration. */
  readonly lastChance?: boolean;
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerScopeLike {
  addEventListener(type: 'sync', listener: (event: SyncEventLike) => void): void;
  fetch: typeof fetch;
  clients: {
    matchAll(options: {
      type: 'window';
      includeUncontrolled: boolean;
    }): Promise<Array<{ postMessage(m: unknown): void }>>;
  };
  /** Chromium only — the same browsers that fire Background Sync at all. */
  cookieStore?: { get(name: string): Promise<{ value: string } | null> };
}

const scope = self as unknown as WorkerScopeLike;

scope.addEventListener('sync', (event) => {
  if (event.tag !== BACKGROUND_SYNC_TAG) return;
  const run = runBackgroundSync({
    fetch: (input, init) => scope.fetch(input, init),
    csrfToken: async () => (await scope.cookieStore?.get('csrf_token'))?.value ?? null,
    withLock: withOfflineDrainLock,
    notify: async (summary) => {
      const windows = await scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) client.postMessage(summary);
    },
  }).catch((err: unknown) => {
    // Rejecting asks the browser to try again later with backoff. On its last
    // attempt there is no later, and nothing has been discarded: whatever is
    // left waits for the page drains the next time the app is open.
    if (err instanceof BackgroundSyncRetryLater && event.lastChance) return;
    throw err;
  });
  event.waitUntil(run);
});
