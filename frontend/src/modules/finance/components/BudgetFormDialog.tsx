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

import React, { useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { blankToNull } from '../../../utils/formValues';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { budgetService } from '../services/api';
import { useBudgetFormOptions, withCurrent } from '../hooks/useBudgetFormOptions';
import { inheritedOwnerHint } from '../utils/budgetOwnership';
import { categoryPathLabel, orderCategoryTree } from '../utils/budgetCategoryTree';
import { MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE } from '../utils/moneyLimits';
import type { Budget, BudgetCategory, BudgetCreatePayload, BudgetUpdatePayload, FiscalYear } from '../types';

type BudgetField = 'fiscalYearId' | 'categoryId' | 'stationId' | 'amount' | 'ownerPositionId' | 'notes';

/**
 * The fields as a 422 names them (snake_case locs: `loc_by_alias=False`).
 * `BudgetCreate` / `BudgetUpdate` set no max_length on any text field.
 */
const SERVER_FIELDS: Record<BudgetField, ServerFieldSpec> = {
  fiscalYearId: { label: 'Fiscal year' },
  categoryId: { label: 'Category' },
  stationId: { label: 'Station' },
  amount: { label: 'Amount budgeted', api: ['amount_budgeted', 'amountBudgeted'] },
  ownerPositionId: { label: 'Owner position' },
  notes: { label: 'Notes' },
};

/** The update payload's key for each field the edit form sends. */
const UPDATE_KEYS: Partial<Record<BudgetField, keyof BudgetUpdatePayload>> = {
  amount: 'amountBudgeted',
  notes: 'notes',
  stationId: 'stationId',
  ownerPositionId: 'ownerPositionId',
};

const FIELD_IDS: Record<BudgetField, string> = {
  fiscalYearId: 'budget-fiscal-year',
  categoryId: 'budget-category',
  stationId: 'budget-station',
  amount: 'budget-amount',
  ownerPositionId: 'budget-owner',
  notes: 'budget-notes',
};

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
  const [errors, setErrors] = useState<Partial<Record<BudgetField, string>>>({});
  const [saving, setSaving] = useState(false);
  // An edit that saved everything but a refused field stays open on that
  // field; closing then still reports the saved line to the caller.
  const partlySaved = useRef<Budget | null>(null);

  const initial = useRef({ fiscalYearId: initialYear, categoryId, stationId, amount, ownerPositionId, notes });
  const isDirty =
    fiscalYearId !== initial.current.fiscalYearId ||
    categoryId !== initial.current.categoryId ||
    stationId !== initial.current.stationId ||
    amount !== initial.current.amount ||
    ownerPositionId !== initial.current.ownerPositionId ||
    notes !== initial.current.notes;
  const close = () => {
    if (partlySaved.current) onSaved(partlySaved.current);
    else onClose();
  };
  // Escape, the X and Cancel all ask before throwing away a changed form.
  const requestClose = useDiscardGuard({ isDirty, onClose: close });
  const clearError = (field: BudgetField) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  // In tree order and named by path, so "Quartermaster › Officer brass" is
  // told apart from an Officer brass anywhere else. A category under an
  // inactive parent is closed as well (the backend's inactiveThrough), and the
  // server refuses a new line on it, so it is not offered either.
  const categoryOptions = useMemo(
    () =>
      orderCategoryTree(
        categories.filter((c) => (c.isActive && !c.inactiveThrough) || c.id === budget?.categoryId)
      ).map(({ category }) => category),
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
    const next: Partial<Record<BudgetField, string>> = {};
    if (!isEdit && !fiscalYearId) next.fiscalYearId = 'Choose a fiscal year.';
    if (!isEdit && !categoryId) next.categoryId = 'Choose a category.';
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      next.amount = 'Enter an amount of zero or more.';
    } else if (parsed > MAX_MONEY_AMOUNT) {
      next.amount = MAX_MONEY_MESSAGE;
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
        let refused: Partial<Record<BudgetField, string>> = {};
        try {
          saved = await budgetService.update(budget.id, payload);
        } catch (err: unknown) {
          // Owner rule (2026-11-05) for a single-save form: a value the line
          // cannot hold is not written, the rest saves, and the field keeps
          // what was typed, flagged, until it is fixed. Anything the form has
          // no field for is a real failure and is reported as one.
          const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
          const keys = Object.keys(mapped?.fieldErrors ?? {}) as BudgetField[];
          if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
          refused = mapped.fieldErrors;
          const rest: BudgetUpdatePayload = { ...payload };
          for (const key of keys) {
            const sent = UPDATE_KEYS[key];
            if (sent) delete rest[sent];
          }
          saved = await budgetService.update(budget.id, rest);
        }
        const firstRefused = (Object.keys(refused) as BudgetField[])[0];
        if (firstRefused) {
          partlySaved.current = saved;
          setErrors(refused);
          toast.error(
            `Budget line saved, except ${SERVER_FIELDS[firstRefused].label.toLowerCase()}: ${refused[firstRefused] ?? ''} Fix it and save again.`
          );
          document.getElementById(FIELD_IDS[firstRefused])?.focus();
          return;
        }
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
      // A new line is created only once nothing is refused, so each refusal
      // goes on its field (forms review F-2).
      const mapped = budget ? null : mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as BudgetField[];
      if (mapped && keys[0]) {
        setErrors(mapped.fieldErrors);
        document.getElementById(FIELD_IDS[keys[0]])?.focus();
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
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
      onClose={requestClose}
      title={isEdit ? 'Edit budget line' : 'Add budget line'}
      titleId="budget-form-title"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save budget line' : 'Add budget line'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
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
            <FormField
              id={FIELD_IDS.fiscalYearId}
              label="Fiscal year"
              required
              error={errors.fiscalYearId}
              hint={
                openYears.length === 0 ? 'Create a draft or active fiscal year in Finance Settings first.' : undefined
              }
            >
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={fiscalYearId}
                  onChange={(e) => {
                    setFiscalYearId(e.target.value);
                    clearError('fiscalYearId');
                  }}
                >
                  <option value="">Choose a fiscal year</option>
                  {openYears.map((fy) => (
                    <option key={fy.id} value={fy.id}>
                      {fy.name} {fy.status === 'active' ? '(Active)' : '(Draft)'}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id={FIELD_IDS.categoryId} label="Category" required error={errors.categoryId}>
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    clearError('categoryId');
                  }}
                >
                  <option value="">Choose a category</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryPathLabel(c)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </>
        )}

        <FormField id={FIELD_IDS.stationId} label="Station" error={errors.stationId}>
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={stationId}
              onChange={(e) => {
                setStationId(e.target.value);
                clearError('stationId');
              }}
            >
              <option value="">Department-wide</option>
              {stationOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.amount}
          label="Amount budgeted"
          required
          error={errors.amount}
          hint={
            amountFixed
              ? amountLocked
                ? 'This fiscal year is locked.'
                : 'This budget has gone before the board. Change the amount with an amendment, which another officer confirms.'
              : undefined
          }
        >
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="decimal"
              min="0"
              max={MAX_MONEY_AMOUNT}
              step="0.01"
              className="form-input"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                clearError('amount');
              }}
              readOnly={amountFixed}
            />
          )}
        </FormField>

        <FormField
          id={FIELD_IDS.ownerPositionId}
          label="Owner position"
          error={errors.ownerPositionId}
          hint={
            ownerPositionId
              ? "This line's own owner, in place of the category's."
              : inheritedOwnerHint(selectedCategory)
          }
        >
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={ownerPositionId}
              onChange={(e) => {
                setOwnerPositionId(e.target.value);
                clearError('ownerPositionId');
              }}
            >
              <option value="">{selectedCategory ? "Use the category's owner" : 'No owner of its own'}</option>
              {positionOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField id={FIELD_IDS.notes} label="Notes" error={errors.notes}>
          {(field) => (
            <textarea
              {...field}
              rows={3}
              className="form-input"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                clearError('notes');
              }}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
};
