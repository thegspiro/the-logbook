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
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { refusalsOnFields } from '../utils/fieldRefusals';
import { MAX_MONEY_AMOUNT, MIN_MONEY_AMOUNT } from '../utils/moneyLimits';
import { purchaseRequestService } from '../services/api';
import type { PurchaseRequest } from '../types';

/** The amount travels as the `actual_amount` query parameter. */
const SERVER_FIELDS: Record<'amount', ServerFieldSpec> = {
  amount: { label: 'Amount paid', api: ['query.actual_amount', 'actual_amount', 'actualAmount'] },
};

interface MarkPaidDialogProps {
  purchase: PurchaseRequest;
  onClose: () => void;
  onPaid: (purchase: PurchaseRequest) => void;
}

export const MarkPaidDialog: React.FC<MarkPaidDialogProps> = ({ purchase, onClose, onPaid }) => {
  const initialAmount = Number(purchase.estimatedAmount).toFixed(2);
  const [amount, setAmount] = useState(initialAmount);
  const [error, setError] = useState('');
  // A refusal about the request rather than the amount (no receipt on file).
  const [refusal, setRefusal] = useState('');
  const [saving, setSaving] = useState(false);
  // Escape, the X and Cancel all ask before throwing away a changed amount.
  const requestClose = useDiscardGuard({ isDirty: amount !== initialAmount, onClose });
  const showError = (message: string) => {
    setError(message);
    document.getElementById('mark-paid-amount')?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed < MIN_MONEY_AMOUNT || parsed > MAX_MONEY_AMOUNT) {
      showError('Enter the amount paid, more than zero.');
      return;
    }
    setError('');
    setRefusal('');
    void save(parsed);
  };

  const save = async (parsed: number) => {
    setSaving(true);
    try {
      const paid = await purchaseRequestService.markPaid(purchase.id, parsed.toFixed(2));
      toast.success(`${purchase.requestNumber} marked paid`);
      onPaid(paid);
    } catch (err: unknown) {
      // Nothing is marked paid while the amount is refused, and the refusal
      // stays on the field; any other reason is the server's own words.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped?.fieldErrors.amount) {
        showError(mapped.fieldErrors.amount);
        setRefusal(mapped.unmatched.join(' '));
      } else {
        setRefusal(getErrorMessage(err, 'Could not mark the request paid'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Mark paid"
      titleId="mark-paid-title"
      aria-describedby="mark-paid-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Mark paid
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
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
        {refusal && (
          <p role="alert" className="text-sm text-red-800 dark:text-red-300">
            {refusal}
          </p>
        )}
        <FormField id="mark-paid-amount" label="Amount paid" error={error}>
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="decimal"
              min={MIN_MONEY_AMOUNT}
              max={MAX_MONEY_AMOUNT}
              step="0.01"
              className="form-input"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError('');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
