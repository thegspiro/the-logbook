/**
 * The fiscal-year and budget-line choices the request forms offer.
 *
 * Read from the narrow options endpoints rather than `/finance/fiscal-years`
 * and `/finance/budgets`: those stay behind `finance.view`, and a member who
 * holds only `finance.request` must still be able to pick a line. What they
 * get is a label, plus the amount left only when the server says they may
 * see it (leadership, or the line's owner).
 */

import { useEffect, useState } from 'react';
import { budgetService, fiscalYearService } from '../services/api';
import type { BudgetOption, FiscalYearOption } from '../types';
import { formatCurrency } from '@/utils/currencyFormatting';

export interface RequestFormOptions {
  fiscalYears: FiscalYearOption[];
  budgetOptions: BudgetOption[];
  /** True once the fiscal years have loaded (or failed to). */
  fiscalYearsLoaded: boolean;
}

/**
 * "Training — $1,250.00 remaining", or just "Training" when no amount is sent.
 * A line under an inactive category says so.
 */
export const budgetOptionLabel = (option: BudgetOption): string => {
  const label =
    option.amountRemaining === null || option.amountRemaining === undefined
      ? option.label
      : `${option.label} — ${formatCurrency(option.amountRemaining)} remaining`;
  return option.categoryActive === false ? `${label} (inactive category)` : label;
};

/**
 * The lines a budget picker offers. A line under an inactive category takes
 * no new charges, so it is left out — except as `savedBudgetId`, the line a
 * request already on file points at, which still has to be shown (the server
 * accepts it unchanged; it refuses only a new choice of it, or submitting a
 * draft on it).
 */
export const selectableBudgetOptions = (options: BudgetOption[], savedBudgetId?: string | null): BudgetOption[] =>
  options.filter((option) => option.categoryActive !== false || (!!savedBudgetId && option.id === savedBudgetId));

export function useRequestFormOptions(fiscalYearId: string | undefined): RequestFormOptions {
  const [fiscalYears, setFiscalYears] = useState<FiscalYearOption[]>([]);
  const [fiscalYearsLoaded, setFiscalYearsLoaded] = useState(false);
  const [budgetOptions, setBudgetOptions] = useState<BudgetOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fiscalYearService
      .options()
      .then((years) => {
        if (!cancelled) setFiscalYears(years);
      })
      .catch(() => {
        if (!cancelled) setFiscalYears([]);
      })
      .finally(() => {
        if (!cancelled) setFiscalYearsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!fiscalYearId) {
      setBudgetOptions([]);
      return undefined;
    }
    let cancelled = false;
    budgetService
      .options(fiscalYearId)
      .then((options) => {
        if (!cancelled) setBudgetOptions(options);
      })
      .catch(() => {
        // The budget link is optional; a failed list leaves "No budget
        // linked" as the only choice rather than blocking the request.
        if (!cancelled) setBudgetOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fiscalYearId]);

  return { fiscalYears, budgetOptions, fiscalYearsLoaded };
}
