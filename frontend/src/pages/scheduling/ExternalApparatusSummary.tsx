/**
 * Which outside units members staffed over a report period.
 *
 * One row per agency and apparatus: shifts, hours, and how many different
 * members rode it. Only counted shifts are included — a rejected entry is out
 * of this table the moment it is out of the member's totals — and a unit
 * renamed on the list reads as one row under its current name.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ExternalApparatusSummaryRow } from '../../modules/scheduling/services/api';
import { formatNumber } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { formatHours, sumHoursToQuarter } from '../../utils/hoursFormatting';

interface ExternalApparatusSummaryProps {
  /** YYYY-MM-DD, inclusive. */
  startDate: string;
  endDate: string;
  /** Bumped by the parent after a reject or restore, to re-read the totals. */
  refreshKey: number;
}

export const ExternalApparatusSummary: React.FC<ExternalApparatusSummaryProps> = ({
  startDate,
  endDate,
  refreshKey,
}) => {
  const [rows, setRows] = useState<ExternalApparatusSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await schedulingService.getExternalApparatusSummary({ start_date: startDate, end_date: endDate });
      setRows(data.rows);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load the outside apparatus summary'));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="mt-8" aria-labelledby="external-apparatus-summary-heading">
      <h3 id="external-apparatus-summary-heading" className="text-theme-text-primary text-lg font-semibold">
        Outside apparatus staffed
      </h3>
      <p className="text-theme-text-muted mb-3 text-sm">
        Shifts members logged on other departments&apos; apparatus in this period, per unit.
      </p>

      {loading ? (
        <div className="flex justify-center py-6" role="status" aria-label="Loading outside apparatus summary">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        </div>
      ) : error ? (
        <div className="alert-error flex items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card-secondary py-6 text-center">
          <p className="text-theme-text-muted text-sm">No outside apparatus was staffed in this period.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="rwd-table w-full text-sm">
            <caption className="sr-only">Outside apparatus staffed by members in this period</caption>
            <thead>
              <tr className="border-theme-surface-border text-theme-text-secondary border-b text-left">
                <th scope="col" className="px-4 py-3 font-medium">
                  Department
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Apparatus
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Shifts
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Hours
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Members
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.external_apparatus_id ?? `${row.agency_name}\u001f${row.apparatus_name}`}
                  className="border-theme-surface-border hover:bg-theme-surface-hover border-b"
                >
                  <td className="rwd-table-lead text-theme-text-primary px-4 py-3" data-label="Department">
                    {row.agency_name}
                  </td>
                  <td className="text-theme-text-primary px-4 py-3" data-label="Apparatus">
                    {row.apparatus_name}
                    {row.apparatus_type && <span className="text-theme-text-muted"> · {row.apparatus_type}</span>}
                  </td>
                  <td className="text-theme-text-primary px-4 py-3 text-right" data-label="Shifts">
                    {formatNumber(row.shifts)}
                  </td>
                  <td className="text-theme-text-primary px-4 py-3 text-right font-medium" data-label="Hours">
                    {formatHours(row.hours)}
                  </td>
                  <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="Members">
                    {formatNumber(row.members)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-theme-surface-border text-theme-text-primary border-t font-semibold">
                <td className="rwd-table-lead px-4 py-3" data-label="Total" colSpan={2}>
                  Total
                </td>
                <td className="px-4 py-3 text-right" data-label="Shifts">
                  {formatNumber(rows.reduce((sum, r) => sum + r.shifts, 0))}
                </td>
                <td className="px-4 py-3 text-right" data-label="Hours">
                  {formatHours(sumHoursToQuarter(rows.map((r) => r.hours)))}
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
};

export default ExternalApparatusSummary;
