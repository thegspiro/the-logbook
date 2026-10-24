/**
 * Add a line to, or edit a line on, a draft expense report.
 *
 * The same fields and checks as the report form (`utils/expenseLines.ts`). An
 * edit sends every field the dialog owns, a blank optional one as null so the
 * clear persists (CLAUDE.md pitfall #1), except the date, which is sent only
 * when it was changed: a line stored before dates were entered at local noon
 * can read back as the previous local day, and re-saving that would move it.
 * A line's budget line is not edited here, as the report form does not set one;
 * a line copied from a purchase request keeps the request's.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { getTodayLocalDate, localToUTC, toLocalISODate } from '../../../utils/dateFormatting';
import { expenseReportService } from '../services/api';
import { useFundOptions } from '../hooks/useFundOptions';
import { useLateLineWarning } from '../hooks/useLateLineWarning';
import { EXPENSE_TYPE_OPTIONS, expenseLineSchema } from '../utils/expenseLines';
import { MAX_MONEY_AMOUNT, MIN_MONEY_AMOUNT } from '../utils/moneyLimits';
import { FundSelect } from './FundSelect';
import { ExpenseType, type ExpenseLineItem } from '../types';

interface ExpenseLineDialogProps {
  reportId: string;
  /** The line to edit; absent to add one. */
  line?: ExpenseLineItem | undefined;
  onClose: () => void;
  onSaved: () => void;
}

export const ExpenseLineDialog: React.FC<ExpenseLineDialogProps> = ({ reportId, line, onClose, onSaved }) => {
  const tz = useTimezone();
  const lateWarning = useLateLineWarning();
  const { funds, mode: fundMode } = useFundOptions();
  const initialDate = line ? toLocalISODate(line.dateIncurred, tz) : getTodayLocalDate(tz);
  const [description, setDescription] = useState(line?.description ?? '');
  const [amount, setAmount] = useState(line ? Number(line.amount).toFixed(2) : '');
  const [dateIncurred, setDateIncurred] = useState(initialDate);
  const [expenseType, setExpenseType] = useState<string>(line?.expenseType ?? ExpenseType.GENERAL);
  const [merchant, setMerchant] = useState(line?.merchant ?? '');
  const [fundCampaignId, setFundCampaignId] = useState(line?.fundCampaignId ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const late = lateWarning(dateIncurred);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = expenseLineSchema.safeParse({
      description: description.trim(),
      amount: Number(amount),
      dateIncurred,
      expenseType,
      merchant,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the line');
      return;
    }
    setError('');
    void save();
  };

  // Noon in the department's timezone, so the line lands on the day chosen.
  const dateValue = () => localToUTC(`${dateIncurred}T12:00`, tz);

  const save = async () => {
    setSaving(true);
    try {
      const value = Number(amount).toFixed(2);
      if (line) {
        await expenseReportService.updateLineItem(reportId, line.id, {
          description: description.trim(),
          amount: value,
          expenseType: expenseType as ExpenseType,
          merchant: blankToNull(merchant),
          fundCampaignId: blankToNull(fundCampaignId),
          ...(dateIncurred !== initialDate ? { dateIncurred: dateValue() } : {}),
        });
        toast.success('Line updated');
      } else {
        await expenseReportService.addLineItem(reportId, {
          description: description.trim(),
          amount: value,
          dateIncurred: dateValue(),
          expenseType: expenseType as ExpenseType,
          ...(merchant.trim() ? { merchant: merchant.trim() } : {}),
          ...(fundCampaignId ? { fundCampaignId } : {}),
        });
        toast.success('Line added');
      }
      onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, line ? 'Could not update the line' : 'Could not add the line'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={line ? 'Edit line' : 'Add a line'}
      titleId="expense-line-title"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {line ? 'Save line' : 'Add line'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="expense-line-description" className="form-label">
            Description *
          </label>
          <input
            id="expense-line-description"
            type="text"
            maxLength={500}
            className="form-input"
            placeholder="What was purchased"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="expense-line-amount" className="form-label">
              Amount *
            </label>
            <input
              id="expense-line-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={MIN_MONEY_AMOUNT}
              max={MAX_MONEY_AMOUNT}
              className="form-input"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="expense-line-date" className="form-label">
              Date *
            </label>
            <input
              id="expense-line-date"
              type="date"
              className="form-input"
              value={dateIncurred}
              onChange={(e) => setDateIncurred(e.target.value)}
              aria-describedby={late ? 'expense-line-late' : undefined}
            />
            {late && (
              <p id="expense-line-late" className="mt-1 text-xs text-amber-800 dark:text-amber-300" role="status">
                {late}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="expense-line-type" className="form-label">
              Type *
            </label>
            <select
              id="expense-line-type"
              className="form-input"
              value={expenseType}
              onChange={(e) => setExpenseType(e.target.value)}
            >
              {EXPENSE_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="expense-line-merchant" className="form-label">
              Merchant
            </label>
            <input
              id="expense-line-merchant"
              type="text"
              maxLength={300}
              className="form-input"
              placeholder="Store or vendor"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </div>
        </div>
        <FundSelect
          id="expense-line-fund"
          value={fundCampaignId}
          onChange={setFundCampaignId}
          amount={Number(amount) || 0}
          funds={funds}
          mode={fundMode}
        />
      </div>
    </Modal>
  );
};
