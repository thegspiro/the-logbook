/**
 * Whether the navigation offers "Leave Requests", and the count beside it.
 *
 * Who decides a request is the department's approver positions, not a
 * permission, so `checkPermission` cannot answer it; the backend does
 * (`GET /users/leave-requests/summary`). Fetched once per signed-in member,
 * like `useHasCrew`; the page refreshes it after every action so the count
 * follows what was just decided.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { leaveRequestService } from '../services/leaveRequestService';

interface LeaveRequestNavState {
  /** The member the answer is for; a different member asks again. */
  userId: string | null;
  requestsEnabled: boolean;
  /** Requests waiting on this member: to decide, or to answer. */
  waiting: number;
  loading: boolean;
  load: (userId: string, force?: boolean) => Promise<void>;
}

export const useLeaveRequestNavStore = create<LeaveRequestNavState>((set, get) => ({
  userId: null,
  requestsEnabled: false,
  waiting: 0,
  loading: false,
  load: async (userId, force = false) => {
    if (get().loading || (!force && get().userId === userId)) return;
    set({ loading: true });
    try {
      const summary = await leaveRequestService.getSummary();
      set({
        userId,
        requestsEnabled: summary.requests_enabled === true,
        waiting: (summary.to_decide ?? 0) + (summary.waiting_on_me ?? 0),
        loading: false,
      });
    } catch {
      // A navigation hint, not a gate: on failure the entry is not offered,
      // and the page still answers for anyone who opens it.
      set({ userId, requestsEnabled: false, waiting: 0, loading: false });
    }
  },
}));

export interface LeaveRequestNav {
  /** Offer the entry: the department takes requests, or something waits. */
  show: boolean;
  waiting: number;
}

export function useLeaveRequestNav(userId: string | null | undefined): LeaveRequestNav {
  const known = useLeaveRequestNavStore((s) => s.userId);
  const requestsEnabled = useLeaveRequestNavStore((s) => s.requestsEnabled);
  const waiting = useLeaveRequestNavStore((s) => s.waiting);
  const load = useLeaveRequestNavStore((s) => s.load);

  useEffect(() => {
    if (userId && known !== userId) void load(userId);
  }, [userId, known, load]);

  const current = Boolean(userId && known === userId);
  return { show: current && (requestsEnabled || waiting > 0), waiting: current ? waiting : 0 };
}

/** The entry's label, with the count when something waits. */
export const leaveRequestNavLabel = (waiting: number): string =>
  waiting > 0 ? `Leave Requests (${waiting})` : 'Leave Requests';
