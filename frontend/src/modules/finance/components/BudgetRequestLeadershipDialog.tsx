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
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstErrorField, refusalsOnFields, useDialogFieldErrors } from '../utils/fieldRefusals';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '@/utils/currencyFormatting';
import { budgetRequestService } from '../services/api';
import type { BudgetRequest, BudgetRequestReviewPayload } from '../types';
import { MAX_REQUEST_AMOUNT, MAX_REQUEST_TEXT } from '../utils/budgetRequests';

type ReviewField = 'amount' | 'note';

/** `BudgetRequestReview` (schemas/finance.py). */
const SERVER_FIELDS: Record<ReviewField, ServerFieldSpec> = {
  amount: { label: 'Amount for this line' },
  note: { label: 'Why', maxLength: MAX_REQUEST_TEXT },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as ReviewField[];
const FIELD_IDS: Record<ReviewField, string> = {
  amount: 'budget-request-review-amount',
  note: 'budget-request-review-note',
};

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
  const { errors, setErrors, clearError } = useDialogFieldErrors<ReviewField>();
  const [saving, setSaving] = useState(false);
  const isDirty = amount !== String(current) || note !== (request.reviewNote ?? '');
  // Escape, the X and Cancel all ask before throwing away a typed change.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const flag = (next: Partial<Record<ReviewField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const validate = (): BudgetRequestReviewPayload | null => {
    const next: Partial<Record<ReviewField, string>> = {};
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
    if (!flag(next)) return null;
    return { amount: parsed.toFixed(2), note: note.trim() };
  };

  const save = async (payload: BudgetRequestReviewPayload) => {
    setSaving(true);
    try {
      await budgetRequestService.review(request.id, payload);
      toast.success('Leadership change recorded');
      onReviewed();
    } catch (err: unknown) {
      // Nothing is recorded until every field is accepted.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
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
      onClose={requestClose}
      size="lg"
      title={request.lineLabel}
      titleId="budget-request-leadership-title"
      aria-describedby="budget-request-leadership-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Record change'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
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

        <FormField id={FIELD_IDS.amount} label="Amount for this line" error={errors.amount}>
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="decimal"
              min="0"
              max={MAX_REQUEST_AMOUNT}
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

        <FormField id={FIELD_IDS.note} label="Why" error={errors.note} maxLength={MAX_REQUEST_TEXT} count={note.length}>
          {(field) => (
            <textarea
              {...field}
              rows={3}
              className="form-input"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                clearError('note');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
