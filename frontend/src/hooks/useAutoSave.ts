/**
 * Hook to automatically save form data at regular intervals
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTO_SAVE_INTERVAL_MS } from '../constants/config';
import { toAppError, type AppError } from '../utils/errorHandling';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

interface UseAutoSaveOptions<T> {
  data: T;
  onSave: (data: T) => void | Promise<void>;
  interval?: number; // milliseconds
  enabled?: boolean;
}

export interface UseAutoSaveResult {
  /** What the last auto-save attempt did. Render this — see the note below. */
  status: AutoSaveStatus;
  /** The failure behind a `'failed'` status, for a message worth showing. */
  error: AppError | null;
  /** `Date.now()` of the last successful save, for a "saved at ..." line. */
  lastSavedAt: number | null;
  /** Consecutive failures. Still 0 right after a success. */
  failureCount: number;
}

/**
 * Automatically saves data at regular intervals.
 *
 * **Render the returned `status`.** A background save that fails has no other
 * way to reach the person typing: there is no promise for them to await and no
 * click to respond to, so an unrendered failure is a user watching a form they
 * believe is being saved and is not. This hook used to swallow the error into
 * `console.error`, which is why the contract now hands it back instead.
 *
 * A failed save is retried on the next tick — the unsaved data stays in memory
 * and `status` stays `'failed'` until one succeeds, so nothing is dropped as
 * long as the tab stays open. That is not a substitute for telling the user.
 *
 * @param data - The data to auto-save
 * @param onSave - Function to call when saving
 * @param interval - Save interval in milliseconds (default: 30 seconds)
 * @param enabled - Whether auto-save is enabled (default: true)
 *
 * @example
 * ```tsx
 * const { status, error } = useAutoSave({
 *   data: formData,
 *   onSave: async (data) => { await saveToStore(data); },
 *   enabled: hasUnsavedChanges,
 * });
 *
 * return <p>{status === 'failed' ? (error?.message ?? 'Save failed') : 'Saved'}</p>;
 * ```
 */
export function useAutoSave<T>({
  data,
  onSave,
  interval = AUTO_SAVE_INTERVAL_MS,
  enabled = true,
}: UseAutoSaveOptions<T>): UseAutoSaveResult {
  const savedDataRef = useRef<string>(JSON.stringify(data));
  const dataRef = useRef<T>(data);
  const onSaveRef = useRef(onSave);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against setState after unmount: a save in flight when the component
  // goes away would otherwise resolve into a dead component.
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [error, setError] = useState<AppError | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [failureCount, setFailureCount] = useState(0);

  // Keep refs in sync without resetting the interval
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const attemptSave = useCallback(async () => {
    const currentDataString = JSON.stringify(dataRef.current);
    if (currentDataString === savedDataRef.current) return;

    setStatus('saving');
    try {
      await onSaveRef.current(dataRef.current);
      // Only mark this snapshot saved once the write actually succeeded, so a
      // failure is retried on the next tick rather than being forgotten.
      savedDataRef.current = currentDataString;
      if (!mountedRef.current) return;
      setStatus('saved');
      setError(null);
      setFailureCount(0);
      setLastSavedAt(Date.now());
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setStatus('failed');
      setError(toAppError(err));
      setFailureCount((count) => count + 1);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      void attemptSave();
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [interval, enabled, attemptSave]);

  return { status, error, lastSavedAt, failureCount };
}
