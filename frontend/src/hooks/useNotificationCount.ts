import { useEffect, useCallback, useRef } from 'react';
import { create } from 'zustand';
import { notificationsService } from '../services/api';
import { useEnabledModules } from './useEnabledModules';

const POLL_INTERVAL_MS = 60_000;

interface NotificationCountState {
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  decrement: () => void;
  clear: () => void;
}

export const useNotificationCountStore = create<NotificationCountState>((set) => ({
  unreadCount: 0,
  setUnreadCount: (count: number) => set({ unreadCount: count }),
  decrement: () => set((s) => ({ unreadCount: Math.max(0, s.unreadCount - 1) })),
  clear: () => set({ unreadCount: 0 }),
}));

/**
 * Polls the unread notification count every 60 seconds.
 * Pauses when the browser tab is hidden and refetches immediately
 * when the tab becomes visible again. Mount once in a layout-level
 * component; other consumers read `useNotificationCountStore` directly.
 *
 * Silent when the Notifications module is off. `/notifications` is gated, so
 * the poller would otherwise ask a refusing endpoint every 60 seconds and on
 * every tab focus, for every signed-in member, for as long as the department
 * leaves the module off — and 403s reach the error reporter, so a deliberate
 * configuration would read as a fault in the logs. Permissive while the
 * module config is unknown, as every other gate is.
 */
export function useNotificationPoller() {
  const setUnreadCount = useNotificationCountStore((s) => s.setUnreadCount);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { isModuleOn, isLoading: modulesLoading } = useEnabledModules();
  const notificationsOn = isModuleOn('notifications');

  const fetchCount = useCallback(async () => {
    try {
      const data = await notificationsService.getMyUnreadCount();
      setUnreadCount(data.unread_count);
    } catch {
      // Silently ignore — user may be logged out or network unavailable
    }
  }, [setUnreadCount]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      void fetchCount();
    }, POLL_INTERVAL_MS);
  }, [fetchCount]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Wait for the answer rather than firing one refused request first: the
    // hook settles either way, so this only defers the first poll.
    if (modulesLoading || !notificationsOn) return undefined;

    void fetchCount();
    startPolling();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        void fetchCount();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchCount, startPolling, stopPolling, modulesLoading, notificationsOn]);

  return fetchCount;
}
