/**
 * Pull-to-Refresh Context
 *
 * Lets the app mount a single pull-to-refresh gesture + indicator at the layout
 * level (see AppLayout) while each page supplies its own data-refresh handler.
 * A page opts in via the useRegisterPullToRefresh hook; the gesture stays
 * disabled on pages that don't register, so no dangling spinner appears.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';

type RefreshHandler = () => Promise<void>;

interface PullToRefreshContextValue {
  /** Register the active page's refresh handler. Returns an unregister fn. */
  register: (handler: RefreshHandler) => () => void;
  /** Invoke the currently-registered handler (no-op if none). */
  runRefresh: RefreshHandler;
  /** Whether a page has registered a handler (drives whether the gesture is enabled). */
  hasHandler: boolean;
}

const PullToRefreshContext = createContext<PullToRefreshContextValue | null>(null);

export const PullToRefreshProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const handlerRef = useRef<RefreshHandler | null>(null);
  const [hasHandler, setHasHandler] = useState(false);

  const register = useCallback((handler: RefreshHandler) => {
    handlerRef.current = handler;
    setHasHandler(true);
    return () => {
      // Only clear if this handler is still the active one — guards against a
      // new page registering before the old one's cleanup runs.
      if (handlerRef.current === handler) {
        handlerRef.current = null;
        setHasHandler(false);
      }
    };
  }, []);

  const runRefresh = useCallback(async () => {
    if (handlerRef.current) await handlerRef.current();
  }, []);

  const value = useMemo(
    () => ({ register, runRefresh, hasHandler }),
    [register, runRefresh, hasHandler]
  );

  return (
    <PullToRefreshContext.Provider value={value}>
      {children}
    </PullToRefreshContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export function usePullToRefreshContext(): PullToRefreshContextValue | null {
  return useContext(PullToRefreshContext);
}
