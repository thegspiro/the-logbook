/**
 * Reverse a mistaken budget amendment.
 *
 * An amendment is never edited or deleted (owner decision, 2026-10-09): the
 * correction is a reversing entry with its own reason and approval. It takes
 * back the whole amendment by default, or any part of it (owner decision,
 * 2026-11-01), so $2,500 entered for $250 is corrected by one reversal of
 * $2,250. Saving enters the reversal pending; once a second officer confirms
 * it, it lowers the line's budget by that much. The original amendment stays
 * on record, so the dialog says all of that before the Treasurer saves.
 *
 * The whole amount is sent as no amount at all, which the backend reads as
 * "the whole amendment" from the row itself.
 *
 * The checks here only spare a round trip; the backend makes the same ones
 * (the approval date against the department's calendar, a locked year, what
 * is already spent) and its message is what the toast shows when it refuses.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstErrorField, refusalsOnFields, useDialogFieldErrors } from '../utils/fieldRefusals';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatDate, getTodayLocalDate } from '../../../utils/dateFormatting';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { budgetService } from '../services/api';
import type { BudgetAmendment, BudgetAmendmentCreated, BudgetAmendmentReversePayload } from '../types';

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
  amount: 'reversal-amount',
  reason: 'reversal-reason',
  approvedBy: 'reversal-approved-by',
  approvedOn: 'reversal-approved-on',
};
const MONEY = /^\d+(\.\d{1,2})?$/;

/** A dollars-and-cents string as whole cents, so comparisons are exact. */
const toCents = (value: string): number => {
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};

interface ReverseAmendmentDialogProps {
  budgetId: string;
  /** The amendment being reversed. */
  amendment: BudgetAmendment;
  onClose: () => void;
  /** Called after a save; the caller re-fetches what it shows. */
  onSaved: (result: BudgetAmendmentCreated) => void;
}

export const ReverseAmendmentDialog: React.FC<ReverseAmendmentDialogProps> = ({
  budgetId,
  amendment,
  onClose,
  onSaved,
}) => {
  const tz = useTimezone();
  const today = getTodayLocalDate(tz);
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [approvedOn, setApprovedOn] = useState(today);
  const { errors, setErrors, clearError } = useDialogFieldErrors<AmendField>();
  const [saving, setSaving] = useState(false);
  const wholeAmount = Number(amendment.amount).toFixed(2);
  const [amountText, setAmountText] = useState(wholeAmount);
  const amount = formatCurrency(amendment.amount);
  const typed = amountText.trim();
  const wholeCents = toCents(wholeAmount);
  const typedCents = MONEY.test(typed) ? toCents(typed) : null;
  // What the summary describes: the typed amount once it is a sensible one.
  const takesBack = typedCents !== null && typedCents > 0 && typedCents <= wholeCents ? typedCents : wholeCents;
  const remainder = wholeCents - takesBack;
  const isDirty = amountText !== wholeAmount || reason !== '' || approvedBy !== '' || approvedOn !== today;
  // Escape, the X and Cancel all ask before throwing away a typed reversal.
  const requestClose = useDiscardGuard({ isDirty, onClose });
  const flag = (next: Partial<Record<AmendField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const validate = (): BudgetAmendmentReversePayload | null => {
    const next: Partial<Record<AmendField, string>> = {};
    if (!reason.trim()) next.reason = 'Give a reason for the reversal.';
    else if (reason.trim().length > MAX_REASON) next.reason = `Keep the reason under ${String(MAX_REASON)} characters.`;
    if (!approvedBy.trim()) next.approvedBy = 'Say who approved the reversal.';
    else if (approvedBy.trim().length > MAX_APPROVED_BY) {
      next.approvedBy = `Keep this under ${String(MAX_APPROVED_BY)} characters.`;
    }
    if (!approvedOn) next.approvedOn = 'Enter the date it was approved.';
    else if (approvedOn > today) next.approvedOn = 'The approval date cannot be in the future.';
    if (typed !== '' && !MONEY.test(typed)) {
      next.amount = Number.isFinite(Number(typed))
        ? 'Use dollars and cents, at most two decimal places.'
        : 'Enter an amount greater than zero.';
    } else if (typedCents === null || typedCents <= 0) next.amount = 'Enter an amount greater than zero.';
    else if (typedCents > wholeCents) next.amount = `A reversal can take back at most ${amount}.`;
    if (!flag(next) || typedCents === null) return null;
    const payload: BudgetAmendmentReversePayload = { reason: reason.trim(), approvedBy: approvedBy.trim(), approvedOn };
    // The whole amendment is left to the backend, which reads it off the row.
    if (typedCents !== wholeCents) payload.amount = (typedCents / 100).toFixed(2);
    return payload;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = validate();
    if (payload === null) return;
    void save(payload);
  };

  const save = async (payload: BudgetAmendmentReversePayload) => {
    setSaving(true);
    try {
      const result = await budgetService.reverseAmendment(budgetId, amendment.id, payload);
      toast.success('Reversal recorded — awaiting confirmation by a second officer');
      onSaved(result);
    } catch (err: unknown) {
      // Nothing is recorded until every field is accepted.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      // The API's own words: already reversed, a locked year, money spent.
      toast.error(getErrorMessage(err, 'Could not reverse the amendment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Reverse amendment"
      titleId="reversal-form-title"
      aria-describedby="reversal-form-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record reversal
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div id="reversal-form-description" className="text-theme-text-secondary space-y-2 text-sm">
          <p>
            Reversing the +{amount} amendment approved {formatDate(amendment.approvedOn, tz)} by {amendment.approvedBy}.
          </p>
          <p className="text-theme-text-primary font-medium">
            {remainder > 0
              ? `Once a second officer confirms it, this lowers the current budget by ${formatCurrency(takesBack / 100)}. ${formatCurrency(remainder / 100)} of the amendment stays, and the original amendment stays on record.`
              : `Once a second officer confirms it, this lowers the current budget by ${amount}. The original amendment stays on record.`}
          </p>
          <p>A reversal cannot be undone. If the money is needed again, record a new amendment.</p>
        </div>

        <FormField
          id={FIELD_IDS.amount}
          label="Amount to reverse"
          error={errors.amount}
          hint="The whole amendment, or the part entered by mistake."
        >
          {(field) => (
            <input
              {...field}
              type="text"
              inputMode="decimal"
              className="form-input"
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value);
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
              placeholder="e.g. Entered $2,500 instead of $250"
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
