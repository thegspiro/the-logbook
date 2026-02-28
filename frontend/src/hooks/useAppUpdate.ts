/**
 * App Update Detection Hook
 *
 * Proactively checks for new frontend deployments by polling a
 * `/version.json` file whose `buildId` is stamped at build time.
 *
 * Checks are triggered by:
 *  - Route navigation (React Router location changes)
 *  - Tab/window gaining focus (visibilitychange)
 *  - A periodic fallback interval (every 5 minutes)
 *
 * All triggers are rate-limited so the server sees at most one
 * request per `MIN_CHECK_INTERVAL_MS` window.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';

/** Minimum time between two consecutive version checks (60 seconds). */
const MIN_CHECK_INTERVAL_MS = 60_000;

/** Fallback polling interval when no navigation or focus events fire. */
const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

/**
 * Build ID baked into this bundle at compile time.
 * Evaluated lazily (not at module-load) so that test stubs have time
 * to set the global before the first call.
 * In development (where versionJsonPlugin doesn't run) this returns
 * `undefined`, and the hook is a no-op.
 */
function getCurrentBuildId(): string | undefined {
  return typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : undefined;
}

export interface AppUpdateState {
  /** True once a newer build has been detected on the server. */
  updateAvailable: boolean;
  /** Reload the page to apply the new version. */
  applyUpdate: () => void;
  /** Dismiss the notification (re-shown on next detection). */
  dismiss: () => void;
}

export function useAppUpdate(): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const lastCheckRef = useRef(0);
  const dismissedBuildRef = useRef<string | null>(null);
  const location = useLocation();

  const checkForUpdate = useCallback(async () => {
    // Skip in dev or when offline
    if (!getCurrentBuildId() || !navigator.onLine) return;

    // Rate-limit
    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;

    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (!res.ok) return;

      const data: unknown = await res.json();
      if (
        typeof data === 'object' &&
        data !== null &&
        'buildId' in data &&
        typeof (data as { buildId: unknown }).buildId === 'string'
      ) {
        const serverBuildId = (data as { buildId: string }).buildId;
        if (
          serverBuildId !== getCurrentBuildId() &&
          serverBuildId !== dismissedBuildRef.current
        ) {
          setUpdateAvailable(true);
        }
      }
    } catch {
      // Network error — silently ignore
    }
  }, []);

  // Check on route change
  useEffect(() => {
    void checkForUpdate();
  }, [location.pathname, checkForUpdate]);

  // Check on tab focus
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [checkForUpdate]);

  // Periodic fallback
  useEffect(() => {
    const id = setInterval(() => {
      void checkForUpdate();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkForUpdate]);

  const applyUpdate = useCallback(() => {
    window.location.reload();
  }, []);

  const dismiss = useCallback(() => {
    setUpdateAvailable(false);
    // Remember which build the user dismissed so we don't re-show until
    // yet another deployment happens.
    // We read the latest server build from the last successful check.
    // Since the user is dismissing, we just mark the current detection
    // as dismissed — the ref will be compared on the next check.
    dismissedBuildRef.current = 'dismissed';
    // Re-fetch once to capture the exact build ID that was dismissed
    void fetch('/version.json', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: unknown) => {
        if (
          typeof d === 'object' &&
          d !== null &&
          'buildId' in d &&
          typeof (d as { buildId: unknown }).buildId === 'string'
        ) {
          dismissedBuildRef.current = (d as { buildId: string }).buildId;
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  return { updateAvailable, applyUpdate, dismiss };
}
