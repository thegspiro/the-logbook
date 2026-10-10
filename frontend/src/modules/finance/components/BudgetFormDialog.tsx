/**
 * Create or edit a budget line — the Treasurer's screen (`finance.manage`).
 *
 * A line is owned by a position. Left empty, it inherits its category's owner,
 * and the form says which; that rule is the backend's
 * (`finance_budget_ownership.py`), and the form only reports the category's
 * owner it was given rather than deciding anything (CLAUDE.md pitfall #29).
 *
 * Fiscal year and category are chosen when the line is created: the update
 * endpoint does not move a line, so on edit they are shown, not offered.
 */

import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { blankToNull } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';
import { budgetService } from '../services/api';
import { useBudgetFormOptions, withCurrent } from '../hooks/useBudgetFormOptions';
import { inheritedOwnerHint } from '../utils/budgetOwnership';
import type { Budget, BudgetCategory, BudgetCreatePayload, BudgetUpdatePayload, FiscalYear } from '../types';

interface BudgetFormDialogProps {
  onClose: () => void;
  /** Called with the saved line; the caller re-fetches what it shows. */
  onSaved: (budget: Budget) => void;
  fiscalYears: FiscalYear[];
  categories: BudgetCategory[];
  /** The line being edited; absent for a new one. */
  budget?: Budget | undefined;
  /** Preselected year for a new line. */
  defaultFiscalYearId?: string | undefined;
}

