/**
 * Whether an error is a failed dynamic import of one of the app's own chunks —
 * the signature of a page asking for a file from a build that is no longer
 * deployed, or a network that answered for it with something else.
 *
 * Shared by lazyWithRetry (which reloads onto the current build) and
 * ErrorBoundary (which offers the new version instead of a generic crash), so
 * the two cannot drift apart: they were separate copies, and both missed
 * Firefox's wording together.
 *
 * Each browser words the failure differently and none of them share a phrase:
 *  - Chrome:  "Failed to fetch dynamically imported module: <url>"
 *  - Firefox: "error loading dynamically imported module: <url>"
 *  - Safari:  "Importing a module script failed."
 * The "loading chunk" forms come from webpack-style loaders and are kept for
 * any dependency that still uses one.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('loading chunk') ||
    msg.includes('loading css chunk') ||
    msg.includes('importing a module script failed')
  );
}
