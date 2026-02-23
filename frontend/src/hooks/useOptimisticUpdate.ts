/**
 * Optimistic Update Hook (#13)
 *
 * Immediately updates the UI before the server responds,
 * with automatic rollback on error.
 */

import { useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';

interface UseOptimisticUpdateOptions<T> {
  /** The API call to make */
  apiCall: (data: T) => Promise<T>;
  /** Error message to show on failure */
  errorMessage?: string;
}

interface UseOptimisticUpdateResult<T> {
  /** Execute an optimistic update */
  execute: (currentValue: T, optimisticValue: T) => Promise<T>;
  /** Whether an update is in progress */
  loading: boolean;
}

export function useOptimisticUpdate<T>({
  apiCall,
  errorMessage = 'Update failed. Changes have been reverted.',
}: UseOptimisticUpdateOptions<T>): UseOptimisticUpdateResult<T> {
  const [loading, setLoading] = useState(false);
  const rollbackRef = useRef<T | null>(null);

  const execute = useCallback(
    async (currentValue: T, optimisticValue: T): Promise<T> => {
      rollbackRef.current = currentValue;
      setLoading(true);

      try {
        const result = await apiCall(optimisticValue);
        rollbackRef.current = null;
        return result;
      } catch {
        toast.error(errorMessage);
        // Caller should use the rollback value
        throw rollbackRef.current;
      } finally {
        setLoading(false);
      }
    },
    [apiCall, errorMessage]
  );

  return { execute, loading };
}

/**
 * Simple optimistic state update helper.
 * Returns [value, optimisticSet] where optimisticSet updates immediately
 * and reverts on API failure.
 */
export function useOptimisticState<T>(
  initialValue: T
): [T, (newValue: T, apiCall: () => Promise<unknown>) => void] {
  const [value, setValue] = useState<T>(initialValue);

  const optimisticSet = useCallback(
    async (newValue: T, apiCall: () => Promise<unknown>) => {
      const previousValue = value;
      setValue(newValue);

      try {
        await apiCall();
      } catch {
        setValue(previousValue);
        toast.error('Action failed. Changes reverted.');
      }
    },
    [value]
  );

  return [value, optimisticSet];
}
