/**
 * Reverse a mistaken budget amendment.
 *
 * An amendment is never edited or deleted (owner decision, 2026-10-09): the
 * correction is a reversing entry for the whole amount, with its own reason
 * and approval. Saving lowers the line's budget by the amendment's amount and
 * leaves the original amendment on record, so the dialog says both before the
 * Treasurer confirms.
 *
 * The checks here only spare a round trip; the backend makes the same ones
 * (the approval date against the department's calendar, a locked year, what
 * is already spent) and its message is what the toast shows when it refuses.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatDate, getTodayLocalDate } from '../../../utils/dateFormatting';
import { formatCurrency } from '../../../utils/currencyFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { budgetService } from '../services/api';
import type { BudgetAmendment, BudgetAmendmentCreated, BudgetAmendmentReversePayload } from '../types';

const MAX_REASON = 2000;
const MAX_APPROVED_BY = 200;

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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const amount = formatCurrency(amendment.amount);

  const validate = (): BudgetAmendmentReversePayload | null => {
    const next: Record<string, string> = {};
    if (!reason.trim()) next.reason = 'Give a reason for the reversal.';
    else if (reason.trim().length > MAX_REASON) next.reason = `Keep the reason under ${String(MAX_REASON)} characters.`;
    if (!approvedBy.trim()) next.approvedBy = 'Say who approved the reversal.';
    else if (approvedBy.trim().length > MAX_APPROVED_BY) {
      next.approvedBy = `Keep this under ${String(MAX_APPROVED_BY)} characters.`;
    }
    if (!approvedOn) next.approvedOn = 'Enter the date it was approved.';
    else if (approvedOn > today) next.approvedOn = 'The approval date cannot be in the future.';
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return { reason: reason.trim(), approvedBy: approvedBy.trim(), approvedOn };
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
      toast.success('Amendment reversed');
      onSaved(result);
    } catch (err: unknown) {
      // The API's own words: already reversed, a locked year, money spent.
      toast.error(getErrorMessage(err, 'Could not reverse the amendment'));
    } finally {
      setSaving(false);
    }
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`reversal-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Reverse amendment"
      titleId="reversal-form-title"
      aria-describedby="reversal-form-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            Record reversal
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
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
            This lowers the current budget by {amount}. The original amendment stays on record.
          </p>
          <p>A reversal cannot be undone. If the money is needed again, record a new amendment.</p>
        </div>

        <div>
          <label htmlFor="reversal-reason" className="form-label">
            Reason
          </label>
          <textarea
            id="reversal-reason"
            rows={3}
            maxLength={MAX_REASON}
            placeholder="e.g. Entered $2,500 instead of $250"
            className="form-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={Boolean(errors.reason)}
            aria-describedby={errors.reason ? 'reversal-reason-error' : undefined}
          />
          {errorText('reason')}
        </div>

        <div>
          <label htmlFor="reversal-approved-by" className="form-label">
            Approved by
          </label>
          <input
            id="reversal-approved-by"
            type="text"
            maxLength={MAX_APPROVED_BY}
            className="form-input"
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            aria-invalid={Boolean(errors.approvedBy)}
            aria-describedby={errors.approvedBy ? 'reversal-approvedBy-error' : undefined}
          />
          {errorText('approvedBy')}
        </div>

        <div>
          <label htmlFor="reversal-approved-on" className="form-label">
            Approval date
          </label>
          <input
            id="reversal-approved-on"
            type="date"
            className="form-input"
            value={approvedOn}
            onChange={(e) => setApprovedOn(e.target.value)}
            aria-invalid={Boolean(errors.approvedOn)}
            aria-describedby={errors.approvedOn ? 'reversal-approvedOn-error' : undefined}
          />
          {errorText('approvedOn')}
        </div>
      </div>
    </Modal>
  );
};
