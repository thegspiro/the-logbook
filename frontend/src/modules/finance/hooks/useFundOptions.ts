/**
 * The restricted funds a request form offers, and the department's overspend
 * rule, so the form can warn before a charge the fund cannot cover is
 * submitted. Both are advice: the server decides on approval, so a failed read
 * leaves the picker empty (hidden) rather than blocking the request.
 */

import { useEffect, useState } from 'react';
import { financeSettingsService, fundService } from '../services/api';
import { FundOverspendMode, type FundOption } from '../types';

export interface FundOptions {
  funds: FundOption[];
  mode: FundOverspendMode;
}

export function useFundOptions(): FundOptions {
  const [funds, setFunds] = useState<FundOption[]>([]);
  const [mode, setMode] = useState<FundOverspendMode>(FundOverspendMode.WARN);

  useEffect(() => {
    let current = true;
    fundService
      .list()
      .then((next) => {
        if (current) setFunds(next);
      })
      .catch(() => undefined);
    financeSettingsService
      .get()
      .then((rules) => {
        if (current) setMode(rules.fundOverspendMode);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  return { funds, mode };
}
