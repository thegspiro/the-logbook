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
const WARNING_SECONDS = 60;
const DEFAULT_TIMEOUT_MINUTES = 15;

export function useIdleTimer() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const warningRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const timeoutMsRef = useRef(DEFAULT_TIMEOUT_MINUTES * 60 * 1000);
  const warningShownRef = useRef(false);
  const settingsFetchedRef = useRef(false);

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

  useEffect(() => {
    if (!isAuthenticated) {
      settingsFetchedRef.current = false;
      return;
    }

    // Fetch session timeout once per authentication session
    if (!settingsFetchedRef.current) {
      settingsFetchedRef.current = true;
      void authService
        .getSessionSettings()
        .then((data) => {
          const minutes = data.session_timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES;
          timeoutMsRef.current = minutes * 60 * 1000;
          resetTimers();
        })
        .catch(() => {
          // Use default timeout
          resetTimers();
        });
    } else {
      resetTimers();
    }

    // Add activity listeners
    const handler = () => resetTimers();
    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handler, { passive: true });
    });
    document.addEventListener(USER_ACTIVITY_EVENT, handler, { passive: true });

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handler);
      });
      document.removeEventListener(USER_ACTIVITY_EVENT, handler);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
    };
    // resetTimers and performLogout have stable identities (no external deps in useCallback)
  }, [isAuthenticated, resetTimers, performLogout]);
}
