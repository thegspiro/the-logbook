/**
 * Write-on-change saving for a settings screen, paired with SaveStatusPill.
 *
 * Distinct from `useAutoSave`, which polls a form's data object on a 30s timer
 * to preserve a draft. This one is driven by the change itself: a switch writes
 * the moment it is flipped, a text field writes once the member stops typing,
 * and the pill reports the outcome. The settings screens have no Save button
 * for a failure to attach itself to, which is what shapes the rules below.
 *
 * Four behaviours are deliberate:
 *
 * - **Writes are serialized.** Every saver runs after the previous one
 *   settles. These screens send whole settings objects rather than field
 *   patches, so two overlapping requests are two full snapshots racing: if the
 *   older one commits second, it restores the value the newer one had just
 *   changed, and the screen shows the newer value over a server holding the
 *   older. A queue is the cheap fix; per-field patches would be the expensive
 *   one.
 * - **A failure never rolls the field back.** The caller keeps the value the
 *   member entered. Restoring the stored value on error is indistinguishable
 *   from the keystrokes never having registered, and it destroys the only copy
 *   of what they meant to type.
 * - **An outstanding failure outranks a later success.** The pill stays in its
 *   error state while any write is still unrecovered, so a member who fails to
 *   save a module toggle and then successfully saves something else is not
 *   shown "All changes saved" over the change that was lost.
 * - **Pending debounced writes are flushed on unmount, not dropped.** Typing a
 *   department name and immediately clicking away is the ordinary way to use a
 *   field that saves itself; cancelling the timer there would discard the edit
 *   silently, with the pill never having left `idle` to suggest otherwise.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../utils/errorHandling';
import { SETTINGS_AUTOSAVE_DEBOUNCE_MS, SETTINGS_SAVE_MIN_VISIBLE_MS } from '../constants/config';
import type { SaveState } from '../components/settings/SaveStatusPill';

type Saver<T> = () => Promise<T>;

interface SaveOptions {
  /** Fallback toast text when the failure carries no message of its own. */
  errorMessage?: string | undefined;
}

interface FailedWrite {
  saver: Saver<unknown>;
  options: SaveOptions;
}

interface PendingDebounce extends FailedWrite {
  timer: ReturnType<typeof setTimeout>;
}

export interface UseSettingsAutosaveResult {
  /** Feed straight to SettingsLayout's `saveState`. */
  saveState: SaveState;
  /**
   * Write now — switches, selects, radios, and anything with a discrete value.
   *
   * Resolves with the server's response, or `null` if the write failed, so a
   * caller that needs the saved record can await it without also owning the
   * status reporting. The saver should carry out the caller's *whole* success
   * path, including any state it sets from the response: `retry` re-runs the
   * saver, so anything left outside it is skipped on the retry.
   */
  save: <T>(saver: Saver<T>, options?: SaveOptions) => Promise<T | null>;
  /**
   * Write once the member stops typing. `key` scopes the debounce, so editing
   * two fields in the same section does not have the second cancel the first.
   *
   * The saver runs at fire time, not at schedule time — build its payload from
   * a ref holding current state rather than closing over a snapshot, or a
   * change made while the debounce was pending will be written back out.
   */
  saveDebounced: (key: string, saver: Saver<unknown>, options?: SaveOptions) => void;
  /** Re-run every write still unrecovered. Wire to the pill's retry. */
  retry: () => void;
}

export function useSettingsAutosave(): UseSettingsAutosaveResult {
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const mountedRef = useRef(true);
  const debouncesRef = useRef(new Map<string, PendingDebounce>());
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failedRef = useRef<FailedWrite[]>([]);
  /** Tail of the write queue. Every saver is chained onto this. */
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const inFlightRef = useRef(0);
  const startedAtRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const debounces = debouncesRef.current;
    return () => {
      mountedRef.current = false;
      for (const pending of debounces.values()) {
        clearTimeout(pending.timer);
        // Flush onto the same queue so it still commits after whatever is
        // already in flight. Nothing is left to report an outcome to, so the
        // rejection is swallowed rather than toasted into an unmounted screen.
        chainRef.current = chainRef.current
          .catch(() => undefined)
          .then(() => pending.saver())
          .catch(() => undefined);
      }
      debounces.clear();
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  // Hold "Saving…" for its minimum before reporting an outcome, so a fast round
  // trip reads as a save rather than a flicker. Only the last write to settle
  // reports, which with the queue means the whole burst is one status change.
  const settle = useCallback(() => {
    const remaining = Math.max(0, SETTINGS_SAVE_MIN_VISIBLE_MS - (Date.now() - startedAtRef.current));
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      if (!mountedRef.current || inFlightRef.current > 0) {
        return;
      }
      setSaveState(failedRef.current.length > 0 ? 'error' : 'saved');
    }, remaining);
  }, []);

  const run = useCallback(
    <T>(saver: Saver<T>, options: SaveOptions = {}): Promise<T | null> => {
      if (inFlightRef.current === 0) {
        startedAtRef.current = Date.now();
      }
      inFlightRef.current += 1;
      if (mountedRef.current) {
        setSaveState('saving');
      }

      const attempt = chainRef.current
        .catch(() => undefined)
        .then(() => saver())
        .then(
          (value): T | null => {
            inFlightRef.current -= 1;
            settle();
            return value;
          },
          (err: unknown): T | null => {
            inFlightRef.current -= 1;
            failedRef.current.push({ saver, options });
            if (mountedRef.current) {
              // One toast per failure, and only on failure: a success toast per
              // switch is what made Events Settings unreadable.
              toast.error(getErrorMessage(err, options.errorMessage ?? 'Could not save that change'));
            }
            settle();
            return null;
          }
        );

      chainRef.current = attempt;
      return attempt;
    },
    [settle]
  );

  const save = useCallback(<T>(saver: Saver<T>, options?: SaveOptions) => run(saver, options), [run]);

  const saveDebounced = useCallback(
    (key: string, saver: Saver<unknown>, options?: SaveOptions) => {
      const debounces = debouncesRef.current;
      const existing = debounces.get(key);
      if (existing) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => {
        debounces.delete(key);
        void run(saver, options);
      }, SETTINGS_AUTOSAVE_DEBOUNCE_MS);
      debounces.set(key, { saver, options: options ?? {}, timer });
    },
    [run]
  );

  const retry = useCallback(() => {
    const failures = failedRef.current;
    failedRef.current = [];
    for (const failure of failures) {
      void run(failure.saver, failure.options);
    }
  }, [run]);

  return { saveState, save, saveDebounced, retry };
}

export default useSettingsAutosave;
