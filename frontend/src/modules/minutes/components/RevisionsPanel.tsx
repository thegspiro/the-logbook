/**
 * Approved versions of a set of minutes and whether the record still matches
 * the one in force.
 *
 * Every approval stores the minutes as approved, with a SHA-256 of that
 * content. A reopened-and-corrected record keeps the version it replaced, with
 * who superseded it and why, so what the body first approved is never lost.
 * "Matches" compares the minutes as they stand now against the current
 * version's hash; it is not a claim about the files, the minutes alone.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { History, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { minutesService } from '../services/api';
import { PanelDisclosure } from './PanelDisclosure';
import type { MinutesRevision, MinutesStatus, MinutesVerification } from '../types/minutes';

const CHANGED_LABELS: Record<string, string> = {
  title: 'title',
  meeting_type: 'meeting type',
  meeting_date: 'meeting date',
  location: 'location',
  called_by: 'called by',
  called_to_order_at: 'time called to order',
  adjourned_at: 'time adjourned',
  attendees: 'attendance',
  quorum_met: 'quorum result',
  quorum_count: 'quorum count',
  quorum_type: 'quorum rule',
  quorum_threshold: 'quorum threshold',
  sections: 'meeting sections',
  motions: 'motions',
  action_items: 'action items as assigned',
  election_results: 'election results',
  attachments: 'attachments',
};

interface RevisionsPanelProps {
  minutesId: string;
  status: MinutesStatus;
  /** Changes whenever the minutes are reloaded, so a state change refreshes this. */
  version: string;
  /** Whether the panel starts unfolded. The minutes page folds it; the default keeps it open. */
  defaultOpen?: boolean;
}

export const RevisionsPanel: React.FC<RevisionsPanelProps> = ({ minutesId, status, version, defaultOpen = true }) => {
  const tz = useTimezone();
  const [revisions, setRevisions] = useState<MinutesRevision[]>([]);
  const [verification, setVerification] = useState<MinutesVerification | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setRevisions(await minutesService.getRevisions(minutesId));
    } catch {
      setRevisions([]);
    }
    if (status === 'approved') {
      try {
        setVerification(await minutesService.verify(minutesId));
      } catch {
        setVerification(null);
      }
    } else {
      setVerification(null);
    }
    setLoaded(true);
  }, [minutesId, status]);

  useEffect(() => {
    void load();
    // `version` is not read here: it is the signal to reload.
  }, [load, version]);

  if (!loaded || (revisions.length === 0 && status !== 'approved')) return null;

  return (
    <PanelDisclosure
      id="revisions-heading"
      icon={<History className="h-5 w-5" aria-hidden="true" />}
      title="Approved versions"
      count={revisions.length}
      defaultOpen={defaultOpen}
      attention={verification !== null && !verification.verified}
    >
      {verification && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-lg p-3 text-sm ${verification.verified ? 'alert-success' : 'alert-warning'}`}
          role="status"
        >
          {verification.verified ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className="font-medium">
              {verification.verified
                ? `These minutes match version ${verification.version ?? ''} as it was approved.`
                : verification.version
                  ? `These minutes no longer match version ${verification.version} as it was approved.`
                  : 'There is no approved version to check these minutes against.'}
            </p>
            {!verification.verified && verification.changed.length > 0 && (
              <p className="mt-1">
                Changed since approval: {verification.changed.map((key) => CHANGED_LABELS[key] ?? key).join(', ')}.
              </p>
            )}
            {!verification.verified && verification.changed.length === 0 && (
              <p className="mt-1">{verification.detail}</p>
            )}
          </div>
        </div>
      )}

      {revisions.length === 0 ? (
        <p className="text-theme-text-muted mt-2 text-xs italic">No approved version is on file yet.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {revisions.map((revision) => (
            <li key={revision.id} className="border-theme-surface-border rounded-lg border p-3">
              <p className="text-theme-text-primary text-sm font-medium">
                Version {revision.version}
                {revision.superseded_at ? (
                  <span className="bg-theme-surface-secondary text-theme-text-secondary ml-2 rounded-sm px-2 py-0.5 text-xs">
                    Replaced
                  </span>
                ) : (
                  <span className="ml-2 rounded-sm bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-500/20 dark:text-green-400">
                    In force
                  </span>
                )}
              </p>
              <p className="text-theme-text-muted text-xs">
                Approved {formatDateTime(revision.approved_at, tz)}
                {revision.approved_by_name ? ` by ${revision.approved_by_name}` : ''}
                {revision.submitted_by_name ? ` · submitted by ${revision.submitted_by_name}` : ''}
              </p>
              {revision.superseded_at && (
                <p className="text-theme-text-secondary mt-1 text-xs">
                  Reopened {formatDateTime(revision.superseded_at, tz)}
                  {revision.superseded_by_name ? ` by ${revision.superseded_by_name}` : ''}
                  {revision.superseded_reason ? `: ${revision.superseded_reason}` : ''}
                </p>
              )}
              <p className="text-theme-text-muted mt-1 font-mono text-[11px] break-all">
                SHA-256 {revision.content_hash}
              </p>
            </li>
          ))}
        </ol>
      )}
    </PanelDisclosure>
  );
};

export default RevisionsPanel;
