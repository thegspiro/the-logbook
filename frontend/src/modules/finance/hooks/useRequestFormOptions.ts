/**
 * The fiscal-year and budget-line choices the request forms offer.
 *
 * Read from the narrow options endpoints rather than `/finance/fiscal-years`
 * and `/finance/budgets`: those stay behind `finance.view`, and a member who
 * holds only `finance.request` must still be able to pick a line. What they
 * get is a label and the amount left, which is all the picker shows.
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

/** "Training — $1,250.00 remaining" */
export const budgetOptionLabel = (option: BudgetOption): string =>
  `${option.label} — ${formatCurrency(option.amountRemaining)} remaining`;

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
