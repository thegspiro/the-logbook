/**
 * The member's own profile-visibility choice, with optimistic per-field saves.
 *
 * Two screens edit the same five switches — the member's own profile page and
 * My Account → Privacy — so the semantics live here rather than in two
 * hand-rolled copies: every save sends the WHOLE object (the backend refuses a
 * partial one), the response is the new truth, and a failed save reverts the
 * one switch that was flipped and reports it through `saveState`.
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
  saveState: SaveState;
  /** The field whose save is in flight, so its switch alone can be disabled. */
  savingField: ProfileVisibilityField | null;
  setField: (field: ProfileVisibilityField, next: boolean) => Promise<void>;
}

export function useProfileVisibility({ enabled, initial }: UseProfileVisibilityOptions): UseProfileVisibilityResult {
  const [visibility, setVisibility] = useState<ProfileVisibility>(initial ?? DEFAULT_PROFILE_VISIBILITY);
  const [loading, setLoading] = useState(enabled && !initial);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savingField, setSavingField] = useState<ProfileVisibilityField | null>(null);
  // A save reads the latest object, not the one the closure was built over,
  // so two quick flips of different switches cannot resurrect a stale value.
  const latest = useRef(visibility);
  latest.current = visibility;

  useEffect(() => {
    if (!enabled) return;
    if (initial) {
      setVisibility(initial);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void userService
      .getMyProfileVisibility()
      .then((data) => {
        if (!cancelled) setVisibility(data);
      })
      .catch(() => {
        // Leave the defaults in place; the switches still render and the
        // first save writes a complete object regardless.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, initial]);

  const setField = useCallback(async (field: ProfileVisibilityField, next: boolean) => {
    const previous = latest.current;
    const optimistic: ProfileVisibility = { ...previous, [field]: next };
    setVisibility(optimistic);
    setSavingField(field);
    setSaveState('saving');
    try {
      const saved = await userService.setMyProfileVisibility(optimistic);
      setVisibility(saved);
      setSaveState('saved');
    } catch {
      setVisibility(previous);
      setSaveState('error');
    } finally {
      setSavingField(null);
    }
  }, []);

  return { visibility, loading, saveState, savingField, setField };
}

export default useProfileVisibility;
