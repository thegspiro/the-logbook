/**
 * Build identity of the running bundle vs. the build the server is serving.
 *
 * `__BUILD_ID__` is stamped into the bundle at compile time and written to
 * `/version.json` by versionJsonPlugin (vite.config.ts). Comparing the two is
 * how the app knows a deployment happened while it was open — which matters
 * most for an installed PWA, where the shell can stay resident for days
 * without a single real navigation.
 *
 * Shared by useAppUpdate (automatic detection) and the App section of user
 * settings (manual "Check for updates"), so both agree on what "current" means.
 */

/**
 * Build ID baked into this bundle at compile time.
 *
 * Read lazily rather than at module load so test stubs have a chance to define
 * the global first. Returns `undefined` when the define is absent, which is the
 * signal that version checking cannot work in this context.
 */
export function getCurrentBuildId(): string | undefined {
  return typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : undefined;
}

/**
 * Fetch the build ID the server is currently serving.
 *
 * `cache: 'no-store'` plus the NetworkOnly runtime rule in vite.config.ts keeps
 * this off both the HTTP cache and the service worker cache — a cached
 * version.json would report the running build as current forever, which is
 * precisely the failure this file exists to detect.
 *
 * Returns null on any failure (offline, non-2xx, malformed body) so callers can
 * distinguish "could not check" from "a different build is live".
 */
export async function fetchServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return null;

    const data: unknown = await res.json();
    if (typeof data === 'object' && data !== null && 'buildId' in data && typeof data.buildId === 'string') {
      return data.buildId;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Short, human-quotable form of a build ID for display and support calls.
 */
export function formatBuildId(buildId: string | undefined): string {
  if (!buildId) return 'development';
  return buildId.length > 12 ? buildId.slice(0, 12) : buildId;
}
