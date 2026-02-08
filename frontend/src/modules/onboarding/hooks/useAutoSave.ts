/**
 * Hook to automatically save form data at regular intervals
 */

import { useEffect, useRef } from 'react';

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
  interval = 30000, // 30 seconds default
  enabled = true
}: UseAutoSaveOptions<T>) {
  const savedDataRef = useRef<T>(data);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Clear interval if auto-save is disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Start auto-save interval
    intervalRef.current = setInterval(async () => {
      // Only save if data has changed
      const currentDataString = JSON.stringify(data);
      const savedDataString = JSON.stringify(savedDataRef.current);

      if (currentDataString !== savedDataString) {
        try {
          await onSave(data);
          savedDataRef.current = data;
        } catch (error) {
          console.error('Auto-save failed:', error);
        }
      }
    }, interval);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [data, onSave, interval, enabled]);

  // Update saved data ref when data changes (for comparison)
  useEffect(() => {
    savedDataRef.current = data;
  }, [data]);
}
