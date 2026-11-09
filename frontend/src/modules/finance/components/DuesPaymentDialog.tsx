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
 *
 * W66-3, owner decision 2026-10-27: an amount over what is outstanding is
 * confirmed first, and the backend then records the balance against the dues
 * and the rest as a donation from the member. It refuses an overpayment that
 * does not say so, so this confirmation is not optional.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { duesService } from '../services/api';
import type { DuesPaymentPayload, MemberDues } from '../types';
import { DUES_PAYMENT_METHODS, outstandingOf } from '../utils/dues';
import { firstErrorField, refusalsOnFields, useFieldErrors } from '../utils/fieldRefusals';
import { MAX_MONEY_AMOUNT } from '../utils/moneyLimits';

type PaymentField = 'amount' | 'method' | 'reference' | 'notes';

/**
 * `MemberDuesPayment` (schemas/finance.py) sets no max_length; the reference's
 * 200 is its column's width (`dues_payments.transaction_reference`).
 */
const SERVER_FIELDS: Record<PaymentField, ServerFieldSpec> = {
  amount: { label: 'Amount received', api: ['amount_paid', 'amountPaid'] },
  method: { label: 'Method', api: ['payment_method', 'paymentMethod'] },
  reference: { label: 'Reference', maxLength: 200, api: ['transaction_reference', 'transactionReference'] },
  notes: { label: 'Notes' },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as PaymentField[];
const FIELD_IDS: Record<PaymentField, string> = {
  amount: 'dues-payment-amount',
  method: 'dues-payment-method',
  reference: 'dues-payment-reference',
  notes: 'dues-payment-notes',
};

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
  const { errors, setErrors, clearError } = useFieldErrors<PaymentField>();
  const [saving, setSaving] = useState(false);
  const { confirm } = useConfirm();
  const initialAmount = outstanding > 0 ? outstanding.toFixed(2) : '';
  const isDirty = amount !== initialAmount || method !== '' || reference !== '' || notes !== '';
  // Escape, the X and Cancel all ask before throwing away a typed payment.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const flag = (next: Partial<Record<PaymentField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      flag({ amount: 'Enter an amount greater than zero.' });
      return;
    }
    if (parsed > MAX_MONEY_AMOUNT) {
      flag({ amount: 'That amount is too large.' });
      return;
    }
    setErrors({});
    // In cents, so 70.10 - 70 is not 0.0999…
    const excessCents = Math.round(parsed * 100) - Math.round(Math.max(outstanding, 0) * 100);
    if (excessCents > 0) {
      const excess = formatCurrency(excessCents / 100);
      const owed = formatCurrency(Math.max(outstanding, 0));
      const ok = await confirm({
        title: 'Record the extra as a donation?',
        message:
          outstanding > 0
            ? `This is ${excess} more than the ${owed} ${memberLabel} still owes. ${owed} will be recorded against their dues and ${excess} as a donation from them.`
            : `${memberLabel}'s dues are already paid. The whole ${excess} will be recorded as a donation from them.`,
        confirmLabel: 'Record with donation',
        cancelLabel: 'Change the amount',
        variant: 'info',
      });
      if (!ok) return;
    }
    void save(
      {
        amountPaid: parsed.toFixed(2),
        paymentMethod: method || undefined,
        transactionReference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        ...(excessCents > 0 ? { excessAsDonation: true } : {}),
      },
      excessCents
    );
  };

  const save = async (payload: DuesPaymentPayload, excessCents: number) => {
    setSaving(true);
    try {
      await duesService.recordPayment(dues.id, payload);
      toast.success(
        excessCents > 0
          ? `Payment recorded, with ${formatCurrency(excessCents / 100)} as a donation`
          : 'Payment recorded'
      );
      onSaved();
    } catch (err: unknown) {
      // Nothing is recorded until every field is accepted; each refusal goes
      // on its field.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Could not record the payment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Record payment"
      titleId="dues-payment-form-title"
      aria-describedby="dues-payment-form-description"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record payment
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
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

        <FormField id={FIELD_IDS.amount} label="Amount received" error={errors.amount}>
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="decimal"
              min="0"
              max={MAX_MONEY_AMOUNT}
              step="0.01"
              className="form-input"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clearError('amount');
              }}
            />
          )}
        </FormField>

        <FormField id={FIELD_IDS.method} label="Method" optional error={errors.method}>
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                clearError('method');
              }}
            >
              <option value="">Not recorded</option>
              {DUES_PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.reference}
          label="Reference"
          optional
          error={errors.reference}
          hint="A payment already recorded with this reference is not credited again."
          maxLength={200}
          count={reference.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              placeholder="Check number or transaction ID"
              className="form-input"
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
                clearError('reference');
              }}
            />
          )}
        </FormField>

        <FormField id={FIELD_IDS.notes} label="Notes" optional error={errors.notes}>
          {(field) => (
            <textarea
              {...field}
              rows={2}
              className="form-input"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                clearError('notes');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
