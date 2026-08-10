import React, { useCallback, useState } from 'react';
import type { Candidate } from '../../types/election';

interface RecordPaperBallotsModalProps {
  candidates: Candidate[];
  recording: boolean;
  error: string | null;
  attestationsRequired?: number;
  onSubmit: (entries: Array<{ candidate_id: string; count: number }>, notes: string, allowOverCount: boolean) => void;
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
  attestationsRequired = 0,
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
    [onClose]
  );

  const entries = candidates
    .map((c) => ({ candidate_id: c.id, count: parseInt(counts[c.id] ?? '', 10) }))
    .filter((e) => Number.isFinite(e.count) && e.count > 0);
  const total = entries.reduce((sum, e) => sum + e.count, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paper-ballots-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal w-full max-w-md rounded-lg shadow-xl">
        <div className="border-theme-surface-border border-b px-6 py-4">
          <h3 id="paper-ballots-title" className="text-theme-text-primary text-lg font-medium">
            Record Paper Ballots
          </h3>
        </div>

        <div className="modal-body px-6 py-4">
          <p className="text-theme-text-secondary mb-4 text-sm">
            Enter the paper-ballot count for each candidate. Each ballot is recorded as an individual vote attributed to
            you and covered by integrity verification.
            {attestationsRequired > 0 && (
              <>
                {' '}
                The batch will not count in results until {attestationsRequired} other officer
                {attestationsRequired !== 1 ? 's' : ''} attest
                {attestationsRequired === 1 ? 's' : ''} the tally.
              </>
            )}
          </p>

          {error && (
            <div
              className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            {candidates.map((candidate) => (
              <div key={candidate.id} className="flex items-center justify-between gap-3">
                <label htmlFor={`paper-count-${candidate.id}`} className="text-theme-text-primary text-sm">
                  {candidate.name}
                  {candidate.position && (
                    <span className="text-theme-text-muted ml-1 text-xs">({candidate.position})</span>
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
                  className="form-input-sm w-24 text-right"
                />
              </div>
            ))}
          </div>

          <div className="mt-4">
            <label htmlFor="paper-notes" className="text-theme-text-secondary block text-sm font-medium">
              Notes <span className="text-theme-text-muted text-xs">(optional)</span>
            </label>
            <textarea
              id="paper-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. Paper ballots collected at the March business meeting"
              className="form-input mt-1 shadow-xs"
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
              <span className="text-theme-text-secondary text-sm">
                The tally is correct — override the eligible-voter count check
              </span>
            </label>
          )}

          <div className="mt-6 flex items-center justify-between">
            <span className="text-theme-text-muted text-sm" aria-live="polite">
              Total: {total} ballot{total !== 1 ? 's' : ''}
            </span>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={onClose}
                disabled={recording}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 disabled:opacity-50"
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
