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
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstErrorField, refusalsOnFields, useDialogFieldErrors } from '../utils/fieldRefusals';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '@/utils/currencyFormatting';
import { formatDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { budgetRequestService } from '../services/api';
import type { BudgetRequest, BudgetRequestDecisionKind, BudgetRequestDecisionPayload } from '../types';
import { BUDGET_REQUEST_STATUS_LABELS, MAX_REQUEST_AMOUNT, MAX_REQUEST_TEXT } from '../utils/budgetRequests';

type DecisionField = 'decision' | 'amount' | 'note';

/** `BudgetRequestDecision` (schemas/finance.py). */
const SERVER_FIELDS: Record<DecisionField, ServerFieldSpec> = {
  decision: { label: 'Decision' },
  amount: { label: 'Amount approved', api: ['approved_amount', 'approvedAmount'] },
  note: { label: 'Note', maxLength: MAX_REQUEST_TEXT, api: ['decision_note', 'decisionNote'] },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as DecisionField[];
const FIELD_IDS: Record<DecisionField, string> = {
  decision: 'budget-request-decision-approve',
  amount: 'budget-request-approved-amount',
  note: 'budget-request-note',
};

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
  const [amount, setAmount] = useState(request.requestedAmount ?? '');
  const [note, setNote] = useState('');
  const { errors, setErrors, clearError } = useDialogFieldErrors<DecisionField>();
  const [saving, setSaving] = useState(false);
  const isDirty = decision !== 'approve' || amount !== (request.requestedAmount ?? '') || note !== '';
  // Escape, the X and Cancel all ask before throwing away a typed decision.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const flag = (next: Partial<Record<DecisionField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const validate = (): BudgetRequestDecisionPayload | null => {
    const next: Partial<Record<DecisionField, string>> = {};
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
    if (!flag(next)) return null;
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
      // Nothing is decided until every field is accepted.
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
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
      onClose={requestClose}
      size="lg"
      title={request.lineLabel}
      titleId="budget-request-decision-title"
      aria-describedby="budget-request-decision-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Record decision'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
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
                  onChange={() => {
                    setDecision(d.value);
                    clearError('decision');
                  }}
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
          {errors.decision && <p className="mt-1 text-sm text-red-800 dark:text-red-300">{errors.decision}</p>}
        </fieldset>

        {decision === 'adjust' && (
          <FormField id={FIELD_IDS.amount} label="Amount approved" error={errors.amount}>
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
        )}

        <FormField
          id={FIELD_IDS.note}
          label={decision === 'approve' ? 'Note' : 'Note to the line owner'}
          optional={decision === 'approve'}
          error={errors.note}
          maxLength={MAX_REQUEST_TEXT}
          count={note.length}
        >
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
