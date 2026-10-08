/**
 * The Finance pages both navigations list. One list so the side and top
 * navigation cannot drift apart, as with `grantsNavigation.ts`.
 *
 * The module had no navigation entry at all until 2026-10-07, which mattered
 * once every member could raise their own requests (`finance.request`): a
 * member had no way to find the pages that are now theirs. Each entry carries
 * the gate of the route it opens (a nav gate is a subset of its route's), so a
 * member holding only `finance.request` sees their three request lists and
 * nothing that would answer Access Denied.
 */
import { FINANCE_REQUEST_READ_PERMISSIONS } from '../../modules/finance/hooks/useFinanceRequestAccess';

export interface FinanceNavItem {
  label: string;
  path: string;
  anyPermission: string[];
}

/** Who may see the Finance group at all — the request pages' gate. */
export const FINANCE_NAV_PERMISSIONS = FINANCE_REQUEST_READ_PERMISSIONS;

/**
 * The entries, labelled for what the viewer will find behind them. A member
 * without the org-wide read is shown only their own requests, so the entry
 * says "My …" — the same title the page itself carries.
 */
export function financeNavItems(checkPermission: (permission: string) => boolean): FinanceNavItem[] {
  const canManage = checkPermission('finance.manage');
  const seesAllRequests = canManage || checkPermission('finance.view');
  const mine = (all: string, own: string, seesAll: boolean) => (seesAll ? all : own);
  return [
    { label: 'Dashboard', path: '/finance', anyPermission: ['finance.view'] },
    {
      label: mine('Purchase Requests', 'My Purchase Requests', seesAllRequests),
      path: '/finance/purchase-requests',
      anyPermission: [...FINANCE_REQUEST_READ_PERMISSIONS],
    },
    {
      // Expense reports are own-only for everyone but a finance manager (FIN-5).
      label: mine('Expense Reports', 'My Expense Reports', canManage),
      path: '/finance/expenses',
      anyPermission: [...FINANCE_REQUEST_READ_PERMISSIONS],
    },
    {
      label: mine('Check Requests', 'My Check Requests', seesAllRequests),
      path: '/finance/check-requests',
      anyPermission: [...FINANCE_REQUEST_READ_PERMISSIONS],
    },
    { label: 'Approvals', path: '/finance/approvals', anyPermission: ['finance.approve'] },
  ];
}

/** Where the group itself points: the dashboard if the viewer may open it. */
export function financeNavPath(checkPermission: (permission: string) => boolean): string {
  return checkPermission('finance.view') ? '/finance' : '/finance/purchase-requests';
}
