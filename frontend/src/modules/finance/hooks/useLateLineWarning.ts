/**
 * Warns about a line older than the department's substantiation deadline while
 * it is being entered. The server grades lines when the report is submitted;
 * this is advice only, so a failed read of the rule just means no warning.
 * Measured from today, the earliest the report can be submitted.
 */

import { useEffect, useState } from 'react';
import { useTimezone } from '@/hooks/useTimezone';
import { calendarDaysBetween, getTodayLocalDate } from '@/utils/dateFormatting';
import { financeSettingsService } from '../services/api';
import { SubstantiationMode, type FinanceSettings } from '../types';

export function useLateLineWarning(): (dateIncurred: string) => string | null {
  const tz = useTimezone();
  const [rules, setRules] = useState<FinanceSettings | null>(null);

  useEffect(() => {
    let current = true;
    financeSettingsService
      .get()
      .then((next) => {
        if (current) setRules(next);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  return (dateIncurred: string) => {
    if (!rules || rules.substantiationMode === SubstantiationMode.OFF) return null;
    const age = calendarDaysBetween(getTodayLocalDate(tz), dateIncurred);
    if (age === null || age <= rules.substantiationDays) return null;
    return rules.substantiationMode === SubstantiationMode.BLOCK
      ? `More than ${rules.substantiationDays} days ago. The department does not accept expenses this old; this report cannot be submitted with this line.`
      : `More than ${rules.substantiationDays} days ago. An approver will have to confirm this line, and the department may report its reimbursement as taxable pay.`;
  };
}
