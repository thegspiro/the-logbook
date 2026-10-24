/**
 * The fields of one expense report line, shared by the report form (lines
 * entered before the report exists) and the line dialog (lines added to or
 * edited on a draft), so both accept and refuse the same entries.
 */

import { z } from 'zod';
import { ExpenseType, EXPENSE_TYPE_LABELS } from '../types';
import { MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE, MIN_MONEY_AMOUNT, MIN_MONEY_MESSAGE } from './moneyLimits';

export const expenseLineSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  amount: z
    .number({ message: 'Amount is required' })
    .positive('Amount must be greater than zero')
    .min(MIN_MONEY_AMOUNT, MIN_MONEY_MESSAGE)
    .max(MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE),
  dateIncurred: z.string().min(1, 'Date is required'),
  expenseType: z.string().min(1, 'Expense type is required'),
  merchant: z.string().optional(),
});

export const EXPENSE_TYPE_OPTIONS = Object.values(ExpenseType).map((value) => ({
  value,
  label: EXPENSE_TYPE_LABELS[value] ?? value,
}));
