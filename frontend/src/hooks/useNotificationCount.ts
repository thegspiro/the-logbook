import { useEffect, useCallback, useRef } from 'react';
import { create } from 'zustand';
import { notificationsService } from '../services/api';

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
 */
export function useNotificationPoller() {
  const setUnreadCount = useNotificationCountStore((s) => s.setUnreadCount);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    intervalRef.current = setInterval(() => { void fetchCount(); }, POLL_INTERVAL_MS);
  }, [fetchCount]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
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
  }, [fetchCount, startPolling, stopPolling]);

  return fetchCount;
}
