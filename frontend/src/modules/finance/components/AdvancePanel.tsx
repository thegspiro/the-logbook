/**
 * What is left of an issued cash advance: the expense reports that account for
 * it, the cash handed back, and what the member still owes.
 *
 * Every figure is the server's (`GET /finance/advances/{id}`), including
 * whether it is overdue, so this panel and the advances report always agree
 * (CLAUDE.md pitfall #29).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { advanceService } from '../services/api';
import { ADVANCE_RETURN_DAYS, EXPENSE_REPORT_STATUS_COLORS, type AdvanceDetail, type AdvanceReturn } from '../types';
import { AdvanceReturnDialog } from './AdvanceReturnDialog';

const REPORT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  denied: 'Denied',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  online: 'Online payment',
  other: 'Other',
};

interface AdvancePanelProps {
  advanceId: string;
  /** The finance office records and removes returns. */
  canManage: boolean;
}

export const AdvancePanel: React.FC<AdvancePanelProps> = ({ advanceId, canManage }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [advance, setAdvance] = useState<AdvanceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  const load = useCallback(async () => {
    try {
      setAdvance(await advanceService.get(advanceId));
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the advance'));
    }
  }, [advanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeReturn = async (entry: AdvanceReturn) => {
    const ok = await confirm({
      title: 'Remove this return?',
      message: `The ${formatCurrency(entry.amount)} returned on ${formatDate(entry.returnedAt, tz)} will no longer count against the advance.`,
      confirmLabel: 'Remove return',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await advanceService.deleteReturn(advanceId, entry.id);
      toast.success('Return removed');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not remove the return'));
    }
  };

  if (error) {
    return (
      <p role="alert" className="alert-danger text-sm">
        {error}
      </p>
    );
  }
  if (!advance) return null;

  const outstanding = Number(advance.outstanding);

  return (
    <section className="card p-6" aria-labelledby="advance-panel-heading">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="advance-panel-heading" className="text-theme-text-primary text-lg font-semibold">
            Accounting for this advance
          </h2>
          {advance.overdue ? (
            <span className="badge bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400">Overdue</span>
          ) : outstanding <= 0 ? (
            <span className="badge bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400">
              Accounted for
            </span>
          ) : null}
        </div>
        {canManage && outstanding > 0 && (
          <button type="button" className="btn-secondary" onClick={() => setRecording(true)}>
            Record returned cash
          </button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-theme-text-secondary text-xs">Advanced</dt>
          <dd className="text-theme-text-primary text-sm font-semibold">{formatCurrency(advance.amount)}</dd>
        </div>
        <div>
          <dt className="text-theme-text-secondary text-xs">Accounted for by reports</dt>
          <dd className="text-theme-text-primary text-sm">{formatCurrency(advance.accounted)}</dd>
        </div>
        <div>
          <dt className="text-theme-text-secondary text-xs">Returned</dt>
          <dd className="text-theme-text-primary text-sm">{formatCurrency(advance.returned)}</dd>
        </div>
        <div>
          <dt className="text-theme-text-secondary text-xs">Outstanding</dt>
          <dd className="text-theme-text-primary text-sm font-semibold">{formatCurrency(advance.outstanding)}</dd>
        </div>
      </dl>

      {outstanding > 0 && advance.dueAt && (
        <p className={`mt-4 text-sm ${advance.overdue ? 'alert-danger' : 'text-theme-text-secondary'}`}>
          {advance.overdue
            ? `More than ${String(ADVANCE_RETURN_DAYS)} days have passed since this advance was issued. What is still outstanding may have to be reported as the member's wages, and they cannot request another advance until it is settled.`
            : `Due by ${formatDate(advance.dueAt, tz)}: submit expense reports against it, or return what was not spent.`}
        </p>
      )}

      <h3 className="text-theme-text-primary mt-6 mb-2 text-sm font-semibold">Expense reports</h3>
      {advance.reports.length === 0 ? (
        <p className="text-theme-text-secondary text-sm">No expense report accounts for this advance yet.</p>
      ) : (
        <ul className="divide-theme-surface-border divide-y">
          {advance.reports.map((report) => (
            <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <Link
                  to={`/finance/expense-reports/${report.id}`}
                  className="font-medium text-red-700 hover:underline dark:text-red-400"
                >
                  {report.reportNumber}
                </Link>{' '}
                <span className="text-theme-text-secondary">{report.title}</span>{' '}
                <span className={`badge ${EXPENSE_REPORT_STATUS_COLORS[report.status] ?? ''}`}>
                  {REPORT_STATUS_LABELS[report.status] ?? report.status}
                </span>
              </span>
              <span className="text-theme-text-primary tabular-nums">
                {report.advanceApplied != null
                  ? `${formatCurrency(report.advanceApplied)} of ${formatCurrency(report.totalAmount)}`
                  : formatCurrency(report.totalAmount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="text-theme-text-primary mt-6 mb-2 text-sm font-semibold">Returned cash</h3>
      {advance.returns.length === 0 ? (
        <p className="text-theme-text-secondary text-sm">Nothing returned.</p>
      ) : (
        <ul className="divide-theme-surface-border divide-y">
          {advance.returns.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="text-theme-text-primary">
                {formatDate(entry.returnedAt, tz)}
                {entry.paymentMethod && (
                  <span className="text-theme-text-secondary">
                    {' '}
                    · {METHOD_LABELS[entry.paymentMethod] ?? entry.paymentMethod}
                  </span>
                )}
                {entry.reference && <span className="text-theme-text-secondary"> · {entry.reference}</span>}
                {entry.qbExportedAt && <span className="text-theme-text-secondary"> · Sent to QuickBooks</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-theme-text-primary tabular-nums">{formatCurrency(entry.amount)}</span>
                {canManage && !entry.qbExportedAt && (
                  <button
                    type="button"
                    className="btn-icon text-theme-text-secondary hover:text-red-700"
                    aria-label={`Remove the ${formatCurrency(entry.amount)} return`}
                    onClick={() => void removeReturn(entry)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {recording && (
        <AdvanceReturnDialog
          advance={advance}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            void load();
          }}
        />
      )}
    </section>
  );
};
