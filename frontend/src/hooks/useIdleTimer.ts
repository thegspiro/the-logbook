/**
 * HIPAA Session Timeout Hook (§164.312(a)(2)(iii))
 *
 * Monitors user activity and triggers automatic logout after
 * the configured inactivity period (default 15 minutes).
 * Shows a warning toast 60 seconds before timeout.
 *
 * "Activity" is DOM input by default, which misses one real case: an NFC card
 * tapped against a check-in station fires no mouse, key, scroll or touch event
 * at all, so a tablet at a bay door being used constantly looked idle and
 * logged itself out mid-drill. `signalUserActivity()` lets such a surface say
 * a person is demonstrably present.
 *
 * That is deliberately a *reset*, not an exemption. A station with nobody
 * tapping it still times out on schedule, because the control exists for
 * exactly that state — an authenticated session left unattended in a bay,
 * showing the names of everyone who has checked in.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { clearCache } from '../utils/apiCache';
import { authService } from '../services/api';
import type { SessionSettings } from '../types/auth';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;

/**
 * Event name for input this hook cannot observe directly.
 *
 * A custom event rather than a synthesized `keydown`: a fake key event would
 * also reach every other keyboard listener on the page — including the
 * check-in station's own USB-reader capture, which would read it as part of a
 * card serial.
 */
export const USER_ACTIVITY_EVENT = 'logbook:user-activity';

/**
 * Tell the session timer a person is physically at the device.
 *
 * For input the DOM does not report as an event — currently an NFC tap. Call
 * it only for something a *person* did; calling it on a timer or a poll would
 * turn the session timeout off while pretending it was still on.
 */
export function signalUserActivity(): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(USER_ACTIVITY_EVENT));
}

/**
 * Event name for "the session's limits just changed" — fired by the kiosk
 * session card after it switches the session, so this hook re-reads the idle
 * timeout and lifetime instead of running on the ones it fetched at sign-in.
 */
export const SESSION_SETTINGS_CHANGED_EVENT = 'logbook:session-settings-changed';

export function signalSessionSettingsChanged(): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(SESSION_SETTINGS_CHANGED_EVENT));
}

const WARNING_SECONDS = 60;
/** How long before the absolute lifetime ends the member is told. */
const CAP_WARNING_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MINUTES = 15;

/**
 * How often real input is reported to the server.
 *
 * The server ends a session after a stretch with no activity, and counts only
 * requests a person caused (background polls say they are not). Somebody who
 * spends twenty minutes typing a report makes no request at all, so without
 * this the server would log them out and lose the work. One ordinary request
 * every couple of minutes of real input keeps the two timers agreeing. It is
 * kept well inside the timeout: a short timeout shortens it.
 */
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

