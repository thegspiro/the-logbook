/**
 * The position and station choices the budget and category forms offer.
 *
 * Read from the narrow `finance.manage` option endpoints rather than `/roles`
 * and `/facilities`, which ask for grants a Treasurer may not hold. Only a
 * screen that is about to show an editing control should enable it.
 */

import { useEffect, useState } from 'react';
import { financeOptionService } from '../services/api';
import type { FinanceNamedOption } from '../types';

export interface BudgetFormOptions {
  positions: FinanceNamedOption[];
  stations: FinanceNamedOption[];
}

export function useBudgetFormOptions(enabled: boolean): BudgetFormOptions {
  const [positions, setPositions] = useState<FinanceNamedOption[]>([]);
  const [stations, setStations] = useState<FinanceNamedOption[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    // Each picker is optional on the form, so a failed list leaves only the
    // "none" choice rather than blocking the save.
    financeOptionService
      .positions()
      .then((rows) => {
        if (!cancelled) setPositions(rows);
      })
      .catch(() => {
        if (!cancelled) setPositions([]);
      });
    financeOptionService
      .stations()
      .then((rows) => {
        if (!cancelled) setStations(rows);
      })
      .catch(() => {
        if (!cancelled) setStations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { positions, stations };
}

/**
 * The options, plus the current value when the list no longer carries it (an
 * archived station, a position the list failed to load), so an edit form
 * never silently shows "none" for a value the record still has.
 */
export function withCurrent(
  options: FinanceNamedOption[],
  id: string | null | undefined,
  name: string | null | undefined
): FinanceNamedOption[] {
  if (!id || options.some((o) => o.id === id)) return options;
  return [...options, { id, name: name || 'Unknown' }];
}
