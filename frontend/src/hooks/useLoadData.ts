import { useState, useEffect, useCallback } from "react";

/**
 * Loads data from an async function on mount and provides a reload trigger.
 * Swallows errors silently (services may not be configured yet in this app).
 */
function useLoadData<T>(
  loadFn: () => Promise<T>,
  initial: T,
): { data: T; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadFn();
      setData(result);
    } catch {
      // Service may not be configured yet
    } finally {
      setLoading(false);
    }
  }, [loadFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { data, loading, reload };
}

export default useLoadData;
