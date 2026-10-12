/**
 * Record a payment against one member's dues.
 *
 * Each save appends a row to the member's payment ledger; the backend then
 * re-derives the paid total and the status (partial or paid) from the whole
 * ledger, so this dialog decides neither (CLAUDE.md pitfall #29).
 *
 * The reference matters: a payment re-submitted with the same reference is
 * recognised and not credited twice, which is the only protection a
 * double-tapped Save has. Cash with no reference is always appended.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { duesService } from '../services/api';
import type { DuesPaymentPayload, MemberDues } from '../types';
import { DUES_PAYMENT_METHODS, outstandingOf } from '../utils/dues';

const MAX_AMOUNT = 9_999_999_999.99;

interface DuesPaymentDialogProps {
  dues: MemberDues;
  /** Who the dues belong to, for the dialog's description. */
  memberLabel: string;
  onClose: () => void;
  onSaved: () => void;
}

export const DuesPaymentDialog: React.FC<DuesPaymentDialogProps> = ({ dues, memberLabel, onClose, onSaved }) => {
  const outstanding = outstandingOf(dues);
  const [amount, setAmount] = useState(outstanding > 0 ? outstanding.toFixed(2) : '');
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (parsed > MAX_AMOUNT) {
      setError('That amount is too large.');
      return;
    }
    setError('');
    void save({
      amountPaid: parsed.toFixed(2),
      paymentMethod: method || undefined,
      transactionReference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const save = async (payload: DuesPaymentPayload) => {
    setSaving(true);
    try {
      await duesService.recordPayment(dues.id, payload);
      toast.success('Payment recorded');
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record the payment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Record payment"
      titleId="dues-payment-form-title"
      aria-describedby="dues-payment-form-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record payment
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="dues-payment-form-description" className="text-theme-text-secondary text-sm">
          {memberLabel} owes {formatCurrency(dues.amountDue)} and has paid {formatCurrency(dues.amountPaid)}. A payment
          is added to their ledger and cannot be edited afterwards.
        </p>

        <div>
          <label htmlFor="dues-payment-amount" className="form-label">
            Amount received
          </label>
          <input
            id="dues-payment-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'dues-payment-amount-error' : undefined}
          />
          {error && (
            <p id="dues-payment-amount-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="dues-payment-method" className="form-label">
            Method <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <select
            id="dues-payment-method"
            className="form-input"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="">Not recorded</option>
            {DUES_PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="dues-payment-reference" className="form-label">
            Reference <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <input
            id="dues-payment-reference"
            type="text"
            maxLength={200}
            placeholder="Check number or transaction ID"
            className="form-input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            aria-describedby="dues-payment-reference-hint"
          />
          <p id="dues-payment-reference-hint" className="text-theme-text-secondary mt-1 text-xs">
            A payment already recorded with this reference is not credited again.
          </p>
        </div>

        <div>
          <label htmlFor="dues-payment-notes" className="form-label">
            Notes <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <textarea
            id="dues-payment-notes"
            rows={2}
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
