import React, { useEffect, useState } from 'react';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyMediaService, historyService } from '../services/api';
import { REVISION_KIND_LABELS, type Revision } from '../types';

/** A record's change history, newest first. */
export const RevisionList: React.FC<{
  personId: string;
  refreshKey: number;
  /** Whose history: a person's (the default) or a photo/media item's. */
  recordType?: 'member' | 'media';
}> = ({ personId, refreshKey, recordType = 'member' }) => {
  const tz = useTimezone();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (recordType === 'media' ? historyMediaService : historyService)
      .listRevisions(personId)
      .then((list) => {
        if (!cancelled) setRevisions(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load the change history.'));
      });
    return () => {
      cancelled = true;
    };
  }, [personId, refreshKey, recordType]);

  if (error) return <p className="text-theme-text-secondary text-sm">{error}</p>;
  if (revisions.length === 0) return <p className="text-theme-text-secondary text-sm">No changes recorded yet.</p>;
  return (
    <ol className="divide-theme-surface-border divide-y">
      {revisions.map((r) => (
        <li key={r.id} className="py-2 text-sm">
          <span className="text-theme-text-primary font-medium">{REVISION_KIND_LABELS[r.kind]}</span>
          <span className="text-theme-text-secondary">
            {' '}
            · {formatDateTime(r.created_at, tz)}
            {r.actor_name ? ` · ${r.actor_name}` : ''}
          </span>
          {r.note && <p className="text-theme-text-secondary">{r.note}</p>}
        </li>
      ))}
    </ol>
  );
};
