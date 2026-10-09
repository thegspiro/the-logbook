/**
 * Next year's budget — a line owner proposes amounts for a draft fiscal year.
 *
 * The lines are the member's own (`GET /finance/budget-requests/my-lines`,
 * through `finance_budget_ownership.py`), each with this year's budget and
 * spending to compare against and its request. Proposals for lines that do not
 * exist yet come from the request list. Whether requests are still open is the
 * backend's `requestsOpen`, and what each status allows is the API's rule; the
 * page offers only what it would accept and shows its refusal when it does not
 * (CLAUDE.md pitfall #29). Every action re-fetches (#11).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarClock, ClipboardList, Plus } from 'lucide-react';
import { budgetRequestService, fiscalYearService } from '../services/api';
import { useOwnsBudgetsStore } from '../hooks/useOwnsBudgets';
import { BudgetRequestDialog } from '../components/BudgetRequestDialog';
import type { BudgetRequestDialogTarget } from '../components/BudgetRequestDialog';
import {
  BUDGET_REQUEST_STATUS_BADGES,
  BUDGET_REQUEST_STATUS_LABELS,
  isDecided,
  requestWindowText,
} from '../utils/budgetRequests';
import type {
  BudgetRequest,
  BudgetRequestProposalOptions,
  FiscalYearOption,
  MonetaryAmount,
  MyBudgetRequestLines,
} from '../types';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatCalendarDate } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';

const EMPTY_OPTIONS: BudgetRequestProposalOptions = { positions: [], categories: [], stations: [] };

const Figure: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <dt className="text-theme-text-secondary">{label}</dt>
    <dd className="text-theme-text-primary font-medium">{value}</dd>
  </div>
);

interface RequestCardProps {
  title: string;
  subtitle?: string | undefined;
  lastYearName?: string | null | undefined;
  lastYearBudgeted?: MonetaryAmount | null | undefined;
  lastYearSpent?: MonetaryAmount | null | undefined;
  request: BudgetRequest | null;
  open: boolean;
  busy: boolean;
  onCreate?: (() => void) | undefined;
  onEdit: (request: BudgetRequest) => void;
  onSubmit: (request: BudgetRequest) => void;
  onWithdraw: (request: BudgetRequest) => void;
  onDelete: (request: BudgetRequest) => void;
}

const RequestCard: React.FC<RequestCardProps> = ({
  title,
  subtitle,
  lastYearName,
  lastYearBudgeted,
  lastYearSpent,
  request,
  open,
  busy,
  onCreate,
  onEdit,
  onSubmit,
  onWithdraw,
  onDelete,
}) => {
  const hasLastYear = lastYearBudgeted !== null && lastYearBudgeted !== undefined;
  const status = request?.status;
  const decided = request ? isDecided(request) : false;
  // A decided request is the record; a declined one stays shown with its note.
  const canCreate = open && Boolean(onCreate) && (!request || status === 'declined');

  return (
    <li className="card p-4" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-theme-text-primary font-semibold break-words">{title}</h3>
          {subtitle && <p className="text-theme-text-secondary text-sm break-words">{subtitle}</p>}
        </div>
        {status && (
          <span className={`badge ${BUDGET_REQUEST_STATUS_BADGES[status]}`}>
            {BUDGET_REQUEST_STATUS_LABELS[status]}
          </span>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Figure
          label={hasLastYear ? `Budgeted ${lastYearName ?? 'this year'}` : 'Budgeted this year'}
          value={hasLastYear ? formatCurrency(lastYearBudgeted) : 'No line'}
        />
        <Figure
          label={hasLastYear ? `Spent ${lastYearName ?? 'this year'}` : 'Spent this year'}
          value={hasLastYear ? formatCurrency(lastYearSpent ?? '0') : '-'}
        />
        <Figure label="Requested" value={request ? formatCurrency(request.requestedAmount) : 'No request yet'} />
        <Figure
          label="Approved"
          value={
            status === 'approved' || status === 'adjusted'
              ? formatCurrency(request?.approvedAmount ?? null)
              : status === 'declined'
                ? 'Declined'
                : '-'
          }
        />
      </dl>

      {request?.decisionNote && (
        <p className="text-theme-text-primary mt-3 text-sm break-words whitespace-pre-line">
          <span className="font-medium">Treasurer's note: </span>
          {request.decisionNote}
        </p>
      )}

      {(canCreate || (open && request && !decided)) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canCreate && onCreate && (
            <button type="button" className="btn-primary btn-sm" onClick={onCreate} disabled={busy}>
              {status === 'declined' ? 'Request again' : 'Request an amount'}
            </button>
          )}
          {open && request && status === 'draft' && (
            <>
              <button type="button" className="btn-primary btn-sm" onClick={() => onSubmit(request)} disabled={busy}>
                Submit
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => onEdit(request)} disabled={busy}>
                Edit
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => onDelete(request)} disabled={busy}>
                Delete draft
              </button>
            </>
          )}
          {open && request && status === 'submitted' && (
            <>
              <button type="button" className="btn-secondary btn-sm" onClick={() => onEdit(request)} disabled={busy}>
                Edit
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => onWithdraw(request)}
                disabled={busy}
              >
                Withdraw
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
};

const BudgetRequestsPage: React.FC = () => {
  const userId = useAuthStore((s) => s.user?.id);
  const rememberPlans = useOwnsBudgetsStore((s) => s.rememberPlans);
  const { confirm } = useConfirm();
  const [years, setYears] = useState<FiscalYearOption[] | null>(null);
  const [yearId, setYearId] = useState('');
  const [data, setData] = useState<MyBudgetRequestLines | null>(null);
  const [proposals, setProposals] = useState<BudgetRequest[]>([]);
  const [options, setOptions] = useState<BudgetRequestProposalOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<BudgetRequestDialogTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadYears = async () => {
      try {
        const [all, proposalOptions] = await Promise.all([
          fiscalYearService.options(),
          budgetRequestService.proposalOptions().catch(() => EMPTY_OPTIONS),
        ]);
        if (cancelled) return;
        const drafts = all.filter((y) => y.status === 'draft');
        setYears(drafts);
        setOptions(proposalOptions);
        setYearId((current) => current || (drafts[0]?.id ?? ''));
        if (drafts.length === 0) setLoading(false);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(getErrorMessage(err, 'Could not load the fiscal years'));
          setYears([]);
          setLoading(false);
        }
      }
    };
    void loadYears();
    const stop = () => {
      cancelled = true;
    };
    return stop;
  }, []);

  const load = useCallback(async () => {
    if (!yearId) return;
    try {
      const [mine, requests] = await Promise.all([
        budgetRequestService.myLines(yearId),
        budgetRequestService.list({ fiscalYearId: yearId }),
      ]);
      const onLines = new Set(mine.lines.map((l) => l.request?.id).filter(Boolean));
      const proposed = requests.filter((r) => r.isProposedLine && !onLines.has(r.id));
      setData(mine);
      setProposals(proposed);
      setError(null);
      // Keep the navigation's "Next year's budget" entry in step with this.
      if (userId) rememberPlans(userId, mine.lines.length > 0 || requests.length > 0);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Could not load next year's budget"));
    } finally {
      setLoading(false);
    }
  }, [yearId, userId, rememberPlans]);

  useEffect(() => {
    void load();
  }, [load]);

  const year = data?.fiscalYear ?? years?.find((y) => y.id === yearId) ?? null;
  const open = Boolean(data?.fiscalYear.requestsOpen);
  const canPropose = open && options.positions.length > 0;

  const run = async (action: () => Promise<unknown>, success: string, fallback: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, fallback));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const handleSubmit = (request: BudgetRequest) =>
    void run(
      () => budgetRequestService.submit(request.id),
      'Request submitted to the Treasurer',
      'Could not submit the request'
    );

  const handleWithdraw = async (request: BudgetRequest) => {
    const ok = await confirm({
      title: 'Withdraw this request?',
      message: `${request.lineLabel} goes back to a draft. The Treasurer will not review it until you submit it again.`,
      confirmLabel: 'Withdraw',
      cancelLabel: 'Keep it submitted',
      variant: 'warning',
    });
    if (!ok) return;
    await run(
      () => budgetRequestService.withdraw(request.id),
      'Request withdrawn to draft',
      'Could not withdraw the request'
    );
  };

  const handleDelete = async (request: BudgetRequest) => {
    const ok = await confirm({
      title: 'Delete this draft?',
      message: `The draft request for ${request.lineLabel} is removed. You can make a new one while requests are open.`,
      confirmLabel: 'Delete draft',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    await run(() => budgetRequestService.delete(request.id), 'Draft deleted', 'Could not delete the draft');
  };

  const cardActions = {
    onEdit: (request: BudgetRequest) => setDialog({ kind: 'edit', request }),
    onSubmit: handleSubmit,
    onWithdraw: (request: BudgetRequest) => void handleWithdraw(request),
    onDelete: (request: BudgetRequest) => void handleDelete(request),
  };

  const lines = useMemo(() => data?.lines ?? [], [data]);

  if (loading && years === null) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <h1 className="text-theme-text-primary text-2xl font-bold">Next year&apos;s budget</h1>
        <div className="space-y-3" role="status" aria-live="polite" aria-label="Loading next year's budget">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">Next year&apos;s budget</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Propose what each budget line your position owns needs next year. The Treasurer approves the amount, adjusts
          it with a note, or declines it. Your current lines are on <Link to="/finance/my-budgets">My Budgets</Link>.
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

      {years !== null && years.length === 0 && !error && (
        <EmptyState
          icon={ClipboardList}
          title="No budget is being planned"
          description="The Treasurer has not started next year's budget yet. When they do, the budget lines your position owns appear here."
        />
      )}

      {years !== null && years.length > 1 && (
        <div className="max-w-xs">
          <label htmlFor="budget-request-year" className="form-label">
            Fiscal year
          </label>
          <select
            id="budget-request-year"
            className="form-input"
            value={yearId}
            onChange={(e) => {
              setData(null);
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
      )}

      {yearId && !data && !error && (
        <div className="space-y-3" role="status" aria-live="polite" aria-label="Loading your budget lines">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {year && data && (
        <>
          <section
            aria-label="Request deadline"
            className={`flex flex-wrap items-center gap-3 rounded-lg border p-4 ${
              open
                ? 'border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10'
                : 'border-theme-surface-border bg-theme-surface-secondary'
            }`}
          >
            <CalendarClock className="text-theme-text-primary h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-theme-text-primary text-lg font-semibold">{requestWindowText(data.fiscalYear)}</p>
              <p className="text-theme-text-secondary text-sm">
                {open
                  ? `Requests for ${data.fiscalYear.name} stay open through the end of the deadline day.`
                  : data.fiscalYear.requestDeadline
                    ? `The deadline for ${data.fiscalYear.name} was ${formatCalendarDate(data.fiscalYear.requestDeadline)}. Requests can be read but no longer changed.`
                    : `${data.fiscalYear.name} is no longer taking requests.`}
              </p>
            </div>
          </section>

          <section aria-labelledby="my-lines-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="my-lines-heading" className="text-theme-text-primary text-lg font-semibold">
                Your budget lines in {data.fiscalYear.name}
              </h2>
              {canPropose && (
                <button
                  type="button"
                  className="btn-secondary btn-sm inline-flex items-center gap-1.5"
                  onClick={() => setDialog({ kind: 'proposal', options })}
                  disabled={busy}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Propose a new line
                </button>
              )}
            </div>
            {lines.length === 0 ? (
              <p className="text-theme-text-secondary text-sm">
                Your position does not own a budget line in {data.fiscalYear.name}.
                {canPropose ? ' You can propose a new one.' : ''}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {lines.map((line) => {
                  const title = `${line.budget.categoryName || 'Budget line'} · ${
                    line.budget.stationId ? line.budget.stationName || 'Unknown station' : 'Department-wide'
                  }`;
                  return (
                    <RequestCard
                      key={line.budget.id}
                      title={title}
                      subtitle={
                        line.budget.effectiveOwnerPositionName
                          ? `Owner: ${line.budget.effectiveOwnerPositionName}`
                          : undefined
                      }
                      lastYearName={line.lastYearFiscalYearName}
                      lastYearBudgeted={line.lastYearBudgeted}
                      lastYearSpent={line.lastYearSpent}
                      request={line.request}
                      open={open}
                      busy={busy}
                      onCreate={() =>
                        setDialog({
                          kind: 'line',
                          budgetId: line.budget.id,
                          lineLabel: title,
                          lastYearBudgeted: line.lastYearBudgeted,
                        })
                      }
                      {...cardActions}
                    />
                  );
                })}
              </ul>
            )}
          </section>

          {proposals.length > 0 && (
            <section aria-labelledby="proposals-heading" className="space-y-3">
              <h2 id="proposals-heading" className="text-theme-text-primary text-lg font-semibold">
                New lines you proposed
              </h2>
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {proposals.map((request) => (
                  <RequestCard
                    key={request.id}
                    title={request.lineLabel}
                    subtitle={request.ownerPositionName ? `For ${request.ownerPositionName}` : undefined}
                    lastYearName={request.lastYearFiscalYearName}
                    lastYearBudgeted={request.lastYearBudgeted}
                    lastYearSpent={request.lastYearSpent}
                    request={request}
                    open={open}
                    busy={busy}
                    {...cardActions}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {dialog && data && (
        <BudgetRequestDialog
          fiscalYearId={data.fiscalYear.id}
          fiscalYearName={data.fiscalYear.name}
          target={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}
    </div>
  );
};

export default BudgetRequestsPage;
