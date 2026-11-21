import { Standing } from '../constants/enums';
import type { ComplianceForecastReport } from '../types/training';

const STANDINGS: ReadonlySet<unknown> = new Set(Object.values(Standing));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isForecastAverage = (value: unknown): boolean =>
  isRecord(value) && (typeof value.pct === 'number' || value.pct === null) && STANDINGS.has(value.standing);

/**
 * The compliance forecast's `{members, averages}` envelope. Rejects `{}` and
 * the bare member list the endpoint returned before the averages moved
 * server-side, so a stale bundle or a stray body (a captive portal answering
 * 200) reaches the screen's error path instead of an invented or empty table.
 */
export const isForecastReport = (value: unknown): value is ComplianceForecastReport => {
  if (!isRecord(value) || !Array.isArray(value.members)) return false;
  const averages = value.averages;
  return (
    isRecord(averages) && ['current', 'days_30', 'days_60', 'days_90'].every((k) => isForecastAverage(averages[k]))
  );
};
