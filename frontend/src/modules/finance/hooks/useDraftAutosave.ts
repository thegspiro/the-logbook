/**
 * useDraftAutosave — keeps a form's contents on the server as a draft while
 * the member is still typing.
 *
 * The first save creates the record and every later one updates it, so
 * leaving the page never throws away what was entered. Nothing is sent until
 * `isSavable` says the server would accept the values (a create endpoint with
 * required fields cannot hold a half-empty draft), and nothing is sent twice
 * for the same values.
 *
 * Saves are chained rather than concurrent: a second save waits for the first
 * so the update never races the create that gives it an id, and `flush` can be
 * awaited before navigating away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export const AUTOSAVE_DELAY_MS = 1500;

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface DraftAutosaveOptions<V> {
  values: V;
  /** False turns autosave off entirely (an edit of a record already submitted). */
  enabled: boolean;
  /** Whether the server would accept these values as a create. */
  isSavable: (values: V) => boolean;
  create: (values: V) => Promise<{ id: string }>;
  update: (id: string, values: V) => Promise<unknown>;
  /** The record being edited, when the form opens on one that already exists. */
  initialId?: string | null;
  /** What the server already holds, so loading a record does not count as a change. */
  baseline?: V | null;
  /** True once the member has changed something (react-hook-form's `isDirty`). */
  dirty: boolean;
  delayMs?: number;
}

export interface DraftAutosave {
  draftId: string | null;
  status: AutosaveStatus;
  savedAt: Date | null;
  /** The member has entered something the server does not hold yet. */
  hasUnsaved: boolean;
  /**
   * Saves the latest values now and resolves to the record's id, or null when
   * there is nothing the server could hold yet. Rejects if the save fails.
   */
  flush: () => Promise<string | null>;
  /**
   * Stop saving for good, after the member discarded the draft: the form is
   * about to close, and its last save on the way out must not bring the
   * record back.
   */
  stop: () => void;
}

export function useDraftAutosave<V>({
  values,
  enabled,
  isSavable,
  create,
  update,
  initialId = null,
  baseline = null,
  dirty,
  delayMs = AUTOSAVE_DELAY_MS,
}: DraftAutosaveOptions<V>): DraftAutosave {
  const signature = JSON.stringify(values);
  const baselineSignature = baseline === null ? null : JSON.stringify(baseline);
  const savable = enabled && isSavable(values);

  const [draftId, setDraftId] = useState<string | null>(initialId);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(baselineSignature);

  const latest = useRef({ values, signature, enabled, isSavable, create, update });
  latest.current = { values, signature, enabled, isSavable, create, update };
  const idRef = useRef<string | null>(initialId);
  const savedRef = useRef<string | null>(baselineSignature);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const stopped = useRef(false);

  useEffect(() => {
    savedRef.current = baselineSignature;
    setSavedSignature(baselineSignature);
  }, [baselineSignature]);

  const saveLatest = useCallback((): Promise<string | null> => {
    const run = chain.current.then(async (): Promise<string | null> => {
      const current = latest.current;
      if (stopped.current || !current.enabled || !current.isSavable(current.values)) return idRef.current;
      if (idRef.current !== null && current.signature === savedRef.current) return idRef.current;

      if (mounted.current) setStatus('saving');
      try {
        if (idRef.current === null) {
          const created = await current.create(current.values);
          idRef.current = created.id;
          if (mounted.current) setDraftId(created.id);
        } else {
          await current.update(idRef.current, current.values);
        }
      } catch (err) {
        if (mounted.current) setStatus('error');
        throw err;
      }
      savedRef.current = current.signature;
      if (mounted.current) {
        setSavedSignature(current.signature);
        setSavedAt(new Date());
        setStatus('saved');
      }
      return idRef.current;
    });
    chain.current = run.catch(() => undefined);
    return run;
  }, []);

  useEffect(() => {
    if (!savable || stopped.current || signature === savedSignature) return undefined;
    const timer = setTimeout(() => {
      void saveLatest().catch(() => undefined);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [savable, signature, savedSignature, delayMs, saveLatest]);

  // Leaving the page with a change still waiting out its delay would lose it,
  // so a final save is started on the way out. The request outlives the page.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = latest.current;
      if (
        !stopped.current &&
        current.enabled &&
        current.isSavable(current.values) &&
        current.signature !== savedRef.current
      ) {
        void saveLatest().catch(() => undefined);
      }
    };
  }, [saveLatest]);

  const stop = useCallback(() => {
    stopped.current = true;
  }, []);

  return {
    draftId,
    status,
    savedAt,
    hasUnsaved: enabled && dirty && signature !== savedSignature,
    flush: saveLatest,
    stop,
  };
}
