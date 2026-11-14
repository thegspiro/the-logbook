import { useEffect, useState } from 'react';
import { financeSettingsService } from '../services/api';

export interface MileageRateState {
  /** Dollars per mile as the server reads the department's setting; null when unset. */
  rate: string | null;
  loaded: boolean;
}

/**
 * The rate a mileage line's trip log is priced at (`GET /finance/settings`).
 * The form uses it to preview the amount and to say, before the member types
 * a log, when the department has not set one; the server prices the line
 * itself. A failed read reads as unset, so the form offers the receipt route
 * rather than a log it cannot price.
 */
export function useMileageRate(): MileageRateState {
  const [state, setState] = useState<MileageRateState>({ rate: null, loaded: false });

  useEffect(() => {
    let current = true;
    financeSettingsService
      .get()
      .then((settings) => {
        if (current) setState({ rate: settings.mileageRate ?? null, loaded: true });
      })
      .catch(() => {
        if (current) setState({ rate: null, loaded: true });
      });
    return () => {
      current = false;
    };
  }, []);

  return state;
}
