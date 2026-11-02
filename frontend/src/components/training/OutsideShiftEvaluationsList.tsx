/**
 * Outside shifts awaiting an evaluation
 *
 * A member's shift on an outside agency's unit (an agency the department
 * evaluates) is evaluated by that agency's preceptor, who has no account
 * here. They fill out the paper form; a training officer enters it. This is
 * the training officer's list of what is still to enter. Nothing is blocked
 * meanwhile: an outside shift has no close-out to hold.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, Truck } from 'lucide-react';

import { useTimezone } from '../../hooks/useTimezone';
import { shiftEvaluationService } from '../../services/api';
import type { OutsideShiftAwaitingEvaluation } from '../../types/training';
import { formatCalendarDate, formatTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { outsideShiftEvaluationPagePath } from '../../utils/shiftEvaluations';

export const OutsideShiftEvaluationsList: React.FC = () => {
  const tz = useTimezone();
  const [rows, setRows] = useState<OutsideShiftAwaitingEvaluation[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    shiftEvaluationService
      .listOutsideOutstanding()
      .then((loaded) => {
        if (!cancelled) setRows(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Outside shifts could not be loaded'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="card space-y-3 p-4" aria-labelledby="se-outside-heading">
      <h3 id="se-outside-heading" className="text-theme-text-primary flex items-center gap-2 font-semibold">
        <Truck className="h-4 w-4" aria-hidden="true" /> Outside shifts awaiting an evaluation
      </h3>
      <p className="text-theme-text-secondary text-sm">
        Shifts members logged on another department&apos;s units, where that department&apos;s preceptor evaluated them
        on paper. Turn evaluation on for a department under Scheduling settings, Outside apparatus.
      </p>
      {error ? (
        <p role="alert" className="alert-danger text-theme-alert-danger-text text-sm">
          {error}
        </p>
      ) : rows === null ? (
        <div className="flex justify-center py-4" aria-busy="true">
          <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" aria-label="Loading outside shifts" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-theme-text-muted text-sm">
          Nothing waiting. Every outside shift that needs one is evaluated.
        </p>
      ) : (
        <ul className="divide-theme-surface-border divide-y">
          {rows.map((row) => {
            const times =
              row.start_at && row.end_at ? ` · ${formatTime(row.start_at, tz)}–${formatTime(row.end_at, tz)}` : '';
            return (
              <li key={row.entry_id} className="split-row gap-2 py-3 sm:items-center">
                <div className="split-row-main">
                  <p className="text-theme-text-primary font-medium">
                    {row.member_name ?? 'A member'}
                    <span className="badge bg-theme-alert-warning-bg text-theme-alert-warning-text ml-2">
                      {row.evaluation_status === 'draft' ? 'Started' : 'Not started'}
                    </span>
                  </p>
                  <p className="text-theme-text-secondary text-sm">
                    {formatCalendarDate(row.shift_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                    {times} · {row.agency_name} {row.apparatus_name}
                  </p>
                </div>
                <Link to={outsideShiftEvaluationPagePath(row.entry_id, row.scope_key)} className="btn-primary shrink-0">
                  {row.evaluation_status === 'draft' ? 'Continue' : 'Enter evaluation'}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default OutsideShiftEvaluationsList;
