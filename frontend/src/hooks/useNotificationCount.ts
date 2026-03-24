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
 * Mount this once in a layout-level component; other consumers
 * can read `useNotificationCountStore` directly.
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

  useEffect(() => {
    void fetchCount();
    intervalRef.current = setInterval(() => { void fetchCount(); }, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchCount]);

  return fetchCount;
}