export function useIdleTimer() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const warningRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const timeoutMsRef = useRef(DEFAULT_TIMEOUT_MINUTES * 60 * 1000);
  const warningShownRef = useRef(false);
  const settingsFetchedRef = useRef(false);
  const capWarningRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const capEndsAtRef = useRef<string | null | undefined>(undefined);
  const lastHeartbeatRef = useRef(0);

  // Keep mutable refs to latest values so resetTimers never needs to change identity
  const logoutRef = useRef(logout);
  const navigateRef = useRef(navigate);
  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const performLogout = useCallback(async () => {
    toast.dismiss();
    try {
      await logoutRef.current();
    } catch {
      // Logout may fail if session already expired
    }
    // Clear session flag and transient storage.
    // Actual auth tokens live in httpOnly cookies (cleared by logout API call above).
    localStorage.removeItem('has_session');
    sessionStorage.clear();
    void navigateRef.current('/login', { state: { reason: 'timeout' }, replace: true });
  }, []);

  const resetTimers = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);

    // Dismiss any active warning toast
    if (warningShownRef.current) {
      toast.dismiss('idle-warning');
      warningShownRef.current = false;
    }

    const timeoutMs = timeoutMsRef.current;
    const warningMs = Math.max(timeoutMs - WARNING_SECONDS * 1000, 0);

    warningRef.current = setTimeout(() => {
      warningShownRef.current = true;
      // Clear cached API data while the user is idle to reduce PII exposure window
      clearCache();
      toast(
        'Your session will expire in 60 seconds due to inactivity. Move the mouse or press a key to stay logged in.',
        {
          id: 'idle-warning',
          duration: WARNING_SECONDS * 1000,
          icon: '\u26A0\uFE0F',
          style: {
            background: 'var(--toast-warning-bg)',
            color: 'var(--toast-warning-text)',
            fontWeight: '500',
          },
        }
      );
    }, warningMs);

    timeoutRef.current = setTimeout(() => {
      void performLogout();
    }, timeoutMs);
  }, [performLogout]);

  // The absolute lifetime is enforced by the server whatever the browser does,
  // so the most this can do is give the member time to save their work.
  const applySettings = useCallback((data: SessionSettings) => {
    timeoutMsRef.current = (data.session_timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES) * 60 * 1000;
    // The heartbeat re-reads settings every couple of minutes; rescheduling an
    // unchanged warning would dismiss and re-show it each time.
    const endsAtKey = data.session_ends_at ?? null;
    if (capEndsAtRef.current === endsAtKey && capEndsAtRef.current !== undefined) return;
    capEndsAtRef.current = endsAtKey;
    if (capWarningRef.current) clearTimeout(capWarningRef.current);
    toast.dismiss('session-cap-warning');
    if (!data.session_ends_at) return;
    const endsAt = new Date(data.session_ends_at).getTime();
    if (Number.isNaN(endsAt)) return;
    const remaining = endsAt - Date.now();
    if (remaining <= 0) return;
    capWarningRef.current = setTimeout(
      () => {
        const left = Math.max(endsAt - Date.now(), 0);
        toast(
          `Your session reaches its time limit in ${Math.max(Math.ceil(left / 60000), 1)} minutes. Save your work; you will need to sign in again.`,
          {
            id: 'session-cap-warning',
            duration: Math.max(left, 1000),
            icon: '\u26A0\uFE0F',
            style: {
              background: 'var(--toast-warning-bg)',
              color: 'var(--toast-warning-text)',
              fontWeight: '500',
            },
          }
        );
      },
      Math.max(remaining - CAP_WARNING_MS, 0)
    );
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      settingsFetchedRef.current = false;
      capEndsAtRef.current = undefined;
      return;
    }

    // Fetch session timeout once per authentication session
    if (!settingsFetchedRef.current) {
      settingsFetchedRef.current = true;
      void authService
        .getSessionSettings()
        .then((data) => {
          applySettings(data);
          resetTimers();
        })
        .catch(() => {
          // Use default timeout
          resetTimers();
        });
    } else {
      resetTimers();
    }

    // Add activity listeners. Real input also reaches the server, throttled.
    const handler = () => {
      resetTimers();
      const now = Date.now();
      const interval = Math.min(HEARTBEAT_INTERVAL_MS, timeoutMsRef.current / 3);
      if (now - lastHeartbeatRef.current < interval) return;
      lastHeartbeatRef.current = now;
      // An ordinary (not background) request, so the server counts it. A 401
      // is handled like any other by the API client; nothing to do here.
      void authService
        .getSessionSettings()
        .then(applySettings)
        .catch(() => undefined);
    };
    const settingsChanged = () => {
      void authService
        .getSessionSettings()
        .then((data) => {
          applySettings(data);
          resetTimers();
        })
        .catch(() => undefined);
    };
    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handler, { passive: true });
    });
    document.addEventListener(USER_ACTIVITY_EVENT, handler, { passive: true });
    document.addEventListener(SESSION_SETTINGS_CHANGED_EVENT, settingsChanged);

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handler);
      });
      document.removeEventListener(USER_ACTIVITY_EVENT, handler);
      document.removeEventListener(SESSION_SETTINGS_CHANGED_EVENT, settingsChanged);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      if (capWarningRef.current) clearTimeout(capWarningRef.current);
    };
    // resetTimers, applySettings and performLogout have stable identities (no external deps in useCallback)
  }, [isAuthenticated, resetTimers, applySettings, performLogout]);
}
