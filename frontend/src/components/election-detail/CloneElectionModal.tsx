import React, { useCallback, useState } from 'react';

interface CloneElectionModalProps {
  sourceTitle: string;
  cloning: boolean;
  error: string | null;
  onSubmit: (payload: { title: string; start_date: string; end_date: string; include_candidates: boolean }) => void;
  onClose: () => void;
}

/**
 * "Run it again": create a fresh draft from this election's setup
 * (positions, method, quorum, eligibility, reminders) with new dates.
 * Votes, tokens, attendees, and overrides are never copied.
 */
const CloneElectionModal: React.FC<CloneElectionModalProps> = ({ sourceTitle, cloning, error, onSubmit, onClose }) => {
  const [title, setTitle] = useState(`${sourceTitle} (Copy)`);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includeCandidates, setIncludeCandidates] = useState(false);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  const canSubmit = title.trim().length > 0 && startDate !== '' && endDate !== '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-election-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal w-full max-w-md rounded-lg shadow-xl">
        <div className="border-theme-surface-border border-b px-6 py-4">
          <h3 id="clone-election-title" className="text-theme-text-primary text-lg font-medium">
            Clone Election
          </h3>
        </div>

        <div className="modal-body px-6 py-4">
          <p className="text-theme-text-secondary mb-4 text-sm">
            Creates a new draft with the same positions, voting method, quorum, eligibility rules, and reminder
            settings. Votes and attendance are never copied.
          </p>

          {error && (
            <div className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3" role="alert">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <label htmlFor="clone-title" className="text-theme-text-secondary block text-sm font-medium">
            Title
          </label>
          <input
            id="clone-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="form-input mt-1 mb-4"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="clone-start" className="text-theme-text-secondary block text-sm font-medium">
                Voting opens
              </label>
              <input
                id="clone-start"
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="form-input mt-1"
              />
            </div>
            <div>
              <label htmlFor="clone-end" className="text-theme-text-secondary block text-sm font-medium">
                Voting closes
              </label>
              <input
                id="clone-end"
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="form-input mt-1"
              />
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={includeCandidates}
              onChange={(e) => setIncludeCandidates(e.target.checked)}
              className="form-checkbox"
            />
            <span className="text-theme-text-secondary text-sm">Also copy the accepted candidates</span>
          </label>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={cloning}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() =>
                onSubmit({
                  title: title.trim(),
                  start_date: startDate,
                  end_date: endDate,
                  include_candidates: includeCandidates,
                })
              }
              disabled={cloning || !canSubmit}
              className="btn-primary rounded-md disabled:opacity-50"
            >
              {cloning ? 'Cloning…' : 'Create Draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CloneElectionModal;
