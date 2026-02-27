/**
 * HIPAA Session Timeout Hook (§164.312(a)(2)(iii))
 *
 * Monitors user activity and triggers automatic logout after
 * the configured inactivity period (default 15 minutes).
 * Shows a warning toast 60 seconds before timeout.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { clearCache } from '../utils/apiCache';
import axios from 'axios';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
const WARNING_SECONDS = 60;
const DEFAULT_TIMEOUT_MINUTES = 15;

export function useIdleTimer() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const warningRef = useRef<ReturnType<typeof setTimeout>>();
  const timeoutMsRef = useRef(DEFAULT_TIMEOUT_MINUTES * 60 * 1000);
  const warningShownRef = useRef(false);

  const performLogout = useCallback(async () => {
    toast.dismiss();
    try {
      await logout();
    } catch {
      // Logout may fail if session already expired
    }
    // Clear all auth tokens from both storage mechanisms
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    sessionStorage.clear();
    navigate('/login', { state: { reason: 'timeout' }, replace: true });
  }, [logout, navigate]);

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

    timeoutRef.current = setTimeout(() => { void performLogout(); }, timeoutMs);
  }, [performLogout]);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Fetch session timeout from backend
    axios
      .get('/api/v1/auth/session-settings', { withCredentials: true })
      .then((res: { data?: { session_timeout_minutes?: number } }) => {
        const minutes = res.data?.session_timeout_minutes ?? DEFAULT_TIMEOUT_MINUTES;
        timeoutMsRef.current = minutes * 60 * 1000;
        resetTimers();
      })
      .catch(() => {
        // Use default timeout
        resetTimers();
      });

    // Add activity listeners
    const handler = () => resetTimers();
    ACTIVITY_EVENTS.forEach((event) => {
      document.addEventListener(event, handler, { passive: true });
    });

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        document.removeEventListener(event, handler);
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
    };
  }, [isAuthenticated, resetTimers]);
}
