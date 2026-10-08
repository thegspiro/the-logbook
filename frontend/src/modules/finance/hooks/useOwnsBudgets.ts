/**
 * Whether the signed-in member owns any budget line — the Finance navigation's
 * reason to offer "My Budgets".
 *
 * Ownership is a position on the line (or its category), not a permission, so
 * `checkPermission` cannot answer it; the backend does
 * (`GET /finance/my-budgets/summary`, a single `LIMIT 1` probe through
 * `finance_budget_ownership.py`). The navigation renders on every page, so the
 * answer is fetched once per signed-in member and kept here rather than asked
 * on each render. A Treasurer assigning a new owner mid-session shows up on
 * that member's next sign-in or reload — or at once if they open
 * `/finance/my-budgets`, which reports what it found back through `remember`.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { budgetService } from '../services/api';

interface OwnsBudgetsState {
  /** The member the answer is for; a different member asks again. */
  userId: string | null;
  ownsAny: boolean;
  loading: boolean;
  load: (userId: string) => Promise<void>;
  remember: (userId: string, ownsAny: boolean) => void;
}

export const useOwnsBudgetsStore = create<OwnsBudgetsState>((set, get) => ({
  userId: null,
  ownsAny: false,
  loading: false,
  load: async (userId) => {
    if (get().loading || get().userId === userId) return;
    set({ loading: true });
    try {
      const { ownsAny } = await budgetService.mySummary();
      set({ userId, ownsAny: Boolean(ownsAny), loading: false });
    } catch {
      // A navigation hint, not a gate: on failure the link is simply not
      // offered, and the page itself still answers for anyone who opens it.
      set({ userId, ownsAny: false, loading: false });
    }
  },
  remember: (userId, ownsAny) => set({ userId, ownsAny }),
}));

/**
 * True once the backend has said `userId` owns a line. `enabled` is false while
 * the Finance module is off, so nothing is asked of a module nobody can open.
 */
export function useOwnsBudgets(userId: string | null | undefined, enabled: boolean): boolean {
  const known = useOwnsBudgetsStore((s) => s.userId);
  const ownsAny = useOwnsBudgetsStore((s) => s.ownsAny);
  const load = useOwnsBudgetsStore((s) => s.load);

  useEffect(() => {
    if (enabled && userId && known !== userId) void load(userId);
  }, [enabled, userId, known, load]);

  return Boolean(enabled && userId && known === userId && ownsAny);
}
