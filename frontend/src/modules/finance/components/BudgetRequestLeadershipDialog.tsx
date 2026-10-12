/**
 * Senior leadership's change to a request the Treasurer decided, during
 * leadership review (`finance.budget_review`).
 *
 * The amount and a note saying why are required. The change is kept beside
 * the Treasurer's decision rather than over it, and it is what the draft line
 * holds afterwards. The rules — the year in leadership review, a request the
 * Treasurer approved or adjusted, not the reviewer's own line, not below what
 * the line has already spent — are the API's; a refusal is shown in its own
 * words. The caller re-fetches on success (CLAUDE.md pitfall #11).
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '@/utils/currencyFormatting';
import { budgetRequestService } from '../services/api';
import type { BudgetRequest, BudgetRequestReviewPayload } from '../types';
import { MAX_REQUEST_AMOUNT, MAX_REQUEST_TEXT } from '../utils/budgetRequests';

interface BudgetRequestLeadershipDialogProps {
  request: BudgetRequest;
  onClose: () => void;
  onReviewed: () => void;
}

export const BudgetRequestLeadershipDialog: React.FC<BudgetRequestLeadershipDialogProps> = ({
  request,
  onClose,
  onReviewed,
}) => {
  const current = request.reviewAmount ?? request.approvedAmount ?? request.requestedAmount;
  const [amount, setAmount] = useState(String(current));
  const [note, setNote] = useState(request.reviewNote ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): BudgetRequestReviewPayload | null => {
    const next: Record<string, string> = {};
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      next.amount = 'Enter the amount for this line.';
    } else if (parsed > MAX_REQUEST_AMOUNT) {
      next.amount = 'That amount is too large.';
    }
    if (!note.trim()) next.note = 'Say why the amount was changed.';
    else if (note.trim().length > MAX_REQUEST_TEXT) {
      next.note = `Keep the note under ${String(MAX_REQUEST_TEXT)} characters.`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return { amount: parsed.toFixed(2), note: note.trim() };
  };

  const save = async (payload: BudgetRequestReviewPayload) => {
    setSaving(true);
    try {
      await budgetRequestService.review(request.id, payload);
      toast.success('Leadership change recorded');
      onReviewed();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record the change'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = validate();
    if (payload === null) return;
    void save(payload);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={request.lineLabel}
      titleId="budget-request-leadership-title"
      aria-describedby="budget-request-leadership-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Record change'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div id="budget-request-leadership-description" className="text-theme-text-secondary space-y-1 text-sm">
          <p>
            Requested <strong className="text-theme-text-primary">{formatCurrency(request.requestedAmount)}</strong>
            {request.ownerPositionName ? ` for ${request.ownerPositionName}` : ''}. The Treasurer approved{' '}
            <strong className="text-theme-text-primary">{formatCurrency(request.approvedAmount ?? null)}</strong>
            {request.decidedByName ? ` (${request.decidedByName})` : ''}.
          </p>
          {request.decisionNote && <p>Treasurer&apos;s note: {request.decisionNote}</p>}
          {request.reviewAmount != null && (
            <p>
              Leadership already set {formatCurrency(request.reviewAmount)}
              {request.reviewedByName ? ` (${request.reviewedByName})` : ''}. A new change replaces it.
            </p>
          )}
          <p>The amount you enter becomes the line&apos;s budget. The Treasurer&apos;s decision stays on record.</p>
        </div>

        <div>
          <h3 className="form-label">Justification</h3>
          <p className="text-theme-text-primary bg-theme-surface-secondary rounded-lg p-3 text-sm break-words whitespace-pre-line">
            {request.justification}
          </p>
        </div>

        <div>
          <label htmlFor="budget-request-review-amount" className="form-label">
            Amount for this line
          </label>
          <input
            id="budget-request-review-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={errors.amount ? 'budget-request-review-amount-error' : undefined}
          />
          {errors.amount && (
            <p id="budget-request-review-amount-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {errors.amount}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="budget-request-review-note" className="form-label">
            Why
          </label>
          <textarea
            id="budget-request-review-note"
            rows={3}
            maxLength={MAX_REQUEST_TEXT}
            className="form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={Boolean(errors.note)}
            aria-describedby={errors.note ? 'budget-request-review-note-error' : undefined}
          />
          {errors.note && (
            <p id="budget-request-review-note-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {errors.note}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
