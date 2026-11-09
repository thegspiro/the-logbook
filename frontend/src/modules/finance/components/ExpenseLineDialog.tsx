/**
 * Add a line to, or edit a line on, a draft expense report.
 *
 * The same fields and checks as the report form (`utils/expenseLines.ts`). An
 * edit sends every field the dialog owns, a blank optional one as null so the
 * clear persists (CLAUDE.md pitfall #1), except the date, which is sent only
 * when it was changed: a line stored before dates were entered at local noon
 * can read back as the previous local day, and re-saving that would move it.
 * The member picks the budget line the expense charges (owner decision
 * 2026-11-01); approving the report commits it there. A line copied from a
 * purchase request keeps the request's, which stays selectable even under an
 * inactive category, as the server accepts it unchanged.
 *
 * A mileage line may carry a trip log instead of an amount and a receipt
 * (owner decision 2026-11-01). While it has trips the server prices and
 * dates it, so the amount and date fields give way to the log; every save
 * sends the log, or null once it is emptied, so a removed log is cleared.
 */

import React, { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { getTodayLocalDate, localToUTC, toLocalISODate } from '../../../utils/dateFormatting';
import type { ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { expenseReportService } from '../services/api';
import { useFundOptions } from '../hooks/useFundOptions';
import { useLateLineWarning } from '../hooks/useLateLineWarning';
import { budgetOptionLabel, selectableBudgetOptions, useRequestFormOptions } from '../hooks/useRequestFormOptions';
import { EXPENSE_TYPE_OPTIONS, expenseLineSchema } from '../utils/expenseLines';
import { firstErrorField, refusalsOnFields, updateExceptRefused, useFieldErrors } from '../utils/fieldRefusals';
import { MAX_MONEY_AMOUNT, MIN_MONEY_AMOUNT } from '../utils/moneyLimits';
import { FundSelect } from './FundSelect';
import { MileageTripLog } from './MileageTripLog';
import { useMileageRate } from '../hooks/useMileageRate';
import { fromStoredTrips, priceTrips, toTripPayload, tripLogError, type TripEntry } from '../utils/mileage';
import { ExpenseType, type ExpenseLineItem, type ExpenseLineItemUpdatePayload } from '../types';

type LineField =
  | 'description'
  | 'amount'
  | 'dateIncurred'
  | 'expenseType'
  | 'merchant'
  | 'budgetId'
  | 'fundCampaignId'
  | 'mileageTrips';

/** `ExpenseLineItemCreate` / `ExpenseLineItemUpdate` (schemas/finance.py). */
const SERVER_FIELDS: Record<LineField, ServerFieldSpec> = {
  description: { label: 'Description', maxLength: 500 },
  amount: { label: 'Amount' },
  dateIncurred: { label: 'Date' },
  expenseType: { label: 'Type' },
  merchant: { label: 'Merchant', maxLength: 300 },
  budgetId: { label: 'Budget line' },
  fundCampaignId: { label: 'Restricted fund' },
  mileageTrips: { label: 'Trip log' },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as LineField[];
const UPDATE_KEYS: Partial<Record<LineField, readonly (keyof ExpenseLineItemUpdatePayload)[]>> = {
  description: ['description'],
  amount: ['amount'],
  dateIncurred: ['dateIncurred'],
  expenseType: ['expenseType'],
  merchant: ['merchant'],
  budgetId: ['budgetId'],
  fundCampaignId: ['fundCampaignId'],
  mileageTrips: ['mileageTrips'],
};
const FIELD_IDS: Record<LineField, string> = {
  description: 'expense-line-description',
  amount: 'expense-line-amount',
  dateIncurred: 'expense-line-date',
  expenseType: 'expense-line-type',
  merchant: 'expense-line-merchant',
  budgetId: 'expense-line-budget',
  fundCampaignId: 'expense-line-fund',
  mileageTrips: 'expense-line-trips',
};

interface ExpenseLineDialogProps {
  reportId: string;
  /** The report's year, whose budget lines the picker offers. */
  fiscalYearId: string;
  /** The line to edit; absent to add one. */
  line?: ExpenseLineItem | undefined;
  onClose: () => void;
  onSaved: () => void;
}

export const ExpenseLineDialog: React.FC<ExpenseLineDialogProps> = ({
  reportId,
  fiscalYearId,
  line,
  onClose,
  onSaved,
}) => {
  const tz = useTimezone();
  const lateWarning = useLateLineWarning();
  const { funds, mode: fundMode } = useFundOptions();
  const { budgetOptions } = useRequestFormOptions(fiscalYearId);
  const initialDate = line ? toLocalISODate(line.dateIncurred, tz) : getTodayLocalDate(tz);
  const [description, setDescription] = useState(line?.description ?? '');
  const [amount, setAmount] = useState(line ? Number(line.amount).toFixed(2) : '');
  const [dateIncurred, setDateIncurred] = useState(initialDate);
  const [expenseType, setExpenseType] = useState<string>(line?.expenseType ?? ExpenseType.GENERAL);
  const [merchant, setMerchant] = useState(line?.merchant ?? '');
  const [fundCampaignId, setFundCampaignId] = useState(line?.fundCampaignId ?? '');
  const [budgetId, setBudgetId] = useState(line?.budgetId ?? '');
  const [trips, setTrips] = useState<TripEntry[]>(fromStoredTrips(line?.mileageTrips));
  const { errors, setErrors, clearError } = useFieldErrors<LineField>();
  const [saving, setSaving] = useState(false);
  const { rate: mileageRate } = useMileageRate();
  // An edit that saved all but a refused field stays open on that field;
  // closing then still tells the page to reload the line.
  const partlySaved = useRef(false);

  const initial = useRef({ description, amount, dateIncurred, expenseType, merchant, fundCampaignId, budgetId, trips });
  const isDirty =
    description !== initial.current.description ||
    amount !== initial.current.amount ||
    dateIncurred !== initial.current.dateIncurred ||
    expenseType !== initial.current.expenseType ||
    merchant !== initial.current.merchant ||
    fundCampaignId !== initial.current.fundCampaignId ||
    budgetId !== initial.current.budgetId ||
    trips !== initial.current.trips;
  const close = () => (partlySaved.current ? onSaved() : onClose());
  // Escape, the X and Cancel all ask before throwing away a changed line.
  const requestClose = useDiscardGuard({ isDirty, onClose: close });

  const isMileage = expenseType === ExpenseType.MILEAGE;
  // A log only counts while the line is mileage and the department has a rate.
  const logged = isMileage && Boolean(mileageRate) && trips.length > 0;
  const previewAmount = logged ? priceTrips(trips, mileageRate) : null;
  const late = logged ? null : lateWarning(dateIncurred);

  const flag = (next: Partial<Record<LineField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<LineField, string>> = {};
    if (logged) {
      if (!description.trim()) next.description = 'Description is required';
      const problem = tripLogError(trips);
      if (problem) next.mileageTrips = problem;
    } else {
      const parsed = expenseLineSchema.safeParse({
        description: description.trim(),
        amount: Number(amount),
        dateIncurred,
        expenseType,
        merchant,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = issue.path[0] as LineField | undefined;
          if (key && !next[key]) next[key] = issue.message;
        }
      }
    }
    if (!flag(next)) return;
    void save();
  };

  // Noon in the department's timezone, so the line lands on the day chosen.
  const dateValue = () => localToUTC(`${dateIncurred}T12:00`, tz);

  const save = async () => {
    setSaving(true);
    try {
      const value = Number(amount).toFixed(2);
      // With a log, the server works out the amount and the date.
      const priced = logged
        ? { mileageTrips: toTripPayload(trips) }
        : { amount: value, ...(line && dateIncurred === initialDate ? {} : { dateIncurred: dateValue() }) };
      if (line) {
        const payload: ExpenseLineItemUpdatePayload = {
          description: description.trim(),
          expenseType: expenseType as ExpenseType,
          merchant: blankToNull(merchant),
          fundCampaignId: blankToNull(fundCampaignId),
          budgetId: blankToNull(budgetId),
          mileageTrips: null,
          ...priced,
        };
        // Owner rule (2026-11-05) for a single-save edit: a refused value is
        // not written, the rest saves, and the field stays flagged.
        const { refused } = await updateExceptRefused(
          (body: ExpenseLineItemUpdatePayload) => expenseReportService.updateLineItem(reportId, line.id, body),
          payload,
          SERVER_FIELDS,
          UPDATE_KEYS
        );
        const first = firstErrorField(refused, FIELD_ORDER);
        if (first) {
          partlySaved.current = true;
          flag(refused);
          toast.error(
            `Line saved, except ${SERVER_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
          );
          return;
        }
        toast.success('Line updated');
      } else {
        await expenseReportService.addLineItem(reportId, {
          description: description.trim(),
          expenseType: expenseType as ExpenseType,
          ...priced,
          ...(merchant.trim() ? { merchant: merchant.trim() } : {}),
          ...(fundCampaignId ? { fundCampaignId } : {}),
          ...(budgetId ? { budgetId } : {}),
        });
        toast.success('Line added');
      }
      onSaved();
    } catch (err: unknown) {
      // A new line is added only once nothing is refused.
      const mapped = line ? null : refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, line ? 'Could not update the line' : 'Could not add the line'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={line ? 'Edit line' : 'Add a line'}
      titleId="expense-line-title"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {line ? 'Save line' : 'Add line'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormField
          id={FIELD_IDS.description}
          label="Description"
          required
          error={errors.description}
          maxLength={500}
          count={description.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              placeholder="What was purchased"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                clearError('description');
              }}
            />
          )}
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!logged && (
            <FormField id={FIELD_IDS.amount} label="Amount" required error={errors.amount}>
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={MIN_MONEY_AMOUNT}
                  max={MAX_MONEY_AMOUNT}
                  className="form-input"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    clearError('amount');
                  }}
                />
              )}
            </FormField>
          )}
          {!logged && (
            <FormField
              id={FIELD_IDS.dateIncurred}
              label="Date"
              required
              error={errors.dateIncurred}
              hint={
                late ? (
                  <span className="text-amber-800 dark:text-amber-300" role="status">
                    {late}
                  </span>
                ) : undefined
              }
            >
              {(field) => (
                <input
                  {...field}
                  type="date"
                  className="form-input"
                  value={dateIncurred}
                  onChange={(e) => {
                    setDateIncurred(e.target.value);
                    clearError('dateIncurred');
                  }}
                />
              )}
            </FormField>
          )}
          <FormField id={FIELD_IDS.expenseType} label="Type" required error={errors.expenseType}>
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={expenseType}
                onChange={(e) => {
                  setExpenseType(e.target.value);
                  clearError('expenseType');
                }}
              >
                {EXPENSE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={FIELD_IDS.merchant}
            label="Merchant"
            error={errors.merchant}
            maxLength={300}
            count={merchant.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                className="form-input"
                placeholder="Store or vendor"
                value={merchant}
                onChange={(e) => {
                  setMerchant(e.target.value);
                  clearError('merchant');
                }}
              />
            )}
          </FormField>
        </div>
        {isMileage && (
          <div id={FIELD_IDS.mileageTrips} tabIndex={-1}>
            {errors.mileageTrips && (
              <p role="alert" className="mb-2 text-sm text-red-800 dark:text-red-300">
                {errors.mileageTrips}
              </p>
            )}
            <MileageTripLog
              idPrefix="expense-line"
              trips={trips}
              onChange={(next) => {
                setTrips(next);
                clearError('mileageTrips');
              }}
              rate={mileageRate}
              today={getTodayLocalDate(tz)}
            />
          </div>
        )}
        <FormField
          id={FIELD_IDS.budgetId}
          label="Budget line"
          error={errors.budgetId}
          hint="Approving the report commits this amount to the line you choose."
        >
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={budgetId}
              onChange={(e) => {
                setBudgetId(e.target.value);
                clearError('budgetId');
              }}
            >
              <option value="">No budget line</option>
              {selectableBudgetOptions(budgetOptions, line?.budgetId).map((option) => (
                <option key={option.id} value={option.id}>
                  {budgetOptionLabel(option)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FundSelect
          id={FIELD_IDS.fundCampaignId}
          value={fundCampaignId}
          onChange={(next) => {
            setFundCampaignId(next);
            clearError('fundCampaignId');
          }}
          amount={Number(previewAmount ?? amount) || 0}
          funds={funds}
          mode={fundMode}
          error={errors.fundCampaignId}
        />
      </div>
    </Modal>
  );
};
