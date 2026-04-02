import React, { useState, useCallback } from 'react';

interface RemindNonVotersModalProps {
  nonVoterCount: number;
  sending: boolean;
  error: string | null;
  onSubmit: (message: string) => void;
  onClose: () => void;
}

const RemindNonVotersModal: React.FC<RemindNonVotersModalProps> = ({
  nonVoterCount,
  sending,
  error,
  onSubmit,
  onClose,
}) => {
  const [remindMessage, setRemindMessage] = useState('');

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remind-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-theme-surface-border">
          <h3 id="remind-modal-title" className="text-lg font-medium text-theme-text-primary">
            Remind Non-Voters
          </h3>
        </div>

        <div className="px-6 py-4">
          <div className="mb-4 bg-amber-500/10 border border-amber-500/30 rounded-sm p-3">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {nonVoterCount} eligible voter{nonVoterCount !== 1 ? 's have' : ' has'} not yet voted.
              This will resend ballot emails with new voting links to only those members.
            </p>
          </div>

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3" role="alert" aria-live="assertive">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="remind-message" className="block text-sm font-medium text-theme-text-secondary">
              Reminder Message <span className="text-xs text-theme-text-muted">(optional)</span>
            </label>
            <textarea
              id="remind-message"
              value={remindMessage}
              onChange={(e) => setRemindMessage(e.target.value)}
              rows={3}
              placeholder="This is a reminder to cast your vote. The voting window will be closing soon."
              aria-label="Reminder message"
              className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
            />
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-4 py-2 border border-theme-surface-border rounded-md text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(remindMessage)}
              disabled={sending}
              className="px-4 py-2 bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
            >
              {sending ? 'Sending...' : `Send Reminders (${nonVoterCount})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemindNonVotersModal;
