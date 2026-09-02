/**
 * The member's own profile-visibility choice, with optimistic per-field saves.
 *
 * Two screens edit the same five switches — the member's own profile page and
 * My Account → Privacy — so the semantics live here rather than in two
 * hand-rolled copies: every save sends the WHOLE object (the backend refuses a
 * partial one), the response is the new truth, and a failed save reverts the
 * one switch that was flipped and reports it through `saveState`.
 *
 * Two rules protect a member from the whole-object write:
 *
 * - Saves are serialised. Two switches flipped before the first PUT returns
 *   would otherwise race as two complete but different snapshots, and
 *   whichever response landed last would silently undo the other flip. Each
 *   save waits for the previous one and is built from the latest state.
 * - Nothing is written until the stored choice is known. A save built on the
 *   defaults after a failed load would overwrite a hidden field with
 *   "visible", so a load failure leaves the switches disabled with a retry.
 *
 * State is owned here, seeded once, never re-derived from the profile the page
 * holds. A contact-info save on the profile page replaces that page's `user`
 * with a fresh payload, and deriving the switches from it would reset an
 * in-flight toggle mid-save. Nothing else writes this object, so the seed
 * cannot go stale underneath the member.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { userService } from '../services/api';
import type { ProfileVisibility, ProfileVisibilityField } from '../types/user';
import { DEFAULT_PROFILE_VISIBILITY } from '../types/user';
import type { SaveState } from '../components/settings/SaveStatusPill';

interface UseProfileVisibilityOptions {
  /** False on a colleague's profile: no fetch, no switches. */
  enabled: boolean;
  /**
   * The choice already on hand — the profile payload carries it for the
   * member themselves — so the page does not make a second request for it.
   * `null` (redacted) or `undefined` (not loaded) means fetch when enabled.
   */
  initial?: ProfileVisibility | null | undefined;
}

export interface UseProfileVisibilityResult {
  visibility: ProfileVisibility;
  loading: boolean;
  /** The stored choice could not be read; switches must stay disabled. */
  loadError: boolean;
  /** True once the stored choice is on hand, so a save cannot overwrite it blind. */
  ready: boolean;
  saveState: SaveState;
  /** The field whose save is in flight, so its switch alone can be disabled. */
  savingField: ProfileVisibilityField | null;
  setField: (field: ProfileVisibilityField, next: boolean) => Promise<void>;
  reload: () => void;
}

export function useProfileVisibility({ enabled, initial }: UseProfileVisibilityOptions): UseProfileVisibilityResult {
  const [visibility, setVisibility] = useState<ProfileVisibility>(initial ?? DEFAULT_PROFILE_VISIBILITY);
  const [loading, setLoading] = useState(enabled && !initial);
  const [loadError, setLoadError] = useState(false);
  const [ready, setReady] = useState(Boolean(enabled && initial));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savingField, setSavingField] = useState<ProfileVisibilityField | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // A save reads the latest object, not the one the closure was built over,
  // so two quick flips of different switches cannot resurrect a stale value.
  const latest = useRef(visibility);
  latest.current = visibility;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // The tail of the save chain: each save waits for the one before it, and
  // how many flips are still queued behind the one in flight — a response
  // only becomes the local truth when nothing newer is waiting, or it would
  // roll back a flip the member made while the request was out.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (initial) {
      setVisibility(initial);
      setLoading(false);
      setLoadError(false);
      setReady(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setReady(false);
    void userService
      .getMyProfileVisibility()
      .then((data) => {
        if (cancelled) return;
        setVisibility(data);
        setReady(true);
      })
      .catch(() => {
        // Without the stored choice a save would be built on the defaults and
        // could flip a hidden field to visible. Keep the switches off.
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, initial, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const setField = useCallback(async (field: ProfileVisibilityField, next: boolean) => {
    if (!readyRef.current) return;
    const previous = latest.current;
    const optimistic: ProfileVisibility = { ...previous, [field]: next };
    // Applied to the local copy immediately so the next flip builds on it;
    // the request itself waits its turn behind any save still in flight.
    latest.current = optimistic;
    setVisibility(optimistic);
    setSavingField(field);
    setSaveState('saving');

    pending.current += 1;
    const run = async () => {
      try {
        // The snapshot carries every flip made so far, including ones queued
        // behind this one; the later saves then re-send the same truth.
        const saved = await userService.setMyProfileVisibility({ ...latest.current });
        if (pending.current === 1) {
          latest.current = saved;
          setVisibility(saved);
        }
        setSaveState('saved');
      } catch {
        const reverted: ProfileVisibility = { ...latest.current, [field]: previous[field] };
        latest.current = reverted;
        setVisibility(reverted);
        setSaveState('error');
      } finally {
        pending.current -= 1;
        setSavingField((current) => (current === field ? null : current));
      }
    };
    const turn = queue.current.then(run, run);
    queue.current = turn;
    await turn;
  }, []);

  return { visibility, loading, loadError, ready, saveState, savingField, setField, reload };
}

export default useProfileVisibility;
