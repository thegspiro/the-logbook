import React, { useCallback, useState } from 'react';

interface CloneElectionModalProps {
  sourceTitle: string;
  cloning: boolean;
  error: string | null;
  onSubmit: (payload: {
    title: string;
    start_date: string;
    end_date: string;
    include_candidates: boolean;
  }) => void;
  onClose: () => void;
}

/**
 * "Run it again": create a fresh draft from this election's setup
 * (positions, method, quorum, eligibility, reminders) with new dates.
 * Votes, tokens, attendees, and overrides are never copied.
 */
const CloneElectionModal: React.FC<CloneElectionModalProps> = ({
  sourceTitle,
  cloning,
  error,
  onSubmit,
  onClose,
}) => {
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
    [onClose],
  );

  const canSubmit = title.trim().length > 0 && startDate !== '' && endDate !== '';

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clone-election-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-theme-surface-border">
          <h3 id="clone-election-title" className="text-lg font-medium text-theme-text-primary">
            Clone Election
          </h3>
        </div>

        <div className="px-6 py-4 modal-body">
          <p className="text-sm text-theme-text-secondary mb-4">
            Creates a new draft with the same positions, voting method, quorum,
            eligibility rules, and reminder settings. Votes and attendance are
            never copied.
          </p>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3" role="alert">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <label htmlFor="clone-title" className="block text-sm font-medium text-theme-text-secondary">
            Title
          </label>
          <input
            id="clone-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 mb-4 block w-full bg-theme-input-bg border border-theme-input-border rounded-md py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="clone-start" className="block text-sm font-medium text-theme-text-secondary">
                Voting opens
              </label>
              <input
                id="clone-start"
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring"
              />
            </div>
            <div>
              <label htmlFor="clone-end" className="block text-sm font-medium text-theme-text-secondary">
                Voting closes
              </label>
              <input
                id="clone-end"
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring"
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
            <span className="text-sm text-theme-text-secondary">
              Also copy the accepted candidates
            </span>
          </label>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={cloning}
              className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
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