export const BudgetFormDialog: React.FC<BudgetFormDialogProps> = ({
  onClose,
  onSaved,
  fiscalYears,
  categories,
  budget,
  defaultFiscalYearId,
}) => {
  const isEdit = Boolean(budget);
  const { positions, stations } = useBudgetFormOptions(true);

  // Draft and Active years take new lines; a closed year is settled history.
  const openYears = useMemo(() => fiscalYears.filter((fy) => fy.status !== 'closed'), [fiscalYears]);
  const initialYear =
    budget?.fiscalYearId ??
    (openYears.some((fy) => fy.id === defaultFiscalYearId) ? defaultFiscalYearId : undefined) ??
    openYears.find((fy) => fy.status === 'active')?.id ??
    openYears[0]?.id ??
    '';

  const [fiscalYearId, setFiscalYearId] = useState(initialYear);
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? '');
  const [stationId, setStationId] = useState(budget?.stationId ?? '');
  const [amount, setAmount] = useState(budget ? String(Number(budget.amountBudgeted)) : '');
  const [ownerPositionId, setOwnerPositionId] = useState(budget?.ownerPositionId ?? '');
  const [notes, setNotes] = useState(budget?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const categoryOptions = useMemo(
    () => categories.filter((c) => c.isActive || c.id === budget?.categoryId),
    [categories, budget?.categoryId]
  );
  const stationOptions = withCurrent(stations, budget?.stationId, budget?.stationName);
  const positionOptions = withCurrent(positions, budget?.ownerPositionId, budget?.ownerPositionName);
  const selectedCategory = categories.find((c) => c.id === categoryId);
  const yearName = fiscalYears.find((fy) => fy.id === fiscalYearId)?.name ?? 'Unknown';
  // A locked year's amounts are final; the backend refuses a change, so the
  // form neither offers one nor sends the amount (omitted = left alone).
  const amountLocked = isEdit && fiscalYears.some((fy) => fy.id === budget?.fiscalYearId && fy.isLocked);
  // From board review on, the amount moves only through a confirmed amendment.
  // The backend decides that and reports it per line (`amountEditable`).
  const amountByAmendment = isEdit && !amountLocked && budget?.amountEditable === false;
  const amountFixed = amountLocked || amountByAmendment;

  const validate = (): string | null => {
    const next: Record<string, string> = {};
    if (!isEdit && !fiscalYearId) next.fiscalYearId = 'Choose a fiscal year.';
    if (!isEdit && !categoryId) next.categoryId = 'Choose a category.';
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      next.amount = 'Enter an amount of zero or more.';
    }
    setErrors(next);
    return Object.keys(next).length === 0 ? parsed.toFixed(2) : null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountBudgeted = validate();
    if (amountBudgeted === null) return;
    void save(amountBudgeted);
  };

  const save = async (amountBudgeted: string) => {
    setSaving(true);
    try {
      let saved: Budget;
      if (budget) {
        // Every field the form owns, blanks as null, so a cleared owner or
        // station is cleared rather than left behind (CLAUDE.md pitfall #1).
        const payload: BudgetUpdatePayload = {
          ...(amountFixed ? {} : { amountBudgeted }),
          notes: blankToNull(notes),
          stationId: blankToNull(stationId),
          ownerPositionId: blankToNull(ownerPositionId),
        };
        saved = await budgetService.update(budget.id, payload);
        toast.success('Budget line saved');
      } else {
        const payload: BudgetCreatePayload = {
          fiscalYearId,
          categoryId,
          amountBudgeted,
          notes: notes.trim() || undefined,
          stationId: stationId || undefined,
          ownerPositionId: ownerPositionId || undefined,
        };
        saved = await budgetService.create(payload);
        toast.success('Budget line added');
      }
      onSaved(saved);
    } catch (err: unknown) {
      // The API's own words: a closed year, a station or position that is
      // not the department's, or an amount below what is already committed.
      toast.error(getErrorMessage(err, isEdit ? 'Could not save the budget line' : 'Could not add the budget line'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit budget line' : 'Add budget line'}
      titleId="budget-form-title"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save budget line' : 'Add budget line'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {isEdit ? (
          <div>
            <p className="form-label">Fiscal year and category</p>
            <p className="text-theme-text-primary text-sm">
              {yearName} · {selectedCategory?.name ?? 'Unknown'}
            </p>
            <p className="text-theme-text-secondary text-xs">Set when the line was added.</p>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="budget-fiscal-year" className="form-label">
                Fiscal year
              </label>
              <select
                id="budget-fiscal-year"
                className="form-input"
                value={fiscalYearId}
                onChange={(e) => setFiscalYearId(e.target.value)}
                aria-invalid={Boolean(errors.fiscalYearId)}
              >
                <option value="">Choose a fiscal year</option>
                {openYears.map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.name} {fy.status === 'active' ? '(Active)' : '(Draft)'}
                  </option>
                ))}
              </select>
              {errors.fiscalYearId && (
                <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors.fiscalYearId}</p>
              )}
              {openYears.length === 0 && (
                <p className="text-theme-text-secondary mt-1 text-xs">
                  Create a draft or active fiscal year in Finance Settings first.
                </p>
              )}
            </div>
            <div>
              <label htmlFor="budget-category" className="form-label">
                Category
              </label>
              <select
                id="budget-category"
                className="form-input"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                aria-invalid={Boolean(errors.categoryId)}
              >
                <option value="">Choose a category</option>
                {categoryOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.categoryId && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors.categoryId}</p>}
            </div>
          </>
        )}

        <div>
          <label htmlFor="budget-station" className="form-label">
            Station
          </label>
          <select
            id="budget-station"
            className="form-input"
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
          >
            <option value="">Department-wide</option>
            {stationOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="budget-amount" className="form-label">
            Amount budgeted
          </label>
          <input
            id="budget-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            readOnly={amountFixed}
            aria-invalid={Boolean(errors.amount)}
            aria-describedby={amountFixed ? 'budget-amount-fixed' : undefined}
          />
          {amountFixed && (
            <p id="budget-amount-fixed" className="text-theme-text-secondary mt-1 text-xs">
              {amountLocked
                ? 'This fiscal year is locked.'
                : 'This budget has gone before the board. Change the amount with an amendment, which another officer confirms.'}
            </p>
          )}
          {errors.amount && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{errors.amount}</p>}
        </div>

        <div>
          <label htmlFor="budget-owner" className="form-label">
            Owner position
          </label>
          <select
            id="budget-owner"
            className="form-input"
            value={ownerPositionId}
            onChange={(e) => setOwnerPositionId(e.target.value)}
            aria-describedby="budget-owner-hint"
          >
            <option value="">{selectedCategory ? "Use the category's owner" : 'No owner of its own'}</option>
            {positionOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p id="budget-owner-hint" className="text-theme-text-secondary mt-1 text-xs">
            {ownerPositionId
              ? "This line's own owner, in place of the category's."
              : inheritedOwnerHint(selectedCategory)}
          </p>
        </div>

        <div>
          <label htmlFor="budget-notes" className="form-label">
            Notes
          </label>
          <textarea
            id="budget-notes"
            rows={3}
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
};
