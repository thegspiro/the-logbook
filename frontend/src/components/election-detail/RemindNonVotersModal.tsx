import React, { useState, useCallback } from 'react';
import { useDialog } from '../../hooks/useDialog';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateTime } from '../../utils/dateFormatting';
import { REMINDER_COOLDOWN_MINUTES, reminderCooldownRemainingMinutes } from '../../utils/electionHelpers';

interface RemindNonVotersModalProps {
  nonVoterCount: number;
  /** The election's reminder_sent_at; null when no reminder has gone out yet. */
  reminderSentAt: string | null;
  sending: boolean;
  error: string | null;
  onSubmit: (message: string) => void;
  onClose: () => void;
}

const RemindNonVotersModal: React.FC<RemindNonVotersModalProps> = ({
  nonVoterCount,
  reminderSentAt,
  sending,
  error,
  onSubmit,
  onClose,
}) => {
  const dialogRef = useDialog<HTMLDivElement>({ onClose });
  const tz = useTimezone();

  const [remindMessage, setRemindMessage] = useState('');
  const cooldownMinutesLeft = reminderCooldownRemainingMinutes(reminderSentAt);
  const inCooldown = cooldownMinutesLeft > 0;

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
      className="modal-overlay z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remind-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div ref={dialogRef} className="modal-panel modal-panel-scroll w-full max-w-md">
        <div className="border-theme-surface-border border-b px-6 py-4">
          <h3 id="remind-modal-title" className="text-theme-text-primary text-lg font-medium">
            Remind Non-Voters
          </h3>
        </div>

        <div className="px-6 py-4">
          <div className="mb-4 rounded-sm border border-amber-500/30 bg-amber-500/10 p-3">
            {/* The count is "no electronic ballot on file", not "has not
              voted": paper ballots are recorded as batch totals and never
              matched to a member, so a paper voter is in this number and will
              be reminded (W50-64). */}
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {nonVoterCount} eligible voter{nonVoterCount !== 1 ? 's have' : ' has'} no electronic ballot on file.
              Paper ballots are not matched to members, so anyone who voted on paper is included. This sends a reminder
              with a new voting link to only those members; their earlier links stop working.
            </p>
          </div>

          <p className="text-theme-text-muted mb-4 text-xs" data-testid="reminder-cooldown">
            {reminderSentAt ? `Last reminder sent ${formatDateTime(reminderSentAt, tz)}. ` : ''}
            Reminders can be sent at most once every {REMINDER_COOLDOWN_MINUTES} minutes.
            {inCooldown
              ? ` The next one can be sent in about ${cooldownMinutesLeft} minute${cooldownMinutesLeft === 1 ? '' : 's'}.`
              : ''}
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
              disabled={sending || inCooldown}
              title={
                inCooldown
                  ? `A reminder was sent recently — try again in about ${cooldownMinutesLeft} minute(s)`
                  : undefined
              }
              className="rounded-md bg-amber-700 px-4 py-2 text-white hover:bg-amber-800 disabled:opacity-50"
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
