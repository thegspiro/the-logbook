/**
 * My Budgets — the budget lines the signed-in member owns.
 *
 * A line is owned by a position, and a line with no owner of its own inherits
 * its category's. Which lines are this member's is the backend's answer
 * (`GET /finance/my-budgets`, through `finance_budget_ownership.py`), as are
 * each line's remaining amount and share used; this page groups and shows
 * them (CLAUDE.md pitfall #29). Owners see every fiscal year, closed ones
 * included, and need no `finance.view`; they read, and the Treasurer changes.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ChevronRight, Wallet } from 'lucide-react';
import { budgetService } from '../services/api';
import { useOwnsBudgetsStore } from '../hooks/useOwnsBudgets';
import { budgetOwnerLabel } from '../utils/budgetOwnership';
import { useAuthStore } from '@/stores/authStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { groupByFiscalYear } from '../utils/myBudgets';
import type { MyBudget } from '../types';

const STATUS_LABELS: Record<string, string> = {
  active: 'Current year',
  draft: 'Draft',
  closed: 'Closed',
};

const BudgetLineCard: React.FC<{ line: MyBudget }> = ({ line }) => {
  const budgeted = Number(line.amountBudgeted);
  const amended = (line.amendmentCount ?? 0) > 0;
  const spentPct = budgeted > 0 ? Math.min((Number(line.amountSpent) / budgeted) * 100, 100) : 0;
  const committedPct = budgeted > 0 ? Math.min((Number(line.amountEncumbered) / budgeted) * 100, 100 - spentPct) : 0;
  const remaining = Number(line.amountRemaining);
  const title = `${line.categoryName || 'Budget line'} · ${line.stationId ? line.stationName || 'Unknown station' : 'Department-wide'}`;

  return (
    <li>
      <Link
        to={`/finance/budgets/${line.id}`}
        className="card group block p-4 transition-all hover:border-red-200 hover:shadow-md"
        aria-label={`${title}, ${line.fiscalYearName ?? ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-theme-text-primary font-semibold break-words">{title}</h3>
            <p className="text-theme-text-secondary text-sm break-words">Owner: {budgetOwnerLabel(line)}</p>
          </div>
          <ChevronRight className="text-theme-text-secondary h-5 w-5 shrink-0" aria-hidden="true" />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-theme-text-secondary">Budget</dt>
            <dd className="text-theme-text-primary font-medium">
              {formatCurrency(line.amountBudgeted)}
              {amended && (
                <span className="text-theme-text-secondary block text-xs">
                  Original {formatCurrency(line.originalAmount ?? line.amountBudgeted)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-theme-text-secondary">Spent</dt>
            <dd className="text-theme-text-primary font-medium">{formatCurrency(line.amountSpent)}</dd>
          </div>
          <div>
            <dt className="text-theme-text-secondary">Committed</dt>
            <dd className="text-theme-text-primary font-medium">{formatCurrency(line.amountEncumbered)}</dd>
          </div>
          <div>
            <dt className="text-theme-text-secondary">Remaining</dt>
            <dd
              className={`font-medium ${remaining < 0 ? 'text-red-700 dark:text-red-400' : 'text-theme-text-primary'}`}
            >
              {formatCurrency(line.amountRemaining)}
            </dd>
          </div>
        </dl>

        <div className="mt-3">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
            role="progressbar"
            aria-label="Share of the budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(line.percentUsed, 100)}
            aria-valuetext={`${line.percentUsed.toFixed(1)}% used`}
          >
            <div className="flex h-full">
              <div className="h-full bg-blue-500" style={{ width: `${String(spentPct)}%` }} />
              <div className="h-full bg-yellow-400" style={{ width: `${String(committedPct)}%` }} />
            </div>
          </div>
          <p className="text-theme-text-secondary mt-1 text-xs">{line.percentUsed.toFixed(1)}% used</p>
        </div>
      </Link>
    </li>
  );
};

const MyBudgetsPage: React.FC = () => {
  const userId = useAuthStore((s) => s.user?.id);
  const remember = useOwnsBudgetsStore((s) => s.remember);
  const [lines, setLines] = useState<MyBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const mine = await budgetService.listMine();
        if (cancelled) return;
        setLines(mine);
        setError(null);
        // Keep the navigation's "My Budgets" entry in step with what is here.
        if (userId) remember(userId, mine.length > 0);
      } catch (err: unknown) {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load your budgets'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const stop = () => {
      cancelled = true;
    };
    return stop;
  }, [userId, remember]);

  const groups = useMemo(() => groupByFiscalYear(lines), [lines]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <h1 className="text-theme-text-primary text-2xl font-bold">My Budgets</h1>
        <div className="space-y-3" role="status" aria-live="polite" aria-label="Loading your budgets">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">My Budgets</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          The budget lines your position owns, in every fiscal year. Committed is money approved for purchases that have
          not been paid yet.
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

      {!error && groups.length === 0 && (
        <EmptyState
          icon={Wallet}
          title="You don't own any budget lines"
          description="A budget line appears here when the Treasurer makes your position its owner, on the line itself or on its category. You'll then see it for every fiscal year, including closed ones."
        />
      )}

      {groups.map((group) => (
        <section key={group.fiscalYearId} aria-labelledby={`fy-${group.fiscalYearId}`}>
          <h2
            id={`fy-${group.fiscalYearId}`}
            className="text-theme-text-primary mb-3 flex flex-wrap items-center gap-2 text-lg font-semibold"
          >
            {group.name}
            {STATUS_LABELS[group.status] && (
              <span className="bg-theme-surface-secondary text-theme-text-secondary rounded-full px-2 py-0.5 text-xs font-medium">
                {STATUS_LABELS[group.status]}
              </span>
            )}
          </h2>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {group.lines.map((line) => (
              <BudgetLineCard key={line.id} line={line} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default MyBudgetsPage;
