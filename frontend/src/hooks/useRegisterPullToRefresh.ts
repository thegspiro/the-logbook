/**
 * useRegisterPullToRefresh
 *
 * Registers a data-refresh handler for the app's layout-level pull-to-refresh
 * gesture. The handler is active while the calling component is mounted;
 * navigating away unregisters it. Safe to call outside a PullToRefreshProvider
 * (it becomes a no-op), so pages don't need to know how the gesture is wired.
 */

import { useEffect, useRef } from 'react';
import { usePullToRefreshContext } from '../contexts/PullToRefreshContext';

export function useRegisterPullToRefresh(onRefresh: () => Promise<void>): void {
  const ctx = usePullToRefreshContext();
  // Keep the latest handler in a ref so re-renders don't churn the
  // registration effect — we register one stable wrapper on mount.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const register = ctx?.register;
  useEffect(() => {
    if (!register) return;
    return register(() => onRefreshRef.current());
  }, [register]);
}
