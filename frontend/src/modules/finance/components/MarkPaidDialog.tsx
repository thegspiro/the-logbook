/**
 * Mark a purchase request paid, recording what was actually paid.
 *
 * Owner decision 2026-11-01: "Mark Paid" asks for the amount rather than
 * assuming the estimate. The budget line spends what is entered here, and the
 * request then shows the difference from the approved amount — the server's
 * `paidDifference`, never a figure worked out on this screen. A refusal (no
 * receipt on file, an overspent fund) is shown as the server words it.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { MAX_MONEY_AMOUNT, MIN_MONEY_AMOUNT } from '../utils/moneyLimits';
import { purchaseRequestService } from '../services/api';
import type { PurchaseRequest } from '../types';

interface MarkPaidDialogProps {
  purchase: PurchaseRequest;
  onClose: () => void;
  onPaid: (purchase: PurchaseRequest) => void;
}

export const MarkPaidDialog: React.FC<MarkPaidDialogProps> = ({ purchase, onClose, onPaid }) => {
  const [amount, setAmount] = useState(Number(purchase.estimatedAmount).toFixed(2));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed < MIN_MONEY_AMOUNT || parsed > MAX_MONEY_AMOUNT) {
      setError('Enter the amount paid, more than zero.');
      return;
    }
    setError('');
    void save(parsed);
  };

  const save = async (parsed: number) => {
    setSaving(true);
    try {
      const paid = await purchaseRequestService.markPaid(purchase.id, parsed.toFixed(2));
      toast.success(`${purchase.requestNumber} marked paid`);
      onPaid(paid);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not mark the request paid'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Mark paid"
      titleId="mark-paid-title"
      aria-describedby="mark-paid-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Mark paid
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="mark-paid-description" className="text-theme-text-secondary text-sm">
          {purchase.requestNumber} was approved for {formatCurrency(purchase.estimatedAmount)}. Enter what the invoice
          or receipt actually came to: the budget line is charged that amount, and the request shows any difference from
          what was approved.
        </p>
        <div>
          <label htmlFor="mark-paid-amount" className="form-label">
            Amount paid
          </label>
          <input
            id="mark-paid-amount"
            type="number"
            inputMode="decimal"
            min={MIN_MONEY_AMOUNT}
            max={MAX_MONEY_AMOUNT}
            step="0.01"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'mark-paid-error' : undefined}
          />
          {error && (
            <p id="mark-paid-error" role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
