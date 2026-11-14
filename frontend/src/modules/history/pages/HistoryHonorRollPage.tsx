/** Members who died in the line of duty, with the memorial details each shares. */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Medal } from 'lucide-react';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { EmptyState } from '../../../components/ux/EmptyState';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import type { HonorRollEntry } from '../types';
import { formatPartialDate } from '../utils/historyFormat';

export const HistoryHonorRollPage: React.FC = () => {
  const [entries, setEntries] = useState<HonorRollEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    historyService
      .honorRoll()
      .then(setEntries)
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load the Honor Roll.')));
  }, []);

  if (!entries && !error) return <SkeletonPage />;

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'History', path: '/history' }, { label: 'Honor Roll' }]} />
      <h1 className="text-theme-text-primary mb-4 flex items-center gap-2 text-2xl font-bold">
        <Medal className="h-6 w-6 shrink-0" aria-hidden="true" />
        Honor Roll
      </h1>
      {error && (
        <div role="alert" className="alert-danger mb-4 rounded-md p-3 text-sm">
          {error}
        </div>
      )}
      {entries && entries.length === 0 ? (
        <EmptyState
          icon={Medal}
          title="No one is listed"
          description="Members who died in the line of duty appear here."
        />
      ) : (
        <ul className="card-grid">
          {(entries ?? []).map((entry) => {
            const died = formatPartialDate(entry.death_date, entry.death_date_precision, entry.death_date_circa);
            return (
              <li key={entry.id} className="card p-4">
                <Link
                  to={`/history/people/${entry.id}`}
                  className="touch-target-phone link-underline inline-flex items-center text-lg font-semibold"
                >
                  {entry.display_name}
                </Link>
                {entry.titles.length > 0 && (
                  <p className="text-theme-text-secondary text-sm">{entry.titles.join(', ')}</p>
                )}
                {entry.service_years && <p className="text-theme-text-secondary text-sm">{entry.service_years}</p>}
                {died && <p className="text-theme-text-primary mt-2 text-sm">Died {died}</p>}
                {entry.death_circumstances && (
                  <p className="text-theme-text-primary mt-1 text-sm whitespace-pre-wrap">
                    {entry.death_circumstances}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default HistoryHonorRollPage;
