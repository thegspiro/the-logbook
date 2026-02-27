/**
 * Lazy-load wrapper with retry + auto-reload for stale chunk errors.
 *
 * After a deployment Vite produces new hashed filenames. Users whose
 * browser still holds the old HTML will request chunks that no longer
 * exist, causing "Failed to fetch dynamically imported module" errors.
 *
 * `lazyWithRetry` handles this by:
 *  1. Retrying the dynamic import once (covers transient network blips).
 *  2. If the retry also fails and the error looks like a chunk-load
 *     failure, performing a full page reload so the browser fetches the
 *     new HTML with updated chunk references.
 *  3. Using sessionStorage to prevent infinite reload loops — if a
 *     reload was already attempted for the same page, the error is
 *     re-thrown and caught by the ErrorBoundary instead.
 */

import { lazy, type ComponentType } from "react";

const RELOAD_KEY = "chunk_reload";

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("importing a module script failed")
  );
}

/**
 * Drop-in replacement for `React.lazy()` that retries failed dynamic
 * imports and reloads the page on stale-chunk errors.
 *
 * Usage — exactly the same as `lazy()`:
 *
 *   const MyPage = lazyWithRetry(() => import('./MyPage'));
 *   const MyPage = lazyWithRetry(() => import('./MyPage').then(m => ({ default: m.MyPage })));
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() =>
    importFn().catch((error: unknown) => {
      // Retry once — covers transient network errors
      return importFn().catch((retryError: unknown) => {
        // If this is a chunk-load failure, try a full page reload
        if (isChunkLoadError(retryError)) {
          const reloadedPage = sessionStorage.getItem(RELOAD_KEY);
          const currentPath = window.location.pathname + window.location.search;

          if (reloadedPage !== currentPath) {
            // First failure on this page — reload to get fresh HTML
            sessionStorage.setItem(RELOAD_KEY, currentPath);
            window.location.reload();

            // Return a never-resolving promise to prevent React from
            // rendering while the reload is in progress
            return new Promise<{ default: T }>(() => {});
          }

          // Already reloaded once for this page — clear the flag and
          // let the error propagate to the ErrorBoundary
          sessionStorage.removeItem(RELOAD_KEY);
        }

        throw retryError ?? error;
      });
    }),
  );
}

/**
 * Clear the reload guard. Call this once the app boots successfully so
 * that future chunk errors on the same page can trigger a reload again.
 */
export function clearChunkReloadFlag(): void {
  sessionStorage.removeItem(RELOAD_KEY);
}
