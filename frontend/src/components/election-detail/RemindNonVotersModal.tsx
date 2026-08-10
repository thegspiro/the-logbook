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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remind-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal w-full max-w-md rounded-lg shadow-xl">
        <div className="border-theme-surface-border border-b px-6 py-4">
          <h3 id="remind-modal-title" className="text-theme-text-primary text-lg font-medium">
            Remind Non-Voters
          </h3>
        </div>

        <div className="px-6 py-4">
          <div className="mb-4 rounded-sm border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {nonVoterCount} eligible voter{nonVoterCount !== 1 ? 's have' : ' has'} not yet voted. This will resend
              ballot emails with new voting links to only those members.
            </p>
          </div>

          {error && (
            <div
              className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div>
            <label htmlFor="remind-message" className="text-theme-text-secondary block text-sm font-medium">
              Reminder Message <span className="text-theme-text-muted text-xs">(optional)</span>
            </label>
            <textarea
              id="remind-message"
              value={remindMessage}
              onChange={(e) => setRemindMessage(e.target.value)}
              rows={3}
              placeholder="This is a reminder to cast your vote. The voting window will be closing soon."
              aria-label="Reminder message"
              className="form-input mt-1 shadow-xs"
            />
          </div>

          <div className="mt-6 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(remindMessage)}
              disabled={sending}
              className="rounded-md bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
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
