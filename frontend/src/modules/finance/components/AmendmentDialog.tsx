/**
 * Record a budget amendment — extra money leadership approved for a line.
 *
 * The Treasurer's screen (`finance.manage`). Saving enters the amendment
 * pending, as a record of who approved it and when; the line's budget goes up
 * only once a second officer (`finance.budget_review` or `finance.manage`,
 * never whoever entered it) confirms it on the line's page.
 * Amendments cannot be edited or removed afterwards, so the form says so; a
 * mistaken one is corrected with `ReverseAmendmentDialog`.
 *
 * The checks here only spare a round trip; the backend makes the same ones
 * (the approval date against the department's calendar) and its message is
 * what the toast shows when it refuses.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstErrorField, refusalsOnFields, useFieldErrors } from '../utils/fieldRefusals';
import { getErrorMessage } from '../../../utils/errorHandling';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { budgetService } from '../services/api';
import type { BudgetAmendmentCreatePayload, BudgetAmendmentCreated } from '../types';
import { MAX_MONEY_AMOUNT } from '../utils/moneyLimits';

/** `BudgetAmendmentCreate`'s limits. */
const MAX_REASON = 2000;
const MAX_APPROVED_BY = 200;

type AmendField = 'amount' | 'reason' | 'approvedBy' | 'approvedOn';

/** `BudgetAmendmentCreate` / `BudgetAmendmentReverse` (schemas/finance.py). */
const SERVER_FIELDS: Record<AmendField, ServerFieldSpec> = {
  amount: { label: 'Amount' },
  reason: { label: 'Reason', maxLength: MAX_REASON },
  approvedBy: { label: 'Approved by', maxLength: MAX_APPROVED_BY },
  approvedOn: { label: 'Approval date' },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as AmendField[];
const FIELD_IDS: Record<AmendField, string> = {
  amount: 'amendment-amount',
  reason: 'amendment-reason',
  approvedBy: 'amendment-approved-by',
  approvedOn: 'amendment-approved-on',
};

interface AmendmentDialogProps {
  budgetId: string;
  /** The line's name, for the dialog's description. */
  lineName: string;
  onClose: () => void;
  /** Called after a save; the caller re-fetches what it shows. */
  onSaved: (result: BudgetAmendmentCreated) => void;
}

export const AmendmentDialog: React.FC<AmendmentDialogProps> = ({ budgetId, lineName, onClose, onSaved }) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [approvedOn, setApprovedOn] = useState(today);
  const { errors, setErrors, clearError } = useFieldErrors<AmendField>();
  const [saving, setSaving] = useState(false);
  const isDirty = amount !== '' || reason !== '' || approvedBy !== '' || approvedOn !== today;
  // Escape, the X and Cancel all ask before throwing away a typed amendment.
  const requestClose = useDiscardGuard({ isDirty, onClose });
  const flag = (next: Partial<Record<AmendField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const validate = (): BudgetAmendmentCreatePayload | null => {
    const next: Partial<Record<AmendField, string>> = {};
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      next.amount = 'Enter an amount greater than zero.';
    } else if (parsed > MAX_MONEY_AMOUNT) {
      next.amount = 'That amount is too large.';
    }
    if (!reason.trim()) next.reason = 'Give a reason for the amendment.';
    else if (reason.trim().length > MAX_REASON) next.reason = `Keep the reason under ${String(MAX_REASON)} characters.`;
    if (!approvedBy.trim()) next.approvedBy = 'Say who approved it, for example "Board vote 10/7".';
    else if (approvedBy.trim().length > MAX_APPROVED_BY) {
      next.approvedBy = `Keep this under ${String(MAX_APPROVED_BY)} characters.`;
    }
    if (!approvedOn) next.approvedOn = 'Enter the date it was approved.';
    else if (approvedOn > today) next.approvedOn = 'The approval date cannot be in the future.';
    if (!flag(next)) return null;
    return {
      amount: parsed.toFixed(2),
      reason: reason.trim(),
      approvedBy: approvedBy.trim(),
      approvedOn,
    };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = validate();
    if (payload === null) return;
    void save(payload);
  };

  const save = async (payload: BudgetAmendmentCreatePayload) => {
    setSaving(true);
    try {
      const result = await budgetService.addAmendment(budgetId, payload);
      toast.success('Amendment recorded — awaiting confirmation by a second officer');
      onSaved(result);
    } catch (err: unknown) {
      // Nothing is recorded until every field is accepted.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      // The API's own words: a locked year, a future date, a line not found.
      toast.error(getErrorMessage(err, 'Could not record the amendment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Add amendment"
      titleId="amendment-form-title"
      aria-describedby="amendment-form-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record amendment
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="amendment-form-description" className="text-theme-text-secondary text-sm">
          Extra money approved for {lineName}. The budget goes up by this amount once a second officer confirms it. An
          amendment is kept as a record and cannot be edited or removed later; a mistaken one is corrected by reversing
          it.
        </p>

        <FormField id={FIELD_IDS.amount} label="Amount added" error={errors.amount}>
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

        <FormField
          id={FIELD_IDS.reason}
          label="Reason"
          error={errors.reason}
          maxLength={MAX_REASON}
          count={reason.length}
        >
          {(field) => (
            <textarea
              {...field}
              rows={3}
              className="form-input"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                clearError('reason');
              }}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.approvedBy}
          label="Approved by"
          error={errors.approvedBy}
          maxLength={MAX_APPROVED_BY}
          count={approvedBy.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              placeholder="e.g. Board vote 10/7"
              className="form-input"
              value={approvedBy}
              onChange={(e) => {
                setApprovedBy(e.target.value);
                clearError('approvedBy');
              }}
            />
          )}
        </FormField>

        <FormField id={FIELD_IDS.approvedOn} label="Approval date" error={errors.approvedOn}>
          {(field) => (
            <input
              {...field}
              type="date"
              max={today}
              className="form-input"
              value={approvedOn}
              onChange={(e) => {
                setApprovedOn(e.target.value);
                clearError('approvedOn');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
