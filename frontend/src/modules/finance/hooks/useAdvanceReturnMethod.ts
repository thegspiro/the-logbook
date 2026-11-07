import { useEffect, useState } from 'react';
import { financeSettingsService } from '../services/api';
import { AdvanceReturnMethod } from '../types';

/**
 * The return-deadline method a cash advance raised now would take, as the
 * server reads the department's setting (`GET /finance/settings`). Advice for
 * the request form's wording only: the check takes the method in force when
 * it is issued. A failed read falls back to the fixed-date method, the
 * default.
 */
export function useAdvanceReturnMethod(enabled = true): AdvanceReturnMethod {
  const [method, setMethod] = useState<AdvanceReturnMethod>(AdvanceReturnMethod.FIXED_DATE);

  useEffect(() => {
    if (!enabled) return undefined;
    let current = true;
    financeSettingsService
      .get()
      .then((settings) => {
        if (current && settings.advanceReturnMethod) setMethod(settings.advanceReturnMethod);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled]);

  return method;
}

/** What the member must do by when, in the department's chosen method. */
export function advanceDeadlineHint(method: AdvanceReturnMethod, days: number): string {
  return method === AdvanceReturnMethod.PERIODIC_STATEMENT
    ? `You are sent a statement at the end of each calendar quarter of what is still outstanding. Within ${String(days)} days of the first statement, submit an expense report against it and return anything not spent.`
    : `Within ${String(days)} days of the check, submit an expense report against it and return anything not spent.`;
}
