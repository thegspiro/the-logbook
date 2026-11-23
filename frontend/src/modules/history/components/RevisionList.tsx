import React, { useEffect, useState } from 'react';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import {
  historyApparatusService,
  historyArticleService,
  historyDocumentService,
  historyEventService,
  historyMediaService,
  historyService,
} from '../services/api';
import { REVISION_KIND_LABELS, type ClearanceRecordType, type Revision } from '../types';

/** Where each kind of record keeps its change history. Each service is read
 * only when its kind is asked for. */
const source = (recordType: ClearanceRecordType): { listRevisions: (id: string) => Promise<Revision[]> } => {
  switch (recordType) {
    case 'media':
      return historyMediaService;
    case 'document':
      return historyDocumentService;
    case 'apparatus':
      return historyApparatusService;
    case 'event':
      return historyEventService;
    case 'article':
      return historyArticleService;
    case 'member':
      return historyService;
  }
};

/** A record's change history, newest first. */
export const RevisionList: React.FC<{
  personId: string;
  refreshKey: number;
  /** Whose history: a person's (the default), a photo/media item's, a
   * document's, an apparatus record's, an event's or an article's. */
  recordType?: ClearanceRecordType;
}> = ({ personId, refreshKey, recordType = 'member' }) => {
  const tz = useTimezone();
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    source(recordType)
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
