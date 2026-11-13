/**
 * My Dues — the signed-in member's own dues (owner decision 2026-11-01).
 *
 * What is owed, what has been paid, when each is due, and any late fee —
 * charged or still to come. Every figure and status is the backend's
 * (`GET /finance/my-dues`), computed by the same rules the Treasurer's dues
 * screen and the late-fee task use, so the two screens cannot disagree about
 * one record (CLAUDE.md pitfall #29). Needs only a session: a member reads,
 * and the Treasurer records payments.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Receipt } from 'lucide-react';
import { duesService } from '../services/api';
import { DUES_STATUS_COLORS } from '../types';
import type { MyDues } from '../types';
import { DUES_PAYMENT_METHODS } from '../utils/dues';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate, formatDateTime } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '@/hooks/useTimezone';
import { Skeleton } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Due',
  paid: 'Paid',
  partial: 'Partly paid',
  overdue: 'Overdue',
  waived: 'Waived',
  exempt: 'Exempt',
};

const METHOD_LABELS: Record<string, string> = Object.fromEntries(DUES_PAYMENT_METHODS.map((m) => [m.value, m.label]));

const DuesCard: React.FC<{ dues: MyDues; tz: string }> = ({ dues, tz }) => {
  const owing = Number(dues.balance) > 0;
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-theme-text-primary font-semibold break-words">{dues.scheduleName}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${DUES_STATUS_COLORS[dues.status] ?? DUES_STATUS_COLORS.pending ?? ''}`}
        >
          {STATUS_LABELS[dues.status] ?? dues.status}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-theme-text-secondary">Due</dt>
          <dd className="text-theme-text-primary font-medium">{formatDate(dues.dueDate, tz)}</dd>
        </div>
        <div>
          <dt className="text-theme-text-secondary">Amount</dt>
          <dd className="text-theme-text-primary font-medium">{formatCurrency(dues.amountDue)}</dd>
        </div>
        <div>
          <dt className="text-theme-text-secondary">Paid</dt>
          <dd className="text-theme-text-primary font-medium">{formatCurrency(dues.amountPaid)}</dd>
        </div>
        <div>
          <dt className="text-theme-text-secondary">Still owed</dt>
          <dd className={`font-medium ${owing ? 'text-red-800 dark:text-red-300' : 'text-theme-text-primary'}`}>
            {formatCurrency(dues.balance)}
          </dd>
        </div>
      </dl>

      {dues.lateFeeApplied && Number(dues.lateFeeApplied) > 0 && (
        <p className="text-theme-text-secondary mt-3 text-sm">
          Includes a late fee of {formatCurrency(dues.lateFeeApplied)}.
        </p>
      )}
      {dues.lateFeeAmount && dues.lateFeeAfter && (
        <p className="alert-warning mt-3 rounded-lg p-3 text-sm">
          A late fee of {formatCurrency(dues.lateFeeAmount)} is added if the balance is still unpaid after{' '}
          {formatDate(dues.lateFeeAfter, tz)}.
        </p>
      )}
      {dues.waiveReason && <p className="text-theme-text-secondary mt-3 text-sm">Waived: {dues.waiveReason}</p>}

      {dues.payments.length > 0 && (
        <div className="mt-3">
          <h3 className="text-theme-text-secondary text-xs font-semibold tracking-wide uppercase">Payments</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {dues.payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-theme-text-primary">
                  {formatCurrency(payment.amount)}
                  {payment.paymentMethod ? ` · ${METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod}` : ''}
                </span>
                <span className="text-theme-text-secondary">{formatDateTime(payment.receivedAt, tz)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
};

const MyDuesPage: React.FC = () => {
  const tz = useTimezone();
  const [dues, setDues] = useState<MyDues[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    duesService
      .listMine()
      .then((rows) => {
        if (!cancelled) {
          setDues(rows);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load your dues'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Named rather than returned inline: the breadcrumb check reads every
    // `return (` in a page as a branch it renders (breadcrumbs.test.tsx).
    const stop = () => {
      cancelled = true;
    };
    return stop;
  }, []);

  const totalOwed = dues.reduce((sum, d) => sum + Number(d.balance), 0);

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">My Dues</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          What you owe the department, what you have paid, and when each is due. Payments are recorded by the Treasurer,
          so one you have just made may take a little while to appear.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3" role="status" aria-live="polite" aria-label="Loading your dues">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : error ? (
        <div role="alert" className="alert-danger flex items-center gap-3 rounded-lg p-4 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : dues.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="You have no dues"
          description="Dues appear here once the Treasurer bills them to you."
        />
      ) : (
        <>
          <p className="text-theme-text-primary text-sm font-medium">
            {totalOwed > 0 ? `Total still owed: ${formatCurrency(totalOwed)}` : 'You are paid up.'}
          </p>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {dues.map((row) => (
              <DuesCard key={row.id} dues={row} tz={tz} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
};

export default MyDuesPage;
