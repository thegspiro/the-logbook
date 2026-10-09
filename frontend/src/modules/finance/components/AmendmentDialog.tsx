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
import { getErrorMessage } from '../../../utils/errorHandling';
import { getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { budgetService } from '../services/api';
import type { BudgetAmendmentCreatePayload, BudgetAmendmentCreated } from '../types';

/** The largest amount the backend's Numeric(12, 2) column holds. */
const MAX_AMOUNT = 9_999_999_999.99;
const MAX_REASON = 2000;
const MAX_APPROVED_BY = 200;

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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): BudgetAmendmentCreatePayload | null => {
    const next: Record<string, string> = {};
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      next.amount = 'Enter an amount greater than zero.';
    } else if (parsed > MAX_AMOUNT) {
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
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
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
      // The API's own words: a locked year, a future date, a line not found.
      toast.error(getErrorMessage(err, 'Could not record the amendment'));
    } finally {
      setSaving(false);
    }
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`amendment-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Add amendment"
      titleId="amendment-form-title"
      aria-describedby="amendment-form-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record amendment
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
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

        <div>
          <label htmlFor="amendment-amount" className="form-label">
            Amount added
          </label>
          <input
            id="amendment-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={errors.amount ? 'amendment-amount-error' : undefined}
          />
          {errorText('amount')}
        </div>

        <div>
          <label htmlFor="amendment-reason" className="form-label">
            Reason
          </label>
          <textarea
            id="amendment-reason"
            rows={3}
            maxLength={MAX_REASON}
            className="form-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={errors.reason ? 'amendment-reason-error' : undefined}
          />
          {errorText('reason')}
        </div>

        <div>
          <label htmlFor="amendment-approved-by" className="form-label">
            Approved by
          </label>
          <input
            id="amendment-approved-by"
            type="text"
            maxLength={MAX_APPROVED_BY}
            placeholder="e.g. Board vote 10/7"
            className="form-input"
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            aria-invalid={Boolean(errors.approvedBy)}
            aria-describedby={errors.approvedBy ? 'amendment-approvedBy-error' : undefined}
          />
          {errorText('approvedBy')}
        </div>

        <div>
          <label htmlFor="amendment-approved-on" className="form-label">
            Approval date
          </label>
          <input
            id="amendment-approved-on"
            type="date"
            className="form-input"
            value={approvedOn}
            onChange={(e) => setApprovedOn(e.target.value)}
            aria-invalid={Boolean(errors.approvedOn)}
            aria-describedby={errors.approvedOn ? 'amendment-approvedOn-error' : undefined}
          />
          {errorText('approvedOn')}
        </div>
      </div>
    </Modal>
  );
};
