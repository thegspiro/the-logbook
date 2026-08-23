/**
 * Write-on-change saving for a settings screen, paired with SaveStatusPill.
 *
 * Distinct from `useAutoSave`, which polls a form's data object on a 30s timer
 * to preserve a draft. This one is driven by the change itself: a switch writes
 * the moment it is flipped, a text field writes once the member stops typing,
 * and the pill reports the outcome. The settings screens have no Save button
 * for a failure to attach itself to, which is what shapes the rules below.
 *
 * Two behaviours are deliberate:
 *
 * - **A failure never rolls the field back.** The caller keeps the value the
 *   member entered. Restoring the stored value on error is indistinguishable
 *   from the keystrokes never having registered, and it destroys the only copy
 *   of what they meant to type.
 * - **Only the newest write may report an outcome.** Two fields changed in
 *   quick succession resolve out of order often enough that a stale success
 *   would otherwise paint over a newer failure and declare the screen saved.
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

export interface UseSettingsAutosaveResult {
  /** Feed straight to SettingsLayout's `saveState`. */
  saveState: SaveState;
  /**
   * Write now — switches, selects, radios, and anything with a discrete value.
   *
   * Resolves with the server's response, or `null` if the write failed, so a
   * caller that needs the saved record (to re-render from it, or to branch on
   * what came back) can await it without also owning the status reporting.
   * Resolves as soon as the request settles; the pill runs on its own timer.
   */
  save: <T>(saver: Saver<T>, options?: SaveOptions) => Promise<T | null>;
  /**
   * Write once the member stops typing. `key` scopes the debounce, so editing
   * two fields in the same section does not have the second cancel the first.
   */
  saveDebounced: (key: string, saver: Saver<unknown>, options?: SaveOptions) => void;
  /** Re-run the write that failed. Wire to the pill's retry. */
  retry: () => void;
}

export function useSettingsAutosave(): UseSettingsAutosaveResult {
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const mountedRef = useRef(true);
  const debounceTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaverRef = useRef<{ saver: Saver<unknown>; options: SaveOptions } | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    const debounceTimers = debounceTimersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
      }
      debounceTimers.clear();
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
      }
    };
  }, []);

  const run = useCallback(<T>(saver: Saver<T>, options: SaveOptions = {}): Promise<T | null> => {
    lastSaverRef.current = { saver, options };
    const seq = (seqRef.current += 1);
    const startedAt = Date.now();

    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setSaveState('saving');

    // Hold "Saving…" for its minimum before reporting either outcome, so a
    // fast round trip reads as a save rather than a flicker.
    const settle = (next: SaveState, onSettled?: () => void) => {
      const remaining = Math.max(0, SETTINGS_SAVE_MIN_VISIBLE_MS - (Date.now() - startedAt));
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        if (!mountedRef.current || seqRef.current !== seq) {
          return;
        }
        setSaveState(next);
        onSettled?.();
      }, remaining);
    };

    return saver().then(
      (value) => {
        settle('saved');
        return value;
      },
      (err: unknown) => {
        // One toast per failure, and only on failure: a success toast per
        // switch is what made Events Settings unreadable.
        settle('error', () => {
          toast.error(getErrorMessage(err, options.errorMessage ?? 'Could not save that change'));
        });
        return null;
      }
    );
  }, []);

  const save = useCallback(<T>(saver: Saver<T>, options?: SaveOptions) => run(saver, options), [run]);

  const saveDebounced = useCallback(
    (key: string, saver: Saver<unknown>, options?: SaveOptions) => {
      const timers = debounceTimersRef.current;
      const pending = timers.get(key);
      if (pending) {
        clearTimeout(pending);
      }
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          void run(saver, options);
        }, SETTINGS_AUTOSAVE_DEBOUNCE_MS)
      );
    },
    [run]
  );

  const retry = useCallback(() => {
    const last = lastSaverRef.current;
    if (last) {
      void run(last.saver, last.options);
    }
  }, [run]);

  return { saveState, save, saveDebounced, retry };
}

export default useSettingsAutosave;
