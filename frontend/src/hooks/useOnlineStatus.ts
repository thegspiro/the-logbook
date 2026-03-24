/**
 * useOnlineStatus — tracks navigator.onLine and fires on transitions.
 *
 * Returns `isOnline` boolean that updates in real time as the browser
 * detects connectivity changes. Useful for showing offline banners and
 * triggering queue drain when connectivity is restored.
 */

import { useState, useEffect, useCallback } from 'react';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  const goOnline = useCallback(() => setIsOnline(true), []);
  const goOffline = useCallback(() => setIsOnline(false), []);

  useEffect(() => {
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [goOnline, goOffline]);

  return isOnline;
}
