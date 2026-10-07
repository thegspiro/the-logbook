/**
 * What the signed-in member may do with purchase requests, expense reports and
 * check requests — the frontend mirror of the scoping in
 * `backend/app/api/v1/endpoints/finance.py` (CLAUDE.md pitfall #29: report what
 * the backend decided, do not invent a second rule).
 *
 * - `finance.request` (every member) raises, edits, submits and withdraws a
 *   draft of **their own** requests, and sees only those.
 * - `finance.view` reads the whole purchase and check request queues, but acts
 *   on nothing it did not raise; expense reports stay own-only for it (FIN-5).
 * - `finance.manage` reads and acts on everyone's.
 */

import { useAuthStore } from '../../../stores/authStore';

/** The route gate for the request lists and detail pages. */
export const FINANCE_REQUEST_READ_PERMISSIONS = ['finance.request', 'finance.view', 'finance.manage'];

export interface FinanceRequestAccess {
  /** May raise a new request ("New …" buttons). */
  canRaise: boolean;
  /** Runs the finance office's side: order, receive, pay, issue, void. */
  canManage: boolean;
  /** Sees every member's purchase and check requests, not just their own. */
  seesAllRequests: boolean;
  /** Sees every member's expense reports — finance managers only. */
  seesAllExpenseReports: boolean;
  /** May edit, submit or withdraw this record (given who raised it). */
  canActAsRequester: (requesterId: string | null | undefined) => boolean;
}

export function useFinanceRequestAccess(): FinanceRequestAccess {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const userId = useAuthStore((s) => s.user?.id);

  const canManage = checkPermission('finance.manage');
  const canRequest = checkPermission('finance.request');

  return {
    canRaise: canRequest || canManage,
    canManage,
    seesAllRequests: canManage || checkPermission('finance.view'),
    seesAllExpenseReports: canManage,
    canActAsRequester: (requesterId) => canManage || (canRequest && !!userId && requesterId === userId),
  };
}
