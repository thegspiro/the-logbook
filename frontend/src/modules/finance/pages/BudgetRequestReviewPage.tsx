/**
 * Budget requests — the Treasurer's review of next year's requests
 * (`finance.manage`).
 *
 * One draft fiscal year at a time: its deadline and whether owners can still
 * change requests (the backend's `requestsOpen`), a count per status, the
 * requests in the chosen status (Submitted first, the ones waiting), and a
 * totals row. Opening a request shows its justification and records a decision
 * through `BudgetRequestDecisionDialog`; the list is fetched again afterwards
 * (CLAUDE.md pitfall #11) because a decision also writes the draft line.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ClipboardList } from 'lucide-react';
import { budgetRequestService, fiscalYearService } from '../services/api';
import { BudgetRequestDecisionDialog } from '../components/BudgetRequestDecisionDialog';
import {
  BUDGET_REQUEST_STATUS_BADGES,
  BUDGET_REQUEST_STATUS_LABELS,
  BUDGET_REQUEST_STATUS_ORDER,
  requestWindowText,
  sumAmounts,
} from '../utils/budgetRequests';
import type { BudgetRequest, BudgetRequestStatus, FiscalYearOption } from '../types';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '@/hooks/useTimezone';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';

const HEADER_CELL = 'text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase';
const CELL = 'text-theme-text-primary px-4 py-3 text-sm';
const MONEY_CELL = `${CELL} text-right whitespace-nowrap`;

type StatusFilter = BudgetRequestStatus | 'all';

const BudgetRequestReviewPage: React.FC = () => {
  const tz = useTimezone();
  const [years, setYears] = useState<FiscalYearOption[] | null>(null);
  const [yearId, setYearId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('submitted');
  const [requests, setRequests] = useState<BudgetRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<BudgetRequest | null>(null);

  const loadYears = useCallback(async () => {
    try {
      const all = await fiscalYearService.options();
      const drafts = all.filter((y) => y.status === 'draft');
      setYears(drafts);
      setYearId((current) => (drafts.some((y) => y.id === current) ? current : (drafts[0]?.id ?? '')));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the fiscal years'));
      setYears([]);
    }
  }, []);

  useEffect(() => {
    void loadYears();
  }, [loadYears]);

  const load = useCallback(async () => {
    if (!yearId) return;
    try {
      // Every status at once: the counts need them all, and a year's requests
      // are a few dozen at most.
      setRequests(await budgetRequestService.list({ fiscalYearId: yearId }));
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the budget requests'));
    }
  }, [yearId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const out: Record<BudgetRequestStatus, number> = { draft: 0, submitted: 0, approved: 0, adjusted: 0, declined: 0 };
    for (const r of requests ?? []) out[r.status] += 1;
    return out;
  }, [requests]);

  const shown = useMemo(
    () => (requests ?? []).filter((r) => status === 'all' || r.status === status),
    [requests, status]
  );
  const totals = useMemo(
    () => ({
      requested: sumAmounts(shown.map((r) => r.requestedAmount)),
      lastYear: sumAmounts(shown.map((r) => r.lastYearBudgeted)),
      approved: sumAmounts(shown.map((r) => r.approvedAmount)),
    }),
    [shown]
  );

  const year = years?.find((y) => y.id === yearId) ?? null;

  if (years === null) return <SkeletonPage />;

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">Budget requests</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          What line owners are asking for next year. Approving or adjusting a request writes the amount into the draft
          year&apos;s line. Set the deadline and copy last year&apos;s lines in{' '}
          <Link to="/finance/settings">Finance Settings</Link>.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {years.length === 0 && !error && (
        <EmptyState
          icon={ClipboardList}
          title="No draft fiscal year"
          description="Budget requests are made for a draft fiscal year. Create next year in Finance Settings, copy this year's lines into it, and set a request deadline."
        />
      )}

      {year && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="sm:w-56">
            <label htmlFor="review-year" className="form-label">
              Fiscal year
            </label>
            <select
              id="review-year"
              className="form-input"
              value={yearId}
              onChange={(e) => {
                setRequests(null);
                setYearId(e.target.value);
              }}
            >
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:w-56">
            <label htmlFor="review-status" className="form-label">
              Status
            </label>
            <select
              id="review-status"
              className="form-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              {BUDGET_REQUEST_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {BUDGET_REQUEST_STATUS_LABELS[s]} ({counts[s]})
                </option>
              ))}
              <option value="all">All ({requests?.length ?? 0})</option>
            </select>
          </div>
          <p className="text-theme-text-secondary flex flex-wrap items-center gap-2 text-sm sm:pb-2">
            <span className="text-theme-text-primary font-medium">{requestWindowText(year)}</span>
            <span
              className={`badge ${
                year.requestsOpen
                  ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300'
                  : 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300'
              }`}
            >
              {year.requestsOpen ? 'Owners can still change requests' : 'Closed to owners'}
            </span>
          </p>
        </div>
      )}

      {year && requests && (
        <ul className="flex flex-wrap gap-2" aria-label="Requests by status">
          {BUDGET_REQUEST_STATUS_ORDER.map((s) => (
            <li key={s} className={`badge ${BUDGET_REQUEST_STATUS_BADGES[s]}`}>
              {BUDGET_REQUEST_STATUS_LABELS[s]}: {counts[s]}
            </li>
          ))}
        </ul>
      )}

      {year && requests && shown.length === 0 && (
        <p className="text-theme-text-secondary text-sm">
          {status === 'all'
            ? `No budget requests for ${year.name} yet.`
            : `No ${BUDGET_REQUEST_STATUS_LABELS[status].toLowerCase()} requests for ${year.name}.`}
        </p>
      )}

      {year && shown.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rwd-table w-full">
              <thead>
                <tr className="border-theme-surface-border border-b">
                  <th scope="col" className={HEADER_CELL}>
                    Budget line
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Owner
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Submitted
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    This year budgeted
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    This year spent
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    Requested
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    Approved
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Status
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Budget line" className={`rwd-table-lead ${CELL} font-medium`}>
                      {r.lineLabel}
                      {r.isProposedLine && (
                        <span className="text-theme-text-secondary block text-xs font-normal">New line</span>
                      )}
                    </td>
                    <td data-label="Owner" className={CELL}>
                      {r.ownerPositionName ?? 'No owner'}
                    </td>
                    <td data-label="Submitted" className={`${CELL} text-theme-text-secondary`}>
                      {r.submittedAt ? (
                        <>
                          {r.submittedByName ?? 'Unknown'}
                          <span className="block text-xs">{formatDate(r.submittedAt, tz)}</span>
                        </>
                      ) : (
                        'Not submitted'
                      )}
                    </td>
                    <td data-label="This year budgeted" className={MONEY_CELL}>
                      {formatCurrency(r.lastYearBudgeted ?? null)}
                    </td>
                    <td data-label="This year spent" className={MONEY_CELL}>
                      {formatCurrency(r.lastYearSpent ?? null)}
                    </td>
                    <td data-label="Requested" className={`${MONEY_CELL} font-semibold`}>
                      {formatCurrency(r.requestedAmount)}
                    </td>
                    <td data-label="Approved" className={MONEY_CELL}>
                      {formatCurrency(r.approvedAmount ?? null)}
                    </td>
                    <td data-label="Status" className={CELL}>
                      <span className={`badge ${BUDGET_REQUEST_STATUS_BADGES[r.status]}`}>
                        {BUDGET_REQUEST_STATUS_LABELS[r.status]}
                      </span>
                    </td>
                    <td data-label="Decision" className={CELL}>
                      {r.status !== 'draft' && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => setDeciding(r)}
                          aria-label={`${r.status === 'submitted' ? 'Review' : 'Change decision on'} ${r.lineLabel}`}
                        >
                          {r.status === 'submitted' ? 'Review' : 'Change'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-theme-surface-border border-t-2" aria-label="Totals">
                  <th scope="row" className={`rwd-table-lead ${CELL} text-left font-semibold`} colSpan={3}>
                    Total ({shown.length} {shown.length === 1 ? 'request' : 'requests'})
                  </th>
                  <td data-label="This year budgeted" className={`${MONEY_CELL} font-semibold`}>
                    {formatCurrency(totals.lastYear)}
                  </td>
                  <td data-label="This year spent" className={MONEY_CELL} />
                  <td data-label="Requested" className={`${MONEY_CELL} font-semibold`}>
                    {formatCurrency(totals.requested)}
                  </td>
                  <td data-label="Approved" className={`${MONEY_CELL} font-semibold`}>
                    {formatCurrency(totals.approved)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {deciding && (
        <BudgetRequestDecisionDialog
          request={deciding}
          onClose={() => setDeciding(null)}
          onDecided={() => {
            setDeciding(null);
            void load();
          }}
        />
      )}
    </div>
  );
};

export default BudgetRequestReviewPage;
