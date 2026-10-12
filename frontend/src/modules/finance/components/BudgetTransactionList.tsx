/**
 * What moved a budget line's spent and committed totals, newest first.
 *
 * The rows are the backend's (`GET /finance/budgets/{id}/transactions`), taken
 * from the same records `_mutate_budget` counted, so the spent and committed
 * rows add up to the line's figures above them. The list does not decide what
 * counts or what each row's effect is; it shows what it was told (CLAUDE.md
 * pitfall #29).
 *
 * A row links to its request only for a viewer who may open that request —
 * a line's owner sees the list but not other members' requests.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FileText } from 'lucide-react';
import { budgetService } from '../services/api';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '@/hooks/useTimezone';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Pagination } from '@/components/ux/Pagination';
import type { BudgetTransaction, BudgetTransactionEffect, BudgetTransactionKind } from '../types';

export const TRANSACTIONS_PAGE_SIZE = 25;

const KIND_LABELS: Record<BudgetTransactionKind, string> = {
  purchase_request: 'Purchase request',
  check_request: 'Check request',
  expense_report: 'Expense report',
};

const KIND_PATHS: Record<BudgetTransactionKind, string> = {
  purchase_request: '/finance/purchase-requests',
  check_request: '/finance/check-requests',
  expense_report: '/finance/expenses',
};

/** "Committed" is the encumbered amount: approved, not yet paid. */
const EFFECT_LABELS: Record<BudgetTransactionEffect, string> = {
  spent: 'Spent',
  encumbered: 'Committed',
  none: 'Reversed',
};

const EFFECT_BADGES: Record<BudgetTransactionEffect, string> = {
  spent: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  encumbered: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
  none: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-200',
};

const statusLabel = (status: string): string => {
  const words = status.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

interface BudgetTransactionListProps {
  budgetId: string;
  /** Bumped by the page after an edit, so the list re-reads with it. */
  revision: number;
  /** The viewer may open any purchase or check request. */
  linkRequests: boolean;
  /** The viewer may open any expense report (finance managers only). */
  linkExpenseReports: boolean;
}

export const BudgetTransactionList: React.FC<BudgetTransactionListProps> = ({
  budgetId,
  revision,
  linkRequests,
  linkExpenseReports,
}) => {
  const tz = useTimezone();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BudgetTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await budgetService.listTransactions(budgetId, {
        limit: TRANSACTIONS_PAGE_SIZE,
        offset: (page - 1) * TRANSACTIONS_PAGE_SIZE,
      });
      setRows(result.items);
      setTotal(result.total);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the transactions'));
    } finally {
      setLoading(false);
    }
  }, [budgetId, page]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const linkFor = (row: BudgetTransaction): string | null => {
    const allowed = row.kind === 'expense_report' ? linkExpenseReports : linkRequests;
    return allowed ? `${KIND_PATHS[row.kind]}/${row.entityId}` : null;
  };

  let body: React.ReactNode;
  if (error) {
    body = (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {error}
      </p>
    );
  } else if (loading && rows.length === 0) {
    body = <Skeleton className="h-10 w-full" />;
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        headingLevel={4}
        icon={FileText}
        title="No transactions yet"
        description="Approved purchase requests, issued checks and paid expense reports charged to this line appear here."
      />
    );
  } else {
    body = (
      <>
        <ul className="divide-theme-surface-border divide-y" aria-label="Transactions">
          {rows.map((row) => {
            const href = linkFor(row);
            const effectLabel = EFFECT_LABELS[row.effect];
            return (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-theme-text-primary min-w-0 text-sm font-semibold break-words">
                    {KIND_LABELS[row.kind]}{' '}
                    {href ? (
                      <Link to={href} className="underline">
                        {row.number}
                      </Link>
                    ) : (
                      row.number
                    )}
                  </p>
                  <p className="flex items-center gap-2 text-sm">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${EFFECT_BADGES[row.effect]}`}>
                      {effectLabel}
                    </span>
                    <span
                      className={`text-theme-text-primary font-semibold ${row.effect === 'none' ? 'line-through' : ''}`}
                    >
                      {formatCurrency(row.amount)}
                    </span>
                  </p>
                </div>
                {row.description && (
                  <p className="text-theme-text-primary mt-1 text-sm break-words">{row.description}</p>
                )}
                <p className="text-theme-text-secondary mt-1 text-xs break-words">
                  {[
                    formatDate(row.occurredAt, tz),
                    row.counterparty,
                    row.requesterName ? `Requested by ${row.requesterName}` : null,
                    statusLabel(row.status),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            );
          })}
        </ul>
        {total > TRANSACTIONS_PAGE_SIZE && (
          <Pagination
            className="mt-4"
            currentPage={page}
            totalItems={total}
            pageSize={TRANSACTIONS_PAGE_SIZE}
            onPageChange={setPage}
          />
        )}
      </>
    );
  }

  return (
    <div className="card p-6">
      <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Transaction History</h3>
      {body}
    </div>
  );
};
