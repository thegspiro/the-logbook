/**
 * Whether the signed-in member is assigned to any applicant, as case manager
 * or interviewer: the navigation's reason to offer "My Applicants".
 *
 * An assignment is a grant made per applicant, not a permission, so
 * `checkPermission` cannot answer it; the backend does
 * (`GET /prospective-members/my-applicants`). The navigation renders on every
 * page, so the answer is fetched once per signed-in member and kept here, the
 * way `useOwnsBudgets` keeps Finance's. A member assigned mid-session sees the
 * entry on their next sign-in or reload; the assignment email links straight
 * to the page meanwhile, and the page reports what it found through
 * `remember`.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { applicantService } from '../services/api';

interface AssignedApplicantsState {
  /** The member the answer is for; a different member asks again. */
  userId: string | null;
  hasAny: boolean;
  loading: boolean;
  load: (userId: string) => Promise<void>;
  remember: (userId: string, hasAny: boolean) => void;
}

export const useAssignedApplicantsStore = create<AssignedApplicantsState>((set, get) => ({
  userId: null,
  hasAny: false,
  loading: false,
  load: async (userId) => {
    if (get().loading || get().userId === userId) return;
    set({ loading: true });
    try {
      const applicants = await applicantService.getMyApplicants();
      set({ userId, hasAny: applicants.length > 0, loading: false });
    } catch {
      // A navigation hint, not a gate: on failure the link is simply not
      // offered, and the page itself still answers for anyone who opens it.
      set({ userId, hasAny: false, loading: false });
    }
  },
  remember: (userId, hasAny) => set({ userId, hasAny }),
}));

/**
 * True once the backend has said `userId` is assigned to an applicant.
 * `enabled` is false while the module is off, so nothing is asked of a module
 * nobody can open.
 */
export function useHasAssignedApplicants(userId: string | null | undefined, enabled: boolean): boolean {
  const known = useAssignedApplicantsStore((s) => s.userId);
  const hasAny = useAssignedApplicantsStore((s) => s.hasAny);
  const load = useAssignedApplicantsStore((s) => s.load);

  useEffect(() => {
    if (enabled && userId && known !== userId) void load(userId);
  }, [enabled, userId, known, load]);

  return Boolean(enabled && userId && known === userId && hasAny);
}
