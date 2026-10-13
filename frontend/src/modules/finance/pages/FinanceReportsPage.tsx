/**
 * Finance reports for the board
 *
 * Budget vs actual, the amendment log and the payments register. Every figure
 * is the server's (`/finance/reports/*`): the page formats, it never sums, so
 * the screen, the CSV and the printout all show the same numbers (Pitfall #29).
 *
 * Printing uses the browser's own print, with the global print stylesheet
 * hiding the navigation and buttons; the selectors are hidden here so the
 * printout carries only the report and the heading that says what it covers.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { Download, FileBarChart, Printer } from 'lucide-react';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { EmptyState } from '@/components/ux/EmptyState';
import { useTimezone } from '@/hooks/useTimezone';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatCalendarDate, formatDate, getTodayLocalDate } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { saveFile, type DownloadedFile } from '@/utils/fileDownload';
import { financeReportService, fiscalYearService } from '../services/api';
import {
  FiscalYearStatus,
  PaymentKind,
  type AmendmentLogReport,
  type BudgetVsActualReport,
  type FiscalYear,
  FUNCTIONAL_CLASS_LABELS,
  type FunctionalExpensesReport,
  type LateSubstantiationReport,
  type PaymentsRegisterReport,
} from '../types';
import { useTablist } from '../../../hooks/useTablist';

const REPORTS = {
  'budget-vs-actual': 'Budget vs actual',
  'amendment-log': 'Amendment log',
  'payments-register': 'Payments register',
  'functional-expenses': 'Functional expenses',
  'late-substantiation': 'Outside the accountable plan',
} as const;
type ReportKey = keyof typeof REPORTS;
const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];

const isReportKey = (value: string | null): value is ReportKey => value !== null && value in REPORTS;

const KIND_LABELS: Record<PaymentKind, string> = {
  [PaymentKind.PURCHASE_REQUEST]: 'Purchase',
  [PaymentKind.CHECK_REQUEST]: 'Check',
  [PaymentKind.CHECK_VOID]: 'Check voided',
  [PaymentKind.EXPENSE_REPORT]: 'Reimbursement',
};

const AMENDMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
};

/** Matches the server's limit, so the screen refuses before the request does. */
const MAX_REGISTER_DAYS = 366;

const daysBetween = (start: string, end: string): number =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);

const lineName = (category: string, station?: string | null): string =>
  station ? `${category} (${station})` : category;

const thClass = 'text-theme-text-secondary px-3 py-2 text-xs font-semibold uppercase';
const tdClass = 'text-theme-text-primary px-3 py-2 text-sm';
const numClass = `${tdClass} text-right tabular-nums`;

// =============================================================================
// Shared pieces
// =============================================================================

interface ReportFrameProps {
  title: string;
  subtitle: string;
  loading: boolean;
  error: string | null;
  onDownload: () => Promise<DownloadedFile>;
  canDownload: boolean;
  children: React.ReactNode;
}

const ReportFrame: React.FC<ReportFrameProps> = ({
  title,
  subtitle,
  loading,
  error,
  onDownload,
  canDownload,
  children,
}) => {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      saveFile(await onDownload());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not download the report'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="card p-4 print:border-0 print:p-0 print:shadow-none" aria-labelledby="report-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="report-title" className="text-theme-text-primary text-lg font-semibold">
            {title}
          </h2>
          <p className="text-theme-text-secondary text-sm">{subtitle}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            type="button"
            className="btn-secondary flex items-center gap-2"
            disabled={!canDownload || downloading}
            onClick={() => void download()}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download CSV
          </button>
          <button
            type="button"
            className="btn-secondary flex items-center gap-2"
            disabled={!canDownload}
            onClick={() => window.print()}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="alert-danger text-sm">
          {error}
        </p>
      ) : loading ? (
        <p className="text-theme-text-secondary text-sm">Loading…</p>
      ) : (
        children
      )}
    </section>
  );
};

/**
 * Runs *load* whenever it changes and keeps only the latest answer, so a
 * slow response for an earlier selection cannot overwrite a newer one.
 */
function useReport<T>(load: (() => Promise<T>) | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!load) {
      setData(null);
      setLoading(false);
      return;
    }
    const request = ++latest.current;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (request === latest.current) setData(result);
      })
      .catch((err: unknown) => {
        if (request === latest.current) {
          setData(null);
          setError(getErrorMessage(err, 'Could not load the report'));
        }
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });
  }, [load]);

  return { data, error, loading };
}

