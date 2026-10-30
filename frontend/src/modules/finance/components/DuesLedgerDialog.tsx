/**
 * One member's dues ledger: every payment recorded against the record.
 *
 * The dues row carries only the derived total and the latest payment's
 * detail; this is the underlying list (`GET /finance/dues/:id/payments`),
 * and the only place earlier payments can be read back. Read-only — a
 * payment cannot be edited or removed once recorded.
 */

import React, { useEffect, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { formatDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { duesService } from '../services/api';
import { DUES_PAYMENT_METHODS } from '../utils/dues';
import type { DuesPayment, MemberDues } from '../types';

const METHOD_LABELS: Record<string, string> = Object.fromEntries(DUES_PAYMENT_METHODS.map((m) => [m.value, m.label]));

interface DuesLedgerDialogProps {
  dues: MemberDues;
  memberLabel: string;
  onClose: () => void;
}

export const DuesLedgerDialog: React.FC<DuesLedgerDialogProps> = ({ dues, memberLabel, onClose }) => {
  const tz = useTimezone();
  const [payments, setPayments] = useState<DuesPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    duesService
      .listPayments(dues.id)
      .then((rows) => {
        if (!cancelled) setPayments(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load the payment history'));
      });
    return () => {
      cancelled = true;
    };
  }, [dues.id]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Payment history"
      titleId="dues-ledger-title"
      size="lg"
      footer={
        <button type="button" onClick={onClose} className="btn-secondary">
          Close
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          {memberLabel}: {formatCurrency(dues.amountPaid)} paid of {formatCurrency(dues.amountDue)}.
        </p>
        {dues.waiveReason && <p className="alert-warning rounded-lg p-3 text-sm">Waived: {dues.waiveReason}</p>}

        {error ? (
          <p role="alert" className="alert-danger rounded-lg p-3 text-sm">
            {error}
          </p>
        ) : payments === null ? (
          <p className="text-theme-text-secondary text-sm">Loading payments…</p>
        ) : payments.length === 0 ? (
          <p className="text-theme-text-secondary text-sm">No payments have been recorded against these dues.</p>
        ) : (
          <ul className="divide-theme-surface-border border-theme-surface-border divide-y rounded-lg border">
            {payments.map((payment) => (
              <li key={payment.id} className="split-row gap-1 p-3 text-sm">
                <div className="split-row-main">
                  <p className="text-theme-text-primary font-medium">{formatCurrency(payment.amount)}</p>
                  <p className="text-theme-text-secondary text-xs">
                    {[
                      payment.paymentMethod ? (METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod) : null,
                      payment.transactionReference ? `Ref. ${payment.transactionReference}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No method recorded'}
                  </p>
                  {payment.notes && <p className="text-theme-text-secondary mt-1 text-xs">{payment.notes}</p>}
                </div>
                <p className="split-row-aside text-theme-text-secondary text-xs sm:text-right">
                  {formatDateTime(payment.receivedAt, tz)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};
