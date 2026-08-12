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
import { useLocation } from 'react-router';

/** Minimum time between two consecutive version checks (60 seconds). */
const MIN_CHECK_INTERVAL_MS = 60_000;

/** Fallback polling interval when no navigation or focus events fire. */
const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

/** Re-prompt after a deferral so a security update is not ignored forever. */
const UPDATE_REMINDER_MS = 60 * 60_000; // 1 hour

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
  /** Defer the notification for one hour. */
  dismiss: () => void;
}

export function useAppUpdate(): AppUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const lastCheckRef = useRef(0);
  const deferredBuildRef = useRef<{ buildId: string; until: number } | null>(null);
  const detectedBuildRef = useRef<string | null>(null);
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
      if (typeof data === 'object' && data !== null && 'buildId' in data && typeof data.buildId === 'string') {
        const serverBuildId = (data as { buildId: string }).buildId;
        const deferred = deferredBuildRef.current;
        const isStillDeferred = deferred?.buildId === serverBuildId && Date.now() < deferred.until;
        if (serverBuildId !== getCurrentBuildId() && !isStillDeferred) {
          detectedBuildRef.current = serverBuildId;
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
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [checkForUpdate]);

  // Check immediately when a device regains connectivity instead of waiting
  // for the next five-minute poll.
  useEffect(() => {
    const handleOnline = () => {
      lastCheckRef.current = 0;
      void checkForUpdate();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [checkForUpdate]);

  // Periodic fallback
  useEffect(() => {
    const id = setInterval(() => {
      void checkForUpdate();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkForUpdate]);

  const applyUpdate = useCallback(() => {
    // Discover/install the newest worker before reloading. A plain reload can
    // otherwise still be served by the old worker and appear to do nothing.
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update())
        .finally(() => window.location.reload());
      return;
    }
    window.location.reload();
  }, []);

  const dismiss = useCallback(() => {
    setUpdateAvailable(false);
    const buildId = detectedBuildRef.current;
    if (buildId) {
      deferredBuildRef.current = { buildId, until: Date.now() + UPDATE_REMINDER_MS };
    }
  }, []);

  return { updateAvailable, applyUpdate, dismiss };
}
