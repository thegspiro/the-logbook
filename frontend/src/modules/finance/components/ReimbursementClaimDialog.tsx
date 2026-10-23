/**
 * Claim back an approved purchase the requester paid for with their own money.
 *
 * The server raises a draft expense report linked to the request, with one
 * line copied from it (its budget line, fund and receipt). This dialog asks
 * only what the request cannot know: what was actually paid, when, and where.
 * Whether the purchase may be claimed, and by whom, is the server's to decide
 * (app/services/finance_reimbursement.py); its refusal is shown as given.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { getTodayLocalDate, localToUTC } from '../../../utils/dateFormatting';
import { purchaseRequestService } from '../services/api';
import type { ExpenseReport, PurchaseRequest } from '../types';

interface ReimbursementClaimDialogProps {
  purchase: PurchaseRequest;
  onClose: () => void;
  onClaimed: (report: ExpenseReport) => void;
}

export const ReimbursementClaimDialog: React.FC<ReimbursementClaimDialogProps> = ({ purchase, onClose, onClaimed }) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const [amount, setAmount] = useState(Number(purchase.actualAmount ?? purchase.estimatedAmount).toFixed(2));
  const [paidOn, setPaidOn] = useState(today);
  const [merchant, setMerchant] = useState(purchase.vendor ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter what you paid, more than zero.');
      return;
    }
    if (!paidOn || paidOn > today) {
      setError('Choose the day you paid; it cannot be in the future.');
      return;
    }
    setError('');
    void save(parsed);
  };

  const save = async (parsed: number) => {
    setSaving(true);
    try {
      const report = await purchaseRequestService.claimReimbursement(purchase.id, {
        amount: parsed.toFixed(2),
        // Dated at noon in the department's timezone so it lands on the day
        // chosen; the substantiation deadline counts from this day.
        dateIncurred: localToUTC(`${paidOn}T12:00`, tz),
        merchant: merchant.trim() || undefined,
      });
      toast.success(`Expense report ${report.reportNumber} started`);
      onClaimed(report);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not start the reimbursement'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Request reimbursement"
      titleId="reimbursement-claim-title"
      aria-describedby="reimbursement-claim-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Start expense report
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="reimbursement-claim-description" className="text-theme-text-secondary text-sm">
          If you paid for {purchase.requestNumber} yourself, this starts an expense report for it, charged to the same
          budget line. Check the receipt on it and submit it for approval; once it is approved the finance office pays
          you back. The request was approved for {formatCurrency(purchase.estimatedAmount)}.
        </p>

        <div>
          <label htmlFor="reimbursement-claim-amount" className="form-label">
            What you paid
          </label>
          <input
            id="reimbursement-claim-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'reimbursement-claim-error' : undefined}
          />
          {error && (
            <p id="reimbursement-claim-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="reimbursement-claim-date" className="form-label">
            Paid on
          </label>
          <input
            id="reimbursement-claim-date"
            type="date"
            max={today}
            className="form-input"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="reimbursement-claim-merchant" className="form-label">
            Where <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <input
            id="reimbursement-claim-merchant"
            type="text"
            maxLength={300}
            className="form-input"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
