/**
 * Every other finalized review of the member, newest first, with the overall
 * result each stood at: how the member has trended over the years, beside
 * the one review the Last review panel summarises. Shown to holders of
 * `evaluations.view_all`; the server leaves out any review the caller could
 * not open, and computes each grade the way the conduct list does.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatCalendarDate } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { evaluationsService } from '../../services/evaluationsApi';
import type { ReviewHistoryEntry } from '../../types/evaluations';

interface ReviewHistoryPanelProps {
  evaluationId: string;
}

export const ReviewHistoryPanel: React.FC<ReviewHistoryPanelProps> = ({ evaluationId }) => {
  const [entries, setEntries] = useState<ReviewHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setEntries(null);
    setError(null);
    evaluationsService
      .history(evaluationId)
      .then((loaded) => {
        if (current) setEntries(loaded);
      })
      .catch((err: unknown) => {
        if (current) setError(getErrorMessage(err, 'The review history could not be loaded.'));
      });
    return () => {
      current = false;
    };
  }, [evaluationId]);

  return (
    <section aria-labelledby="review-history-heading" className="card p-4 sm:p-6">
      <h2 id="review-history-heading" className="text-theme-text-primary text-lg font-semibold">
        Review history
      </h2>
      {error && (
        <p className="text-theme-alert-danger-text mt-2 text-sm" role="alert">
          {error}
        </p>
      )}
      {!error && entries === null && (
        <p className="text-theme-text-secondary mt-2 text-sm" role="status">
          Loading…
        </p>
      )}
      {entries !== null && entries.length === 0 && (
        <p className="text-theme-text-secondary mt-2 text-sm">No other finalized reviews of this member.</p>
      )}
      {entries !== null && entries.length > 0 && (
        <ul className="mt-2 space-y-3 text-sm">
          {entries.map((entry) => (
            <li key={entry.evaluation_id}>
              <Link
                to={`/reports/evaluations/${entry.evaluation_id}`}
                className="text-theme-text-primary touch:min-h-11 inline-flex items-center font-medium underline underline-offset-2"
              >
                {entry.period_name ??
                  `${formatCalendarDate(entry.period_start)} – ${formatCalendarDate(entry.period_end)}`}
              </Link>
              <p className="text-theme-text-secondary">{entry.template_name}</p>
              <p className="text-theme-text-primary">
                Overall: <span className="font-semibold">{entry.overall ?? 'No overall result'}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
