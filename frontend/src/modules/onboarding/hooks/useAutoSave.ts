/**
 * Hook to automatically save form data at regular intervals
 */

import { useEffect, useRef } from 'react';
import { AUTO_SAVE_INTERVAL_MS } from '../../../constants/config';

interface UseAutoSaveOptions<T> {
  data: T;
  onSave: (data: T) => void | Promise<void>;
  interval?: number; // milliseconds
  enabled?: boolean;
}

/**
 * Automatically saves data at regular intervals
 *
 * @param data - The data to auto-save
 * @param onSave - Function to call when saving
 * @param interval - Save interval in milliseconds (default: 30000 = 30 seconds)
 * @param enabled - Whether auto-save is enabled (default: true)
 *
 * @example
 * ```tsx
 * useAutoSave({
 *   data: formData,
 *   onSave: async (data) => {
 *     await saveToStore(data);
 *   },
 *   interval: 30000, // 30 seconds
 *   enabled: hasUnsavedChanges
 * });
 * ```
 */
export function useAutoSave<T>({
  data,
  onSave,
  interval = AUTO_SAVE_INTERVAL_MS,
  enabled = true
}: UseAutoSaveOptions<T>) {
  const savedDataRef = useRef<string>(JSON.stringify(data));
  const dataRef = useRef<T>(data);
  const onSaveRef = useRef(onSave);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Keep refs in sync without resetting the interval
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      const currentDataString = JSON.stringify(dataRef.current);

      if (currentDataString !== savedDataRef.current) {
        void (async () => {
          try {
            await onSaveRef.current(dataRef.current);
            savedDataRef.current = currentDataString;
          } catch (error) {
            console.error('Auto-save failed:', error);
          }
        })();
      }
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [interval, enabled]);
}
