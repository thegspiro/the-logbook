/**
 * The Treasurer's decision on one budget request: approve it as asked, adjust
 * it (an amount and a note), or decline it (a note).
 *
 * The note rules are the API's (`BudgetRequestDecision`); they are checked here
 * only to spare a round trip, and a refusal — an amount below what the line has
 * already spent, a year that is no longer a draft — is shown in the API's own
 * words. Approve sends no amount or note; the caller re-fetches on success
 * (CLAUDE.md pitfall #11).
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { budgetRequestService } from '../services/api';
import type { BudgetRequest, BudgetRequestDecisionKind, BudgetRequestDecisionPayload } from '../types';
import { BUDGET_REQUEST_STATUS_LABELS, MAX_REQUEST_AMOUNT, MAX_REQUEST_TEXT } from '../utils/budgetRequests';

interface BudgetRequestDecisionDialogProps {
  request: BudgetRequest;
  onClose: () => void;
  onDecided: () => void;
}

const DECISIONS: { value: BudgetRequestDecisionKind; label: string; hint: string }[] = [
  { value: 'approve', label: 'Approve as requested', hint: 'The requested amount becomes the line’s budget.' },
  { value: 'adjust', label: 'Approve a different amount', hint: 'Enter the amount and say why.' },
  { value: 'decline', label: 'Decline', hint: 'Say why. The line’s amount is not changed.' },
];

export const BudgetRequestDecisionDialog: React.FC<BudgetRequestDecisionDialogProps> = ({
  request,
  onClose,
  onDecided,
}) => {
  const tz = useTimezone();
  const [decision, setDecision] = useState<BudgetRequestDecisionKind>('approve');
  const [amount, setAmount] = useState(String(request.requestedAmount));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): BudgetRequestDecisionPayload | null => {
    const next: Record<string, string> = {};
    if (decision === 'adjust') {
      const parsed = Number(amount);
      if (amount.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
        next.amount = 'Enter the amount approved.';
      } else if (parsed > MAX_REQUEST_AMOUNT) {
        next.amount = 'That amount is too large.';
      }
    }
    if (decision !== 'approve' && !note.trim()) {
      next.note = decision === 'adjust' ? 'Say why the amount was adjusted.' : 'Say why the request was declined.';
    } else if (note.trim().length > MAX_REQUEST_TEXT) {
      next.note = `Keep the note under ${String(MAX_REQUEST_TEXT)} characters.`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    if (decision === 'approve') return { decision, decisionNote: note.trim() || undefined };
    if (decision === 'adjust') {
      return { decision, approvedAmount: Number(amount).toFixed(2), decisionNote: note.trim() };
    }
    return { decision, decisionNote: note.trim() };
  };

  const save = async (payload: BudgetRequestDecisionPayload) => {
    setSaving(true);
    try {
      await budgetRequestService.decide(request.id, payload);
      toast.success(
        payload.decision === 'approve'
          ? 'Request approved'
          : payload.decision === 'adjust'
            ? 'Request approved at the adjusted amount'
            : 'Request declined'
      );
      onDecided();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record the decision'));
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

  const decided = request.status !== 'submitted';

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={request.lineLabel}
      titleId="budget-request-decision-title"
      aria-describedby="budget-request-decision-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Record decision'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div id="budget-request-decision-description" className="text-theme-text-secondary space-y-1 text-sm">
          <p>
            {request.submittedByName ? `${request.submittedByName} asked for ` : 'Requested: '}
            <strong className="text-theme-text-primary">{formatCurrency(request.requestedAmount)}</strong>
            {request.submittedAt ? ` on ${formatDate(request.submittedAt, tz)}` : ''}
            {request.ownerPositionName ? `, for ${request.ownerPositionName}` : ''}.
          </p>
          <p>
            {request.lastYearBudgeted != null
              ? `${request.lastYearFiscalYearName ?? 'This year'}: ${formatCurrency(request.lastYearBudgeted)} budgeted, ${formatCurrency(request.lastYearSpent ?? '0')} spent.`
              : 'There is no line for this in the current year.'}
            {request.isProposedLine ? ' This is a new line; approving it creates the line.' : ''}
          </p>
          {decided && (
            <p>
              Already {BUDGET_REQUEST_STATUS_LABELS[request.status].toLowerCase()}
              {request.decidedByName ? ` by ${request.decidedByName}` : ''}. A new decision replaces it.
            </p>
          )}
        </div>

        <div>
          <h3 className="form-label">Justification</h3>
          <p className="text-theme-text-primary bg-theme-surface-secondary rounded-lg p-3 text-sm break-words whitespace-pre-line">
            {request.justification}
          </p>
        </div>

        <fieldset>
          <legend className="form-label">Decision</legend>
          <div className="space-y-2">
            {DECISIONS.map((d) => (
              <div key={d.value} className="flex items-start gap-2 text-sm">
                <input
                  id={`budget-request-decision-${d.value}`}
                  type="radio"
                  name="budget-request-decision"
                  value={d.value}
                  checked={decision === d.value}
                  onChange={() => setDecision(d.value)}
                  aria-describedby={`budget-request-decision-${d.value}-hint`}
                  className="mt-1"
                />
                <div>
                  <label htmlFor={`budget-request-decision-${d.value}`} className="text-theme-text-primary font-medium">
                    {d.label}
                  </label>
                  <p id={`budget-request-decision-${d.value}-hint`} className="text-theme-text-secondary text-xs">
                    {d.hint}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {decision === 'adjust' && (
          <div>
            <label htmlFor="budget-request-approved-amount" className="form-label">
              Amount approved
            </label>
            <input
              id="budget-request-approved-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="form-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? 'budget-request-approved-amount-error' : undefined}
            />
            {errors.amount && (
              <p id="budget-request-approved-amount-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
                {errors.amount}
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor="budget-request-note" className="form-label">
            {decision === 'approve' ? 'Note (optional)' : 'Note to the line owner'}
          </label>
          <textarea
            id="budget-request-note"
            rows={3}
            className="form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={Boolean(errors.note)}
            aria-describedby={errors.note ? 'budget-request-note-error' : undefined}
          />
          {errors.note && (
            <p id="budget-request-note-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {errors.note}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
