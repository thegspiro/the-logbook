/**
 * Pull-to-Refresh Hook (#68)
 *
 * Enables pull-to-refresh gesture on mobile devices for PWA.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
}

interface PullToRefreshState {
  pulling: boolean;
  refreshing: boolean;
  pullDistance: number;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  disabled = false,
}: UsePullToRefreshOptions): PullToRefreshState {
  const [state, setState] = useState<PullToRefreshState>({
    pulling: false,
    refreshing: false,
    pullDistance: 0,
  });
  const startYRef = useRef(0);
  const pullingRef = useRef(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || window.scrollY > 0) return;
      const touch = e.touches[0];
      if (!touch) return;
      startYRef.current = touch.clientY;
      pullingRef.current = true;
    },
    [disabled]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!pullingRef.current || disabled) return;

      const touch = e.touches[0];
      if (!touch) return;
      const currentY = touch.clientY;
      const distance = Math.max(0, (currentY - startYRef.current) * 0.5);

      if (distance > 0 && window.scrollY <= 0) {
        setState((prev) => ({ ...prev, pulling: true, pullDistance: Math.min(distance, threshold * 1.5) }));
      }
    },
    [disabled, threshold]
  );

  const handleTouchEnd = useCallback(() => {
    if (!pullingRef.current || disabled) return;
    pullingRef.current = false;

    if (state.pullDistance >= threshold) {
      setState((prev) => ({ ...prev, refreshing: true, pullDistance: 0 }));
      void onRefresh().finally(() => {
        setState({ pulling: false, refreshing: false, pullDistance: 0 });
      });
    } else {
      setState({ pulling: false, refreshing: false, pullDistance: 0 });
    }
  }, [disabled, state.pullDistance, threshold, onRefresh]);

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return state;
}
