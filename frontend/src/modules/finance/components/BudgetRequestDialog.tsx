/**
 * Make or change a budget request for next year — the line owner's dialog.
 *
 * Three uses: a request for one of the member's draft-year lines, an edit of a
 * draft or submitted request, and a proposal for a line that does not exist
 * yet (category, optional station, and one of the positions the member holds).
 * The backend decides who may do which and refuses the rest; its message is
 * what the toast shows. The checks here only spare a round trip.
 *
 * Create payloads leave a blank station out (`|| undefined`); an edit sends
 * both fields the form owns (CLAUDE.md pitfall #1) — neither may be blank, so
 * there is nothing to clear.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '@/utils/currencyFormatting';
import { budgetRequestService } from '../services/api';
import type { BudgetRequest, BudgetRequestProposalOptions } from '../types';
import { MAX_REQUEST_AMOUNT, MAX_REQUEST_TEXT } from '../utils/budgetRequests';

export type BudgetRequestDialogTarget =
  | { kind: 'line'; budgetId: string; lineLabel: string; lastYearBudgeted?: string | null | undefined }
  | { kind: 'edit'; request: BudgetRequest }
  | { kind: 'proposal'; options: BudgetRequestProposalOptions };

interface BudgetRequestDialogProps {
  fiscalYearId: string;
  fiscalYearName: string;
  target: BudgetRequestDialogTarget;
  onClose: () => void;
  /** Called after a save; the caller re-fetches what it shows (pitfall #11). */
  onSaved: () => void;
}

const fieldError = (id: string, message: string | undefined) =>
  message ? (
    <p id={id} className="mt-1 text-xs text-red-700 dark:text-red-400">
      {message}
    </p>
  ) : null;

export const BudgetRequestDialog: React.FC<BudgetRequestDialogProps> = ({
  fiscalYearId,
  fiscalYearName,
  target,
  onClose,
  onSaved,
}) => {
  const existing = target.kind === 'edit' ? target.request : null;
  const options = target.kind === 'proposal' ? target.options : null;
  const [amount, setAmount] = useState(existing ? String(existing.requestedAmount) : '');
  const [justification, setJustification] = useState(existing?.justification ?? '');
  const [categoryId, setCategoryId] = useState('');
  const [stationId, setStationId] = useState('');
  const [positionId, setPositionId] = useState(options?.positions.length === 1 ? (options.positions[0]?.id ?? '') : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const title =
    target.kind === 'proposal'
      ? 'Propose a new line'
      : target.kind === 'edit'
        ? 'Edit budget request'
        : 'Request an amount';
  const lineLabel =
    target.kind === 'line' ? target.lineLabel : target.kind === 'edit' ? target.request.lineLabel : null;

  const validate = (): { amount: string; justification: string } | null => {
    const next: Record<string, string> = {};
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      next.amount = 'Enter an amount of zero or more.';
    } else if (parsed > MAX_REQUEST_AMOUNT) {
      next.amount = 'That amount is too large.';
    }
    if (!justification.trim()) next.justification = 'Say what the money is for.';
    else if (justification.trim().length > MAX_REQUEST_TEXT) {
      next.justification = `Keep this under ${String(MAX_REQUEST_TEXT)} characters.`;
    }
    if (target.kind === 'proposal') {
      if (!categoryId) next.category = 'Choose the category of the new line.';
      if (!positionId) next.position = 'Choose the position the line is for.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return { amount: parsed.toFixed(2), justification: justification.trim() };
  };

  const save = async (values: { amount: string; justification: string }) => {
    setSaving(true);
    try {
      if (target.kind === 'edit') {
        await budgetRequestService.update(target.request.id, {
          requestedAmount: values.amount,
          justification: values.justification,
        });
        toast.success('Request saved');
      } else if (target.kind === 'line') {
        await budgetRequestService.create({
          fiscalYearId,
          budgetId: target.budgetId,
          requestedAmount: values.amount,
          justification: values.justification,
        });
        toast.success('Draft request saved. Submit it when it is ready.');
      } else {
        await budgetRequestService.create({
          fiscalYearId,
          categoryId: categoryId || undefined,
          stationId: stationId || undefined,
          ownerPositionId: positionId || undefined,
          requestedAmount: values.amount,
          justification: values.justification,
        });
        toast.success('Draft proposal saved. Submit it when it is ready.');
      }
      onSaved();
    } catch (err: unknown) {
      // The API's own words: the deadline passed, a line already has one, …
      toast.error(getErrorMessage(err, 'Could not save the request'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const values = validate();
    if (values === null) return;
    void save(values);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={title}
      titleId="budget-request-form-title"
      aria-describedby="budget-request-form-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save draft'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="budget-request-form-description" className="text-theme-text-secondary text-sm">
          {lineLabel
            ? `What ${lineLabel} needs in ${fiscalYearName}. `
            : `A budget line that does not exist yet in ${fiscalYearName}. `}
          It is saved as a draft; the Treasurer sees it once you submit it.
          {target.kind === 'line' && target.lastYearBudgeted != null
            ? ` This year's budget is ${formatCurrency(target.lastYearBudgeted)}.`
            : ''}
        </p>

        {options && (
          <>
            <div>
              <label htmlFor="budget-request-category" className="form-label">
                Category
              </label>
              <select
                id="budget-request-category"
                className="form-input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-invalid={Boolean(errors.category)}
                aria-describedby={errors.category ? 'budget-request-category-error' : undefined}
              >
                <option value="">Choose a category</option>
                {options.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {fieldError('budget-request-category-error', errors.category)}
            </div>
            <div>
              <label htmlFor="budget-request-station" className="form-label">
                Station (optional)
              </label>
              <select
                id="budget-request-station"
                className="form-input"
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
              >
                <option value="">Department-wide</option>
                {options.stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="budget-request-position" className="form-label">
                For your position
              </label>
              <select
                id="budget-request-position"
                className="form-input"
                value={positionId}
                onChange={(e) => setPositionId(e.target.value)}
                aria-invalid={Boolean(errors.position)}
                aria-describedby={errors.position ? 'budget-request-position-error' : 'budget-request-position-hint'}
              >
                <option value="">Choose a position</option>
                {options.positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p id="budget-request-position-hint" className="text-theme-text-secondary mt-1 text-xs">
                If it is approved, this position owns the new line.
              </p>
              {fieldError('budget-request-position-error', errors.position)}
            </div>
          </>
        )}

        <div>
          <label htmlFor="budget-request-amount" className="form-label">
            Amount requested
          </label>
          <input
            id="budget-request-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={errors.amount ? 'budget-request-amount-error' : undefined}
          />
          {fieldError('budget-request-amount-error', errors.amount)}
        </div>

        <div>
          <label htmlFor="budget-request-justification" className="form-label">
            Justification
          </label>
          <textarea
            id="budget-request-justification"
            rows={4}
            className="form-input"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            aria-invalid={Boolean(errors.justification)}
            aria-describedby={errors.justification ? 'budget-request-justification-error' : undefined}
          />
          {fieldError('budget-request-justification-error', errors.justification)}
        </div>
      </div>
    </Modal>
  );
};