const FiscalYearSelect: React.FC<{
  years: FiscalYear[];
  value: string;
  onChange: (id: string) => void;
}> = ({ years, value, onChange }) => (
  <div>
    <label htmlFor="report-fiscal-year" className="form-label">
      Fiscal year
    </label>
    <select
      id="report-fiscal-year"
      className="form-input w-48"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {years.map((year) => (
        <option key={year.id} value={year.id}>
          {year.name}
        </option>
      ))}
    </select>
  </div>
);

// =============================================================================
// Budget vs actual
// =============================================================================

const BudgetVsActual: React.FC<{ years: FiscalYear[]; fiscalYearId: string; onYear: (id: string) => void }> = ({
  years,
  fiscalYearId,
  onYear,
}) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const [asOf, setAsOf] = useState(today);

  const load = useCallback(
    () => financeReportService.budgetVsActual(fiscalYearId, asOf || undefined),
    [fiscalYearId, asOf]
  );
  const { data, error, loading } = useReport<BudgetVsActualReport>(fiscalYearId ? load : null);

  const subtitle = data
    ? `${data.fiscalYearName}, through ${formatCalendarDate(data.asOf)}`
    : 'Each budget line against what was paid from it.';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <FiscalYearSelect years={years} value={fiscalYearId} onChange={onYear} />
        <div>
          <label htmlFor="report-as-of" className="form-label">
            Through
          </label>
          <input
            id="report-as-of"
            type="date"
            className="form-input w-44"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
      </div>
      <ReportFrame
        title="Budget vs actual"
        subtitle={subtitle}
        loading={loading}
        error={error}
        canDownload={Boolean(data)}
        onDownload={() => financeReportService.budgetVsActualCsv(fiscalYearId, asOf || undefined)}
      >
        {data && data.rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No budget lines"
            description="This fiscal year has no budget lines yet."
          />
        ) : (
          data && (
            <>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="rwd-table w-full">
                  <thead className="border-theme-surface-border border-b text-left">
                    <tr>
                      <th className={thClass}>Budget line</th>
                      <th className={`${thClass} text-right`}>Original</th>
                      <th className={`${thClass} text-right`}>Amendments</th>
                      <th className={`${thClass} text-right`}>Budget</th>
                      <th className={`${thClass} text-right`}>Spent</th>
                      {data.includesCommitted && <th className={`${thClass} text-right`}>Committed</th>}
                      <th className={`${thClass} text-right`}>Remaining</th>
                      <th className={`${thClass} text-right`}>Used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {data.rows.map((row) => (
                      <tr key={row.budgetId}>
                        <td data-label="Budget line" className={tdClass}>
                          {lineName(row.categoryName, row.stationName)}
                          {row.runningSpentDiffers && (
                            <span className="text-theme-text-secondary block text-xs">
                              The line&apos;s running total reads {formatCurrency(row.runningSpent ?? null)}
                            </span>
                          )}
                        </td>
                        <td data-label="Original" className={numClass}>
                          {formatCurrency(row.originalBudget)}
                        </td>
                        <td data-label="Amendments" className={numClass}>
                          {formatCurrency(row.amendments)}
                        </td>
                        <td data-label="Budget" className={numClass}>
                          {formatCurrency(row.budget)}
                        </td>
                        <td data-label="Spent" className={numClass}>
                          {formatCurrency(row.spent)}
                        </td>
                        {data.includesCommitted && (
                          <td data-label="Committed" className={numClass}>
                            {formatCurrency(row.committed ?? null)}
                          </td>
                        )}
                        <td data-label="Remaining" className={numClass}>
                          {formatCurrency(row.remaining)}
                        </td>
                        <td data-label="Used" className={numClass}>
                          {row.percentUsed == null ? '-' : `${row.percentUsed.toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-theme-surface-border border-t-2 font-semibold">
                    <tr>
                      <td className={tdClass}>Total</td>
                      <td className={numClass}>{formatCurrency(data.totals.originalBudget)}</td>
                      <td className={numClass}>{formatCurrency(data.totals.amendments)}</td>
                      <td className={numClass}>{formatCurrency(data.totals.budget)}</td>
                      <td className={numClass}>{formatCurrency(data.totals.spent)}</td>
                      {data.includesCommitted && (
                        <td className={numClass}>{formatCurrency(data.totals.committed ?? null)}</td>
                      )}
                      <td className={numClass}>{formatCurrency(data.totals.remaining)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-theme-text-secondary mt-3 text-xs">
                Spent is the payments dated on or before {formatCalendarDate(data.asOf)}, net of voided checks.
                Amendments count once confirmed.{' '}
                {data.includesCommitted
                  ? 'Committed is approved spending not yet paid, and comes off Remaining.'
                  : 'Commitments are shown only on a report through today, because they are not recorded by date.'}
              </p>
            </>
          )
        )}
      </ReportFrame>
    </div>
  );
};

// =============================================================================
// Amendment log
// =============================================================================

const AmendmentLog: React.FC<{ years: FiscalYear[]; fiscalYearId: string; onYear: (id: string) => void }> = ({
  years,
  fiscalYearId,
  onYear,
}) => {
  const tz = useTimezone();
  const load = useCallback(() => financeReportService.amendmentLog(fiscalYearId), [fiscalYearId]);
  const { data, error, loading } = useReport<AmendmentLogReport>(fiscalYearId ? load : null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <FiscalYearSelect years={years} value={fiscalYearId} onChange={onYear} />
      </div>
      <ReportFrame
        title="Amendment log"
        subtitle={data ? data.fiscalYearName : 'Every change to the adopted budget, and who made it.'}
        loading={loading}
        error={error}
        canDownload={Boolean(data)}
        onDownload={() => financeReportService.amendmentLogCsv(fiscalYearId)}
      >
        {data && data.rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No amendments"
            description="The budget for this year has not been amended."
          />
        ) : (
          data && (
            <>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="rwd-table w-full">
                  <thead className="border-theme-surface-border border-b text-left">
                    <tr>
                      <th className={thClass}>Entered</th>
                      <th className={thClass}>Budget line</th>
                      <th className={`${thClass} text-right`}>Amount</th>
                      <th className={thClass}>Reason</th>
                      <th className={thClass}>Approved by</th>
                      <th className={thClass}>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {data.rows.map((row) => (
                      <tr key={row.amendmentId}>
                        <td data-label="Entered" className={tdClass}>
                          {formatDate(row.enteredAt, tz)}
                          {row.enteredByName && (
                            <span className="text-theme-text-secondary block text-xs">{row.enteredByName}</span>
                          )}
                        </td>
                        <td data-label="Budget line" className={tdClass}>
                          {lineName(row.categoryName, row.stationName)}
                        </td>
                        <td data-label="Amount" className={numClass}>
                          {formatCurrency(row.amount)}
                          {row.isReversal && <span className="text-theme-text-secondary block text-xs">Reversal</span>}
                        </td>
                        <td data-label="Reason" className={tdClass}>
                          {row.reason}
                        </td>
                        <td data-label="Approved by" className={tdClass}>
                          {row.approvedBy}
                          <span className="text-theme-text-secondary block text-xs">
                            {formatCalendarDate(row.approvedOn)}
                          </span>
                        </td>
                        <td data-label="Status" className={tdClass}>
                          {AMENDMENT_STATUS_LABELS[row.status] ?? row.status}
                          {row.decidedByName && (
                            <span className="text-theme-text-secondary block text-xs">
                              {row.decidedByName}
                              {row.decidedAt ? `, ${formatDate(row.decidedAt, tz)}` : ''}
                            </span>
                          )}
                          {row.decisionNote && (
                            <span className="text-theme-text-secondary block text-xs">{row.decisionNote}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-theme-text-primary mt-3 text-sm font-semibold">
                Net of confirmed amendments: {formatCurrency(data.confirmedNet)}
              </p>
            </>
          )
        )}
      </ReportFrame>
    </div>
  );
};

// =============================================================================
// Payments register
// =============================================================================

/**
 * A From/To period, defaulting to this month so far, with the server's limits
 * checked before asking it.
 */
function usePeriod() {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const [start, setStart] = useState(`${today.slice(0, 8)}01`);
  const [end, setEnd] = useState(today);

  const span = start && end ? daysBetween(start, end) : null;
  const rangeError =
    !start || !end
      ? 'Choose a start and an end date.'
      : span !== null && span < 0
        ? 'The end date must be on or after the start date.'
        : span !== null && span >= MAX_REGISTER_DAYS
          ? `Choose a period of at most ${MAX_REGISTER_DAYS} days.`
          : null;
  return { start, setStart, end, setEnd, rangeError };
}

const PeriodPicker: React.FC<{ period: ReturnType<typeof usePeriod> }> = ({ period }) => (
  <div className="flex flex-wrap items-end gap-3 print:hidden">
    <div>
      <label htmlFor="register-start" className="form-label">
        From
      </label>
      <input
        id="register-start"
        type="date"
        className="form-input w-44"
        value={period.start}
        onChange={(e) => period.setStart(e.target.value)}
      />
    </div>
    <div>
      <label htmlFor="register-end" className="form-label">
        To
      </label>
      <input
        id="register-end"
        type="date"
        className="form-input w-44"
        value={period.end}
        onChange={(e) => period.setEnd(e.target.value)}
      />
    </div>
  </div>
);

const PaymentsRegister: React.FC = () => {
  const period = usePeriod();
  const { start, end, rangeError } = period;

  const load = useCallback(() => financeReportService.paymentsRegister(start, end), [start, end]);
  const { data, error, loading } = useReport<PaymentsRegisterReport>(rangeError ? null : load);

  return (
    <div className="space-y-4">
      <PeriodPicker period={period} />
      <ReportFrame
        title="Payments register"
        subtitle={
          data
            ? `${formatCalendarDate(data.start)} to ${formatCalendarDate(data.end)}`
            : 'Every payment made in a period, oldest first.'
        }
        loading={loading}
        error={rangeError ?? error}
        canDownload={Boolean(data) && !rangeError}
        onDownload={() => financeReportService.paymentsRegisterCsv(start, end)}
      >
        {data && data.rows.length === 0 ? (
          <EmptyState headingLevel={3} title="No payments" description="Nothing was paid in this period." />
        ) : (
          data && (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="rwd-table w-full">
                <thead className="border-theme-surface-border border-b text-left">
                  <tr>
                    <th className={thClass}>Date</th>
                    <th className={thClass}>Type</th>
                    <th className={thClass}>Number</th>
                    <th className={thClass}>Payee</th>
                    <th className={thClass}>Description</th>
                    <th className={thClass}>Budget line</th>
                    <th className={`${thClass} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-theme-surface-border divide-y">
                  {data.rows.map((row) => (
                    <tr key={`${row.kind}-${row.entityId}`}>
                      <td data-label="Date" className={tdClass}>
                        {formatCalendarDate(row.paidOn)}
                      </td>
                      <td data-label="Type" className={tdClass}>
                        {KIND_LABELS[row.kind] ?? row.kind}
                      </td>
                      <td data-label="Number" className={tdClass}>
                        {row.number}
                        {row.checkNumber && (
                          <span className="text-theme-text-secondary block text-xs">Check {row.checkNumber}</span>
                        )}
                      </td>
                      <td data-label="Payee" className={tdClass}>
                        {row.payee}
                      </td>
                      <td data-label="Description" className={tdClass}>
                        {row.description}
                      </td>
                      <td data-label="Budget line" className={tdClass}>
                        {row.budgetLine || '-'}
                      </td>
                      <td data-label="Amount" className={numClass}>
                        {formatCurrency(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-theme-surface-border border-t-2 font-semibold">
                  <tr>
                    <td className={tdClass} colSpan={6}>
                      Total
                    </td>
                    <td className={numClass}>{formatCurrency(data.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        )}
      </ReportFrame>
    </div>
  );
};

// =============================================================================
// Functional expenses
// =============================================================================

const FunctionalExpenses: React.FC = () => {
  const period = usePeriod();
  const { start, end, rangeError } = period;

  const load = useCallback(() => financeReportService.functionalExpenses(start, end), [start, end]);
  const { data, error, loading } = useReport<FunctionalExpensesReport>(rangeError ? null : load);
  const unclassified = data?.classes.find((c) => c.functionalClass === null);

  return (
    <div className="space-y-4">
      <PeriodPicker period={period} />
      <ReportFrame
        title="Functional expenses"
        subtitle={
          data
            ? `Payments ${formatCalendarDate(data.start)} to ${formatCalendarDate(data.end)}, by function`
            : 'What the money was spent for, as the Form 990 reports it.'
        }
        loading={loading}
        error={rangeError ?? error}
        canDownload={Boolean(data) && !rangeError}
        onDownload={() => financeReportService.functionalExpensesCsv(start, end)}
      >
        {data && (
          <>
            {unclassified && (
              <p className="alert-warning text-theme-alert-warning-text mb-3 text-sm">
                {formatCurrency(unclassified.total)} is not classified yet. Give its budget categories an expense
                classification in Finance settings, or classify the payments themselves.
              </p>
            )}
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full">
                <thead className="border-theme-surface-border border-b text-left">
                  <tr>
                    <th className={thClass}>Budget category</th>
                    <th className={`${thClass} text-right`}>Amount</th>
                  </tr>
                </thead>
                {data.classes.map((group) => (
                  <tbody
                    key={group.functionalClass ?? 'unclassified'}
                    aria-labelledby={`functional-${group.functionalClass ?? 'unclassified'}`}
                    className="border-theme-surface-border border-b"
                  >
                    <tr>
                      <th
                        id={`functional-${group.functionalClass ?? 'unclassified'}`}
                        scope="rowgroup"
                        colSpan={2}
                        className={`${tdClass} pt-4 text-left font-semibold`}
                      >
                        {group.functionalClass ? FUNCTIONAL_CLASS_LABELS[group.functionalClass] : 'Unclassified'}
                      </th>
                    </tr>
                    {group.categories.length === 0 ? (
                      <tr>
                        <td className={`${tdClass} text-theme-text-secondary`} colSpan={2}>
                          Nothing in this period
                        </td>
                      </tr>
                    ) : (
                      group.categories.map((category) => (
                        <tr key={category.categoryId ?? 'none'}>
                          <td className={`${tdClass} pl-6`}>{category.categoryName ?? 'No budget line'}</td>
                          <td className={numClass}>{formatCurrency(category.amount)}</td>
                        </tr>
                      ))
                    )}
                    <tr>
                      <td className={`${tdClass} pl-6 font-semibold`}>Subtotal</td>
                      <td className={`${numClass} font-semibold`}>{formatCurrency(group.total)}</td>
                    </tr>
                  </tbody>
                ))}
                <tfoot className="border-theme-surface-border border-t-2 font-semibold">
                  <tr>
                    <td className={tdClass}>Total</td>
                    <td className={numClass}>{formatCurrency(data.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-theme-text-secondary mt-3 text-xs">
              The same payments as the payments register for the period, net of voided checks. Each takes its own
              classification if the finance office set one, otherwise its budget category&apos;s (or the parent
              category&apos;s). Fundraising is the cost of raising money, not what donations bought.
            </p>
          </>
        )}
      </ReportFrame>
    </div>
  );
};

// =============================================================================
// Outside the accountable plan
// =============================================================================

const LateSubstantiation: React.FC = () => {
  const period = usePeriod();
  const { start, end, rangeError } = period;

  const load = useCallback(() => financeReportService.lateSubstantiation(start, end), [start, end]);
  const { data, error, loading } = useReport<LateSubstantiationReport>(rangeError ? null : load);

  return (
    <div className="space-y-4">
      <PeriodPicker period={period} />
      <ReportFrame
        title="Outside the accountable plan"
        subtitle={
          data
            ? `Reimbursements paid ${formatCalendarDate(data.start)} to ${formatCalendarDate(data.end)}`
            : 'Expenses reimbursed after they were claimed too late.'
        }
        loading={loading}
        error={rangeError ?? error}
        canDownload={Boolean(data) && !rangeError}
        onDownload={() => financeReportService.lateSubstantiationCsv(start, end)}
      >
        {data && data.rows.length === 0 ? (
          <EmptyState
            headingLevel={3}
            title="No late expenses"
            description="Nothing reimbursed in this period was claimed after the deadline."
          />
        ) : (
          data && (
            <>
              <div className="overflow-x-auto print:overflow-visible">
                <table className="rwd-table w-full">
                  <thead className="border-theme-surface-border border-b text-left">
                    <tr>
                      <th className={thClass}>Paid</th>
                      <th className={thClass}>Member</th>
                      <th className={thClass}>Expense</th>
                      <th className={thClass}>Incurred</th>
                      <th className={thClass}>Submitted</th>
                      <th className={thClass}>Confirmed by</th>
                      <th className={`${thClass} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {data.rows.map((row, index) => (
                      <tr key={`${row.reportId}-${String(index)}`}>
                        <td data-label="Paid" className={tdClass}>
                          {formatCalendarDate(row.paidOn)}
                        </td>
                        <td data-label="Member" className={tdClass}>
                          {row.memberName}
                        </td>
                        <td data-label="Expense" className={tdClass}>
                          {row.description}
                          <span className="text-theme-text-secondary block text-xs">
                            {row.reportNumber}
                            {row.budgetLine ? ` · ${row.budgetLine}` : ''}
                          </span>
                        </td>
                        <td data-label="Incurred" className={tdClass}>
                          {formatCalendarDate(row.incurredOn)}
                        </td>
                        <td data-label="Submitted" className={tdClass}>
                          {row.submittedOn ? formatCalendarDate(row.submittedOn) : '-'}
                          {row.daysToSubmit != null && (
                            <span className="text-theme-text-secondary block text-xs">
                              {row.daysToSubmit} days later
                            </span>
                          )}
                        </td>
                        <td data-label="Confirmed by" className={tdClass}>
                          {row.acknowledgedByName || '-'}
                        </td>
                        <td data-label="Amount" className={numClass}>
                          {formatCurrency(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-theme-surface-border border-t-2 font-semibold">
                    <tr>
                      <td className={tdClass} colSpan={6}>
                        Total
                      </td>
                      <td className={numClass}>{formatCurrency(data.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-theme-text-secondary mt-3 text-xs">
                These expenses were claimed after the department&apos;s deadline, so their reimbursement falls outside
                the accountable plan. Ask your payroll or tax adviser whether to report them as taxable pay.
              </p>
            </>
          )
        )}
      </ReportFrame>
    </div>
  );
};

// =============================================================================
// Page
// =============================================================================

const FinanceReportsPage: React.FC = () => {
  const tablist = useTablist();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('report');
  const active: ReportKey = isReportKey(requested) ? requested : 'budget-vs-actual';

  const [years, setYears] = useState<FiscalYear[] | null>(null);
  const [yearsError, setYearsError] = useState<string | null>(null);
  const [fiscalYearId, setFiscalYearId] = useState('');

  useEffect(() => {
    fiscalYearService
      .list()
      .then((list) => {
        setYears(list);
        const current = list.find((y) => y.status === FiscalYearStatus.ACTIVE) ?? list[0];
        setFiscalYearId(current?.id ?? '');
      })
      .catch((err: unknown) => setYearsError(getErrorMessage(err, 'Could not load the fiscal years')));
  }, []);

  const selectReport = (key: ReportKey) => {
    const next = new URLSearchParams(searchParams);
    next.set('report', key);
    setSearchParams(next, { replace: true });
  };

  const needsYear =
    active !== 'payments-register' && active !== 'late-substantiation' && active !== 'functional-expenses';

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Breadcrumbs />
      </div>
      <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold print:hidden">
        <FileBarChart className="h-6 w-6" aria-hidden="true" />
        Finance reports
      </h1>

      <div className="tab-scroll print:hidden" role="tablist" {...tablist} aria-label="Reports">
        {REPORT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active === key}
            className={`mobile-touch-target px-4 py-2 text-sm font-medium whitespace-nowrap ${
              active === key ? 'border-theme-accent-red text-theme-accent-red border-b-2' : 'text-theme-text-secondary'
            }`}
            onClick={() => selectReport(key)}
          >
            {REPORTS[key]}
          </button>
        ))}
      </div>

      {active === 'payments-register' ? (
        <PaymentsRegister />
      ) : active === 'functional-expenses' ? (
        <FunctionalExpenses />
      ) : active === 'late-substantiation' ? (
        <LateSubstantiation />
      ) : yearsError ? (
        <p role="alert" className="alert-danger text-sm">
          {yearsError}
        </p>
      ) : years === null ? (
        <p className="text-theme-text-secondary text-sm">Loading…</p>
      ) : needsYear && years.length === 0 ? (
        <EmptyState title="No fiscal years" description="Create a fiscal year in Finance settings first." />
      ) : active === 'amendment-log' ? (
        <AmendmentLog years={years} fiscalYearId={fiscalYearId} onYear={setFiscalYearId} />
      ) : (
        <BudgetVsActual years={years} fiscalYearId={fiscalYearId} onYear={setFiscalYearId} />
      )}
    </div>
  );
};

export default FinanceReportsPage;
