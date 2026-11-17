/**
 * Whether the signed-in member decides attendance waiver requests, per
 * workflow, and how many are waiting on them: the navigation's reason to offer
 * "Waiver Requests" in the Training and Governance groups.
 *
 * Most deciders decide by holding a position the department chose, an office
 * (Chief, President, Secretary) or the alternate's place, none of which is a
 * permission `checkPermission` could answer; the backend does
 * (`GET .../attention`, from the same definition its queue filters by). The
 * navigation renders on every page, so each answer is fetched once per
 * signed-in member and kept here, as `useHasCrew` keeps My Crew's. The queue
 * and decision pages call `refresh` after they load or decide, so the waiting
 * count follows what the decider just did.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import type { AttendanceWaiverAttention } from '../types/attendanceWaiver';
import { attendanceWaiverService, meetingWaiverService } from '../services/attendanceWaiverService';

/**
 * The workflow keys, written out rather than imported from
 * `attendanceWaiverWorkflows`: that module imports the page headers, which
 * draw the navigation that reads this hook, and the cycle would leave a
 * header undefined when the config is built.
 */
export const WaiverAttentionKey = {
  TRAINING_SESSION: 'training_session',
  BUSINESS_MEETING: 'business_meeting',
} as const;
export type WaiverAttentionKey = (typeof WaiverAttentionKey)[keyof typeof WaiverAttentionKey];

const attentionOf = (key: WaiverAttentionKey): Promise<AttendanceWaiverAttention> =>
  key === WaiverAttentionKey.TRAINING_SESSION
    ? attendanceWaiverService.getAttention()
    : meetingWaiverService.getAttention();

type Answers = Partial<Record<WaiverAttentionKey, AttendanceWaiverAttention>>;

interface WaiverAttentionState {
  /** The member the answers are for; a different member asks again. */
  userId: string | null;
  answers: Answers;
  loading: Partial<Record<WaiverAttentionKey, boolean>>;
  load: (userId: string, key: WaiverAttentionKey) => Promise<void>;
  refresh: (key: WaiverAttentionKey) => Promise<void>;
}

const NOTHING: AttendanceWaiverAttention = { decides: false, pending: 0 };

export const useWaiverAttentionStore = create<WaiverAttentionState>((set, get) => ({
  userId: null,
  answers: {},
  loading: {},
  load: async (userId, key) => {
    const state = get();
    if (state.userId !== userId) set({ userId, answers: {}, loading: {} });
    if (get().loading[key] || get().answers[key]) return;
    set((s) => ({ loading: { ...s.loading, [key]: true } }));
    let answer = NOTHING;
    try {
      answer = await attentionOf(key);
    } catch {
      // A navigation hint, not a gate: on failure the link is simply not
      // offered, and the queue still answers for anyone who opens it.
    }
    if (get().userId !== userId) return;
    set((s) => ({ answers: { ...s.answers, [key]: answer }, loading: { ...s.loading, [key]: false } }));
  },
  refresh: async (key) => {
    const { userId } = get();
    if (!userId) return;
    try {
      const answer = await attentionOf(key);
      if (get().userId === userId) set((s) => ({ answers: { ...s.answers, [key]: answer } }));
    } catch {
      // Keep the answer already shown.
    }
  },
}));

/**
 * The backend's answer for `userId`, per workflow, or null until it arrives
 * or while that workflow's module is off (`enabled`).
 */
export function useWaiverAttention(
  userId: string | null | undefined,
  enabled: { training: boolean; meetings: boolean }
): { training: AttendanceWaiverAttention | null; meetings: AttendanceWaiverAttention | null } {
  const known = useWaiverAttentionStore((s) => s.userId);
  const answers = useWaiverAttentionStore((s) => s.answers);
  const load = useWaiverAttentionStore((s) => s.load);

  useEffect(() => {
    if (!userId) return;
    if (enabled.training) void load(userId, WaiverAttentionKey.TRAINING_SESSION);
    if (enabled.meetings) void load(userId, WaiverAttentionKey.BUSINESS_MEETING);
  }, [userId, enabled.training, enabled.meetings, load]);

  const mine = Boolean(userId && known === userId);
  return {
    training: mine && enabled.training ? (answers[WaiverAttentionKey.TRAINING_SESSION] ?? null) : null,
    meetings: mine && enabled.meetings ? (answers[WaiverAttentionKey.BUSINESS_MEETING] ?? null) : null,
  };
}

/**
 * The stored answer for one workflow, without asking for it. For the section
 * strips at the top of Training and Governance pages: the side or top
 * navigation, mounted on every page, has already asked through
 * `useWaiverAttention`, and the strip shows the same answer rather than
 * fetching it a second time.
 */
export function useWaiverAttentionAnswer(key: WaiverAttentionKey): AttendanceWaiverAttention | null {
  return useWaiverAttentionStore((s) => s.answers[key] ?? null);
}
