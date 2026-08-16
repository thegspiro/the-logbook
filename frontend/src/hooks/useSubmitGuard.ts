/**
 * useSubmitGuard — one-at-a-time guard for actions that create something.
 *
 * A `disabled` bound to form validity does not stop a double-click: the fields
 * are still filled while the first request is in flight, so the second click
 * passes the same check and posts a second record. Two purchase requests, two
 * motions in the minutes, two budget lines — all of which someone then has to
 * find and delete.
 *
 * The in-flight flag is held in a ref, not state, because that is the half that
 * has to be correct. Two clicks inside one frame are batched by React, so both
 * read the same pre-update state value and both proceed; a ref is written
 * synchronously and the second call sees it. `busy` mirrors it in state purely
 * so the button can render as disabled — it is the feedback, not the guard.
 *
 * Usage:
 *   const { busy, run } = useSubmitGuard();
 *   const handleCreate = () => run(async () => { ...existing body... });
 *   <button disabled={busy || !name.trim()} onClick={() => void handleCreate()}>
 *
 * `run` resolves once the action settles and re-throws nothing — the action
 * keeps whatever error handling it already had.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SubmitGuard {
  /** True while an action is in flight. Bind to `disabled`. */
  busy: boolean;
  /** Runs `action` unless one is already in flight, in which case it is ignored. */
  run: (action: () => Promise<unknown>) => Promise<void>;
}

export function useSubmitGuard(): SubmitGuard {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      // A create that navigates away or closes its modal unmounts the button
      // this flag was for; setting state then is a no-op warning, not a fix.
      if (mounted.current) setBusy(false);
    }
  }, []);

  return { busy, run };
}
