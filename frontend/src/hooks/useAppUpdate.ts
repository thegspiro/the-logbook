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
 *
 * Each allowed check also nudges the service worker registration, so an
 * installed PWA picks up a new deployment without waiting for the browser's
 * own ~24h service worker update cadence. This hook (via UpdateNotification,
 * mounted above the router) is the single owner of update detection.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useLocation } from 'react-router';
import { nudgeServiceWorkerUpdate, reloadForNewVersion } from '../utils/serviceWorkerUpdate';

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
  const lastSeenServerBuildRef = useRef<string | null>(null);
  const location = useLocation();

  const checkForUpdate = useCallback(async () => {
    // Skip in dev or when offline
    if (!getCurrentBuildId() || !navigator.onLine) return;

    // Rate-limit
    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;

    // Piggyback a service worker update check on the same cadence. Keeping
    // the worker fresh here — rather than waiting for the browser's own ~24h
    // check — is what lets an installed PWA apply a deployment in one reload.
    nudgeServiceWorkerUpdate();

    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      if (!res.ok) return;

      const data: unknown = await res.json();
      if (typeof data === 'object' && data !== null && 'buildId' in data && typeof data.buildId === 'string') {
        const serverBuildId = (data as { buildId: string }).buildId;
        lastSeenServerBuildRef.current = serverBuildId;
        if (serverBuildId !== getCurrentBuildId() && serverBuildId !== dismissedBuildRef.current) {
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

  // Periodic fallback
  useEffect(() => {
    const id = setInterval(() => {
      void checkForUpdate();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkForUpdate]);

  const applyUpdate = useCallback(() => {
    // Not a bare reload: on an installed PWA the old service worker would
    // serve its old precached index.html, making the reload a visible no-op.
    void reloadForNewVersion();
  }, []);

  const dismiss = useCallback(() => {
    setUpdateAvailable(false);
    // Remember which build the user dismissed so the banner stays hidden
    // until yet another deployment produces a different buildId.
    dismissedBuildRef.current = lastSeenServerBuildRef.current;
  }, []);

  return { updateAvailable, applyUpdate, dismiss };
}
