import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { readSessionDraft, removeSessionDraft, sessionDraftKey, writeSessionDraft } from '../utils/sessionDrafts';

/**
 * Keeps a form's values in a session draft and offers them back on return
 * (forms review F-6). See utils/sessionDrafts.ts for why sessionStorage, and
 * for the rule that PHI is never drafted.
 *
 * The caller passes the values it wants drafted — and only those — plus how to
 * put them back. Pair it with <DraftRestoredNotice> so a restored draft is
 * visible and can be thrown away; a form that silently refills itself reads
 * as somebody else's data.
 */
export interface UseSessionDraftOptions<T> {
  /** A stable name for the form, e.g. `training-submission`. */
  form: string;
  /** The record an edit form is editing; leave unset on a create form. */
  recordId?: string | null | undefined;
  /** The values to draft. Must be JSON-serialisable. */
  value: T;
  /** Puts a restored draft back into the form. */
  onRestore: (value: T) => void;
  /**
   * Whether there is anything worth keeping. Defaults to "differs from the
   * value on the first render", so an untouched form writes no draft.
   */
  isEmpty?: ((value: T) => boolean) | undefined;
  /**
   * Restore waits until this is true — for a form whose own defaults load
   * asynchronously and would otherwise land on top of the restored draft.
   */
  ready?: boolean | undefined;
  /** Turns drafting off entirely (e.g. while a receipt is shown). */
  enabled?: boolean | undefined;
}

export interface SessionDraft {
  /** True from a restore until the draft is discarded, cleared or saved over by a fresh form. */
  restored: boolean;
  /** Throws the stored draft away; the caller resets its own fields. */
  discard: () => void;
  /** After a successful save: removes the draft and stops re-writing the values still on screen. */
  clear: () => void;
}

export function useSessionDraft<T>({
  form,
  recordId,
  value,
  onRestore,
  isEmpty,
  ready = true,
  enabled = true,
}: UseSessionDraftOptions<T>): SessionDraft {
  const userId = useAuthStore((state) => state.user?.id);
  const key = userId ? sessionDraftKey(String(userId), form, recordId) : null;
  const serialized = JSON.stringify(value);

  const [restored, setRestored] = useState(false);
  const initial = useRef(serialized);
  const attemptedFor = useRef<string | null>(null);
  // The values on screen when the draft was cleared or discarded: those are
  // not re-drafted, until the member changes something.
  const suppressed = useRef<string | null>(null);
  const latest = useRef({ onRestore, isEmpty, value, serialized });
  useEffect(() => {
    latest.current = { onRestore, isEmpty, value, serialized };
  });

  // Restore once per key, before anything is written under it.
  useEffect(() => {
    if (!key || !enabled || !ready || attemptedFor.current === key) return;
    attemptedFor.current = key;
    const stored = readSessionDraft<T>(key);
    if (!stored) return;
    latest.current.onRestore(stored.value);
    setRestored(true);
  }, [key, enabled, ready]);

  useEffect(() => {
    if (!key || !enabled || attemptedFor.current !== key) return;
    if (suppressed.current !== null) {
      if (suppressed.current === serialized) return;
      suppressed.current = null;
    }
    // `value` is read through the ref and keyed on `serialized`: a form that
    // rebuilds the object inline on every render must not write every render.
    const { isEmpty: emptyTest, value: current } = latest.current;
    const empty = emptyTest ? emptyTest(current) : serialized === initial.current;
    if (empty) removeSessionDraft(key);
    else writeSessionDraft(key, current);
    // `ready` too: a form edited while its defaults were loading must be
    // drafted the moment it becomes ready, not only at the next keystroke.
  }, [key, enabled, ready, serialized, restored]);

  const clear = useCallback(() => {
    if (key) removeSessionDraft(key);
    suppressed.current = latest.current.serialized;
    setRestored(false);
  }, [key]);

  return { restored, discard: clear, clear };
}
