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

/**
 * Walks up from the touch target looking for a scrollable ancestor that is
 * already scrolled away from its top. Such an element owns the downward drag.
 */
function isInsideScrolledContainer(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    if (node.scrollTop > 0) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return true;
    }
    node = node.parentElement;
  }
  return false;
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
  const pullDistanceRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || window.scrollY > 0) return;
      // A modal or the nav drawer is open — they lock body scroll while shown.
      // Refreshing the page out from under an open dialog would discard
      // whatever the user was editing, so never arm the gesture there.
      if (document.body.style.overflow === 'hidden') return;
      const touch = e.touches[0];
      if (!touch) return;
      // window.scrollY only describes the document. A downward drag that starts
      // inside an already-scrolled inner container (modal body, side panel,
      // any overflow-y-auto region) belongs to that container, not to
      // pull-to-refresh — arming here would refresh the page instead of
      // scrolling the content under the finger.
      if (isInsideScrolledContainer(e.target)) return;
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
        const clamped = Math.min(distance, threshold * 1.5);
        pullDistanceRef.current = clamped;
        setState((prev) => ({ ...prev, pulling: true, pullDistance: clamped }));
      }
    },
    [disabled, threshold]
  );

  const handleTouchEnd = useCallback(() => {
    if (!pullingRef.current || disabled) return;
    pullingRef.current = false;

    if (pullDistanceRef.current >= threshold) {
      setState((prev) => ({ ...prev, refreshing: true, pullDistance: 0 }));
      pullDistanceRef.current = 0;
      void onRefreshRef.current().finally(() => {
        setState({ pulling: false, refreshing: false, pullDistance: 0 });
      });
    } else {
      pullDistanceRef.current = 0;
      setState({ pulling: false, refreshing: false, pullDistance: 0 });
    }
  }, [disabled, threshold]);

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
