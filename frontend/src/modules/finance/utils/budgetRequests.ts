/**
 * Words, badges and sums for next year's budget requests.
 *
 * What a request may do next is the backend's decision (`requestsOpen`, the
 * status rules in `finance_budget_request_service.py`); these helpers only word
 * it and add up what the screens list (CLAUDE.md pitfall #29).
 */

import type { BudgetRequest, BudgetRequestStatus, FiscalYearOption, MonetaryAmount } from '../types';
import { formatCalendarDate } from '@/utils/dateFormatting';

export const BUDGET_REQUEST_STATUS_LABELS: Record<BudgetRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  adjusted: 'Adjusted',
  declined: 'Declined',
};

export const BUDGET_REQUEST_STATUS_BADGES: Record<BudgetRequestStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  adjusted: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  declined: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
};

/** The order the review screen lists the status filter in. */
export const BUDGET_REQUEST_STATUS_ORDER: BudgetRequestStatus[] = [
  'submitted',
  'approved',
  'adjusted',
  'declined',
  'draft',
];

/** A request that has the Treasurer's decision on it. */
export const isDecided = (request: BudgetRequest): boolean =>
  request.status === 'approved' || request.status === 'adjusted' || request.status === 'declined';

/** The banner line for a draft year's request window. */
export function requestWindowText(year: Pick<FiscalYearOption, 'requestDeadline' | 'requestsOpen'>): string {
  if (!year.requestsOpen) return 'Requests are closed';
  if (year.requestDeadline) return `Requests close ${formatCalendarDate(year.requestDeadline)}`;
  return 'No deadline set';
}

/** The largest amount the backend's Numeric(12, 2) column holds. */
export const MAX_REQUEST_AMOUNT = 9_999_999_999.99;
export const MAX_REQUEST_TEXT = 4000;

/**
 * Add money up in cents, so a column of decimal strings sums to what a
 * calculator would say. `null` entries (no figure) are skipped.
 */
export function sumAmounts(values: (MonetaryAmount | null | undefined)[]): number {
  const cents = values.reduce<number>((total, value) => {
    if (value === null || value === undefined || value === '') return total;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? total + Math.round(parsed * 100) : total;
  }, 0);
  return cents / 100;
}
