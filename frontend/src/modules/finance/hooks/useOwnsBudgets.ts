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
 *
 * The same call answers "Next year's budget" (`plansNextYear`: the member owns a
 * line in a draft year, or has a budget request for one), so the navigation
 * makes one request for both entries.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { budgetService } from '../services/api';

interface OwnsBudgetsState {
  /** The member the answer is for; a different member asks again. */
  userId: string | null;
  ownsAny: boolean;
  plansNextYear: boolean;
  loading: boolean;
  load: (userId: string) => Promise<void>;
  remember: (userId: string, ownsAny: boolean) => void;
  /** The owner's request screen reports what it found, as My Budgets does. */
  rememberPlans: (userId: string, plansNextYear: boolean) => void;
}

export const useOwnsBudgetsStore = create<OwnsBudgetsState>((set, get) => ({
  userId: null,
  ownsAny: false,
  plansNextYear: false,
  loading: false,
  load: async (userId) => {
    if (get().loading || get().userId === userId) return;
    set({ loading: true });
    try {
      const { ownsAny, plansNextYear } = await budgetService.mySummary();
      set({ userId, ownsAny: Boolean(ownsAny), plansNextYear: Boolean(plansNextYear), loading: false });
    } catch {
      // A navigation hint, not a gate: on failure the link is simply not
      // offered, and the page itself still answers for anyone who opens it.
      set({ userId, ownsAny: false, plansNextYear: false, loading: false });
    }
  },
  remember: (userId, ownsAny) =>
    set((s) => ({ userId, ownsAny, plansNextYear: s.userId === userId ? s.plansNextYear : false })),
  rememberPlans: (userId, plansNextYear) =>
    set((s) => ({ userId, plansNextYear, ownsAny: s.userId === userId ? s.ownsAny : false })),
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

/**
 * True once the backend has said `userId` owns a line in a draft fiscal year or
 * has a budget request for one — the "Next year's budget" entry's signal. Shares
 * the one summary call with `useOwnsBudgets`.
 */
export function usePlansNextYear(userId: string | null | undefined, enabled: boolean): boolean {
  const known = useOwnsBudgetsStore((s) => s.userId);
  const plansNextYear = useOwnsBudgetsStore((s) => s.plansNextYear);
  const load = useOwnsBudgetsStore((s) => s.load);

  useEffect(() => {
    if (enabled && userId && known !== userId) void load(userId);
  }, [enabled, userId, known, load]);

  return Boolean(enabled && userId && known === userId && plansNextYear);
}
