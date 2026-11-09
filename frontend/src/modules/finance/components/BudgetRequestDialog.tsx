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

import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { formatCurrency } from '@/utils/currencyFormatting';
import { budgetRequestService } from '../services/api';
import type { BudgetRequest, BudgetRequestProposalOptions, BudgetRequestUpdatePayload } from '../types';
import { MAX_REQUEST_AMOUNT, MAX_REQUEST_TEXT } from '../utils/budgetRequests';
import { firstErrorField, refusalsOnFields, updateExceptRefused, useFieldErrors } from '../utils/fieldRefusals';

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

type RequestField = 'category' | 'station' | 'position' | 'amount' | 'justification';

/** `BudgetRequestCreate` / `BudgetRequestUpdate` (schemas/finance.py). */
const SERVER_FIELDS: Record<RequestField, ServerFieldSpec> = {
  category: { label: 'Category', api: ['category_id', 'categoryId'] },
  station: { label: 'Station', api: ['station_id', 'stationId'] },
  position: { label: 'Position', api: ['owner_position_id', 'ownerPositionId'] },
  amount: { label: 'Amount requested', api: ['requested_amount', 'requestedAmount'] },
  justification: { label: 'Justification', maxLength: MAX_REQUEST_TEXT },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as RequestField[];
const UPDATE_KEYS: Partial<Record<RequestField, readonly (keyof BudgetRequestUpdatePayload)[]>> = {
  amount: ['requestedAmount'],
  justification: ['justification'],
};
const FIELD_IDS: Record<RequestField, string> = {
  category: 'budget-request-category',
  station: 'budget-request-station',
  position: 'budget-request-position',
  amount: 'budget-request-amount',
  justification: 'budget-request-justification',
};

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
  const { errors, setErrors, clearError } = useFieldErrors<RequestField>();
  const [saving, setSaving] = useState(false);
  // An edit that saved all but a refused field stays open on that field;
  // closing then still tells the page to reload.
  const partlySaved = useRef(false);
  const initial = useRef({ amount, justification, categoryId, stationId, positionId });
  const isDirty =
    amount !== initial.current.amount ||
    justification !== initial.current.justification ||
    categoryId !== initial.current.categoryId ||
    stationId !== initial.current.stationId ||
    positionId !== initial.current.positionId;
  const close = () => (partlySaved.current ? onSaved() : onClose());
  // Escape, the X and Cancel all ask before throwing away a changed request.
  const requestClose = useDiscardGuard({ isDirty, onClose: close });

  const flag = (next: Partial<Record<RequestField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const title =
    target.kind === 'proposal'
      ? 'Propose a new line'
      : target.kind === 'edit'
        ? 'Edit budget request'
        : 'Request an amount';
  const lineLabel =
    target.kind === 'line' ? target.lineLabel : target.kind === 'edit' ? target.request.lineLabel : null;

  const validate = (): { amount: string; justification: string } | null => {
    const next: Partial<Record<RequestField, string>> = {};
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
    if (!flag(next)) return null;
    return { amount: parsed.toFixed(2), justification: justification.trim() };
  };

  const save = async (values: { amount: string; justification: string }) => {
    setSaving(true);
    try {
      if (target.kind === 'edit') {
        // Owner rule (2026-11-05) for a single-save edit: a refused value is
        // not written, the rest saves, and the field stays flagged.
        const { refused } = await updateExceptRefused(
          (body: BudgetRequestUpdatePayload) => budgetRequestService.update(target.request.id, body),
          { requestedAmount: values.amount, justification: values.justification },
          SERVER_FIELDS,
          UPDATE_KEYS
        );
        const first = firstErrorField(refused, FIELD_ORDER);
        if (first) {
          partlySaved.current = true;
          flag(refused);
          toast.error(
            `Request saved, except ${SERVER_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
          );
          return;
        }
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
      // A new request is created only once nothing is refused.
      const mapped = target.kind === 'edit' ? null : refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
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
      onClose={requestClose}
      title={title}
      titleId="budget-request-form-title"
      aria-describedby="budget-request-form-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving...' : 'Save draft'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
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
            <FormField id={FIELD_IDS.category} label="Category" error={errors.category}>
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    clearError('category');
                  }}
                >
                  <option value="">Choose a category</option>
                  {options.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id={FIELD_IDS.station} label="Station" optional error={errors.station}>
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={stationId}
                  onChange={(e) => {
                    setStationId(e.target.value);
                    clearError('station');
                  }}
                >
                  <option value="">Department-wide</option>
                  {options.stations.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField
              id={FIELD_IDS.position}
              label="For your position"
              error={errors.position}
              hint="If it is approved, this position owns the new line."
            >
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={positionId}
                  onChange={(e) => {
                    setPositionId(e.target.value);
                    clearError('position');
                  }}
                >
                  <option value="">Choose a position</option>
                  {options.positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </>
        )}

        <FormField id={FIELD_IDS.amount} label="Amount requested" error={errors.amount}>
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

        <FormField
          id={FIELD_IDS.justification}
          label="Justification"
          error={errors.justification}
          maxLength={MAX_REQUEST_TEXT}
          count={justification.length}
        >
          {(field) => (
            <textarea
              {...field}
              rows={4}
              className="form-input"
              value={justification}
              onChange={(e) => {
                setJustification(e.target.value);
                clearError('justification');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
