import React from 'react';
import { CheckCircle, Clock, XCircle } from 'lucide-react';
import type { ManualBallotBatch } from '../../types/election';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

interface PaperBallotBatchesPanelProps {
  batches: ManualBallotBatch[];
  currentUserId: string | null;
  electionOpen: boolean;
  attestingBatchId: string | null;
  onAttest: (batchId: string) => void;
  onVoid: (batchId: string) => void;
}

/**
 * Paper-tally batches with their attestation trail. A pending batch is
 * excluded from results until the required number of officers (other than
 * the recorder) attest it; a mis-keyed batch can be voided with a reason.
 */
const PaperBallotBatchesPanel: React.FC<PaperBallotBatchesPanelProps> = ({
  batches,
  currentUserId,
  electionOpen,
  attestingBatchId,
  onAttest,
  onVoid,
}) => {
  const tz = useTimezone();

  if (batches.length === 0) return null;

  const statusBadge = (batch: ManualBallotBatch) => {
    if (batch.status === 'voided') {
      return (
        <span className="badge inline-flex items-center gap-1 bg-red-500/10 text-red-700 dark:text-red-300">
          <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Voided
        </span>
      );
    }
    if (batch.status === 'confirmed') {
      return (
        <span className="badge inline-flex items-center gap-1 bg-green-500/10 text-green-700 dark:text-green-300">
          <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" /> Confirmed
        </span>
      );
    }
    return (
      <span className="badge inline-flex items-center gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-300">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Pending {batch.attestations.length}/
        {batch.required_attestations}
      </span>
    );
  };

  return (
    <div className="card mb-6">
      <h3 className="text-theme-text-primary mb-1 text-lg font-medium">Paper-Ballot Batches</h3>
      <p className="text-theme-text-secondary mb-4 text-sm">
        Pending batches do not count in results until the required officers confirm the tally. The recording officer
        cannot attest their own batch.
      </p>
      <ul className="space-y-4">
        {batches.map((batch) => {
          const alreadyAttested = batch.attestations.some((a) => a.user_id != null && a.user_id === currentUserId);
          const canAttest =
            electionOpen &&
            batch.status === 'pending' &&
            currentUserId !== null &&
            batch.recorded_by !== currentUserId &&
            !alreadyAttested;
          const canVoid = electionOpen && batch.status !== 'voided';
          return (
            <li key={batch.batch_id} className="border-theme-surface-border rounded-md border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {statusBadge(batch)}
                  <span className="text-theme-text-primary text-sm font-medium">
                    {batch.total_ballots} ballot{batch.total_ballots !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex gap-2">
                  {canAttest && (
                    <button
                      type="button"
                      onClick={() => onAttest(batch.batch_id)}
                      disabled={attestingBatchId === batch.batch_id}
                      className="rounded-md bg-teal-600 px-3 py-1.5 text-sm text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      {attestingBatchId === batch.batch_id ? 'Attesting…' : 'Attest Count'}
                    </button>
                  )}
                  {canVoid && (
                    <button
                      type="button"
                      onClick={() => onVoid(batch.batch_id)}
                      className="rounded-md border border-red-500/50 px-3 py-1.5 text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400"
                    >
                      Void Batch
                    </button>
                  )}
                </div>
              </div>

              <div className="text-theme-text-secondary mt-2 text-sm">
                {batch.totals.map((t) => (
                  <span key={t.candidate_id} className="mr-3">
                    {t.candidate_name}
                    {t.position ? ` (${t.position})` : ''}: {t.count}
                  </span>
                ))}
              </div>

              <div className="text-theme-text-muted mt-2 text-xs">
                Recorded by {batch.recorded_by_name ?? 'unknown'}
                {batch.recorded_at ? ` on ${formatDateTime(batch.recorded_at, tz)}` : ''}
                {batch.notes ? ` — ${batch.notes}` : ''}
              </div>

              {batch.attestations.length > 0 && (
                <div className="text-theme-text-muted mt-1 text-xs">
                  Attested by{' '}
                  {batch.attestations
                    .map(
                      (a) => `${a.name ?? 'unknown'}${a.attested_at ? ` (${formatDateTime(a.attested_at, tz)})` : ''}`
                    )
                    .join(', ')}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PaperBallotBatchesPanel;
