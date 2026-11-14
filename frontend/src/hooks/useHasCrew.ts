/**
 * Whether the signed-in member supervises anyone today: the navigation's
 * reason to offer "My Crew".
 *
 * Supervising is a dated Reports To assignment, not a permission, so
 * `checkPermission` cannot answer it; the backend does (`GET /users/me/crew`).
 * The navigation renders on every page, so the answer is fetched once per
 * signed-in member and kept here, as `useHasAssignedApplicants` keeps
 * My Applicants'. A member given a crew mid-session sees the entry on their
 * next sign-in or reload; the page itself reports what it found through
 * `remember`.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { memberStatusService } from '../services/api';

interface CrewState {
  /** The member the answer is for; a different member asks again. */
  userId: string | null;
  hasCrew: boolean;
  loading: boolean;
  load: (userId: string) => Promise<void>;
  remember: (userId: string, hasCrew: boolean) => void;
}

export const useCrewStore = create<CrewState>((set, get) => ({
  userId: null,
  hasCrew: false,
  loading: false,
  load: async (userId) => {
    if (get().loading || get().userId === userId) return;
    set({ loading: true });
    try {
      const crew = await memberStatusService.getMyCrew();
      set({ userId, hasCrew: crew.length > 0, loading: false });
    } catch {
      // A navigation hint, not a gate: on failure the link is simply not
      // offered, and the page still answers for anyone who opens it.
      set({ userId, hasCrew: false, loading: false });
    }
  },
  remember: (userId, hasCrew) => set({ userId, hasCrew }),
}));

/** True once the backend has said `userId` supervises at least one member today. */
export function useHasCrew(userId: string | null | undefined): boolean {
  const known = useCrewStore((s) => s.userId);
  const hasCrew = useCrewStore((s) => s.hasCrew);
  const load = useCrewStore((s) => s.load);

  useEffect(() => {
    if (userId && known !== userId) void load(userId);
  }, [userId, known, load]);

  return Boolean(userId && known === userId && hasCrew);
}
