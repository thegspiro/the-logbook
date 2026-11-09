/**
 * Record unspent cash a member handed back against a cash advance.
 *
 * The server checks the amount against what is outstanding under a lock and
 * refuses the member who owes it (separation of duties), so this dialog only
 * prefills the outstanding balance and validates the shape of the input.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { getTodayLocalDate, localToUTC } from '../../../utils/dateFormatting';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { advanceService } from '../services/api';
import type { AdvanceSummary } from '../types';
import { DUES_PAYMENT_METHODS } from '../utils/dues';
import { firstErrorField, refusalsOnFields, useFieldErrors } from '../utils/fieldRefusals';
import { MAX_MONEY_AMOUNT } from '../utils/moneyLimits';

type ReturnField = 'amount' | 'returnedOn' | 'method' | 'reference' | 'notes';

/** `AdvanceReturnCreate` (schemas/finance.py). */
const SERVER_FIELDS: Record<ReturnField, ServerFieldSpec> = {
  amount: { label: 'Amount returned' },
  returnedOn: { label: 'Returned on', api: ['returned_at', 'returnedAt'] },
  method: { label: 'Method', maxLength: 50, api: ['payment_method', 'paymentMethod'] },
  reference: { label: 'Reference', maxLength: 200 },
  notes: { label: 'Notes', maxLength: 5000 },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as ReturnField[];
const FIELD_IDS: Record<ReturnField, string> = {
  amount: 'advance-return-amount',
  returnedOn: 'advance-return-date',
  method: 'advance-return-method',
  reference: 'advance-return-reference',
  notes: 'advance-return-notes',
};

interface AdvanceReturnDialogProps {
  advance: AdvanceSummary;
  onClose: () => void;
  onSaved: () => void;
}

export const AdvanceReturnDialog: React.FC<AdvanceReturnDialogProps> = ({ advance, onClose, onSaved }) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const outstanding = Number(advance.outstanding);
  const initialAmount = outstanding > 0 ? outstanding.toFixed(2) : '';
  const [amount, setAmount] = useState(initialAmount);
  const [returnedOn, setReturnedOn] = useState(today);
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const { errors, setErrors, clearError } = useFieldErrors<ReturnField>();
  const [saving, setSaving] = useState(false);
  const isDirty = amount !== initialAmount || returnedOn !== today || method !== '' || reference !== '' || notes !== '';
  // Escape, the X and Cancel all ask before throwing away a typed return.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const flag = (next: Partial<Record<ReturnField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amount);
    const next: Partial<Record<ReturnField, string>> = {};
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      next.amount = 'Enter an amount greater than zero.';
    } else if (parsed > outstanding) {
      next.amount = `Only ${formatCurrency(advance.outstanding)} of this advance is outstanding.`;
    }
    if (!returnedOn || returnedOn > today) {
      next.returnedOn = 'Choose the day the cash came back; it cannot be in the future.';
    }
    if (!flag(next)) return;
    void save(parsed);
  };

  const save = async (parsed: number) => {
    setSaving(true);
    try {
      await advanceService.recordReturn(advance.id, {
        amount: parsed.toFixed(2),
        // Today goes as "now"; an earlier day is dated at its noon in the
        // department's timezone, so it lands on that calendar day.
        returnedAt: returnedOn === today ? undefined : localToUTC(`${returnedOn}T12:00`, tz),
        paymentMethod: method || undefined,
        reference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success('Return recorded');
      onSaved();
    } catch (err: unknown) {
      // Nothing is recorded until every field is accepted.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Could not record the return'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Record returned cash"
      titleId="advance-return-form-title"
      aria-describedby="advance-return-form-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record return
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="advance-return-form-description" className="text-theme-text-secondary text-sm">
          {advance.memberName} has {formatCurrency(advance.outstanding)} of advance {advance.requestNumber} not yet
          accounted for. Record the cash they handed back.
        </p>

        <FormField id={FIELD_IDS.amount} label="Amount returned" error={errors.amount}>
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

        <FormField id={FIELD_IDS.returnedOn} label="Returned on" error={errors.returnedOn}>
          {(field) => (
            <input
              {...field}
              type="date"
              max={today}
              className="form-input"
              value={returnedOn}
              onChange={(e) => {
                setReturnedOn(e.target.value);
                clearError('returnedOn');
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
          maxLength={200}
          count={reference.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              placeholder="Check number or receipt number"
              className="form-input"
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
                clearError('reference');
              }}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.notes}
          label="Notes"
          optional
          error={errors.notes}
          maxLength={5000}
          count={notes.length}
        >
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
