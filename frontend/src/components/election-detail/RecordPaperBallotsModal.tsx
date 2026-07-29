import React, { useCallback, useState } from 'react';
import type { Candidate } from '../../types/election';

interface RecordPaperBallotsModalProps {
  candidates: Candidate[];
  recording: boolean;
  error: string | null;
  onSubmit: (
    entries: Array<{ candidate_id: string; count: number }>,
    notes: string,
    allowOverCount: boolean,
  ) => void;
  onClose: () => void;
}

/**
 * Bulk entry of an in-room paper-ballot tally: one count per candidate.
 * The server creates one vote row per ballot, flagged is_manual and
 * attributed to the recording officer.
 */
const RecordPaperBallotsModal: React.FC<RecordPaperBallotsModalProps> = ({
  candidates,
  recording,
  error,
  onSubmit,
  onClose,
}) => {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [allowOverCount, setAllowOverCount] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  const entries = candidates
    .map((c) => ({ candidate_id: c.id, count: parseInt(counts[c.id] ?? '', 10) }))
    .filter((e) => Number.isFinite(e.count) && e.count > 0);
  const total = entries.reduce((sum, e) => sum + e.count, 0);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paper-ballots-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-theme-surface-border">
          <h3 id="paper-ballots-title" className="text-lg font-medium text-theme-text-primary">
            Record Paper Ballots
          </h3>
        </div>

        <div className="px-6 py-4 modal-body">
          <p className="text-sm text-theme-text-secondary mb-4">
            Enter the paper-ballot count for each candidate. Each ballot is
            recorded as an individual vote attributed to you and covered by
            integrity verification.
          </p>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3" role="alert" aria-live="assertive">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="flex items-center justify-between gap-3">
                <label htmlFor={`paper-count-${candidate.id}`} className="text-sm text-theme-text-primary">
                  {candidate.name}
                  {candidate.position && (
                    <span className="text-xs text-theme-text-muted ml-1">({candidate.position})</span>
                  )}
                </label>
                <input
                  id={`paper-count-${candidate.id}`}
                  type="number"
                  min={0}
                  max={500}
                  value={counts[candidate.id] ?? ''}
                  onChange={(e) => setCounts({ ...counts, [candidate.id]: e.target.value })}
                  placeholder="0"
                  className="w-24 bg-theme-input-bg border border-theme-input-border rounded-md py-1.5 px-3 text-theme-text-primary text-right focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
                />
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label htmlFor="paper-notes" className="block text-sm font-medium text-theme-text-secondary">
              Notes <span className="text-xs text-theme-text-muted">(optional)</span>
            </label>
            <textarea
              id="paper-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Paper ballots collected at the March business meeting"
              className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
            />
          </div>

          {error && error.includes('over-count') && (
            <label className="mt-4 flex items-center gap-2">
              <input
                type="checkbox"
                checked={allowOverCount}
                onChange={(e) => setAllowOverCount(e.target.checked)}
                className="form-checkbox"
              />
              <span className="text-sm text-theme-text-secondary">
                The tally is correct — override the eligible-voter count check
              </span>
            </label>
          )}

          <div className="mt-6 flex items-center justify-between">
            <span className="text-sm text-theme-text-muted" aria-live="polite">
              Total: {total} ballot{total !== 1 ? 's' : ''}
            </span>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                disabled={recording}
                className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onSubmit(entries, notes, allowOverCount)}
                disabled={recording || total === 0}
                className="btn-primary rounded-md disabled:opacity-50"
              >
                {recording ? 'Recording…' : `Record ${total} Ballot${total !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecordPaperBallotsModal;
