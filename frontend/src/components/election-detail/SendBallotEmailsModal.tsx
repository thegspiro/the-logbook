import React, { useState, useCallback } from 'react';
import type { Election } from '../../types/election';
import { formatDateTime } from '../../utils/dateFormatting';

interface SendBallotEmailsPayload {
  subject: string;
  message: string;
  sendEligibilitySummary: boolean;
}

interface SendBallotEmailsModalProps {
  election: Election;
  sending: boolean;
  error: string | null;
  onSubmit: (payload: SendBallotEmailsPayload) => void;
  onClose: () => void;
  timezone: string;
}

const SendBallotEmailsModal: React.FC<SendBallotEmailsModalProps> = ({
  election,
  sending,
  error,
  onSubmit,
  onClose,
  timezone,
}) => {
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [sendEligibilitySummary, setSendEligibilitySummary] = useState(true);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  const handleSubmit = () => {
    onSubmit({
      subject: emailSubject,
      message: emailMessage,
      sendEligibilitySummary,
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-email-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b border-theme-surface-border">
          <h3 id="send-email-modal-title" className="text-lg font-medium text-theme-text-primary">
            {election.email_sent ? 'Resend Ballot Emails' : 'Send Ballot Emails'}
          </h3>
        </div>

        <div className="px-6 py-4">
          {election.email_sent && (
            <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-sm p-3">
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                Ballot emails were previously sent{election.email_sent_at ? ` on ${formatDateTime(election.email_sent_at, timezone)}` : ''}.
                Sending again will generate new voting tokens for all eligible voters.
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-sm p-3" role="alert" aria-live="assertive">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <p className="text-sm text-theme-text-secondary">
              {election.eligible_voters && election.eligible_voters.length > 0
                ? `This will send ballot emails to the ${election.eligible_voters.length} member(s) on the eligible voters list.`
                : 'This will send ballot emails to all active members in the organization.'}
              {' '}Members whose roles or attendance do not match any ballot item requirements will be skipped, with reasons shown after sending.
            </p>

            <div>
              <label htmlFor="ballot-email-subject" className="block text-sm font-medium text-theme-text-secondary">
                Custom Subject Line <span className="text-xs text-theme-text-muted">(optional)</span>
              </label>
              <input
                type="text"
                id="ballot-email-subject"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder={`Vote Now: ${election.title}`}
                aria-label="Custom subject line"
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              />
            </div>

            <div>
              <label htmlFor="ballot-email-message" className="block text-sm font-medium text-theme-text-secondary">
                Additional Message <span className="text-xs text-theme-text-muted">(optional)</span>
              </label>
              <textarea
                id="ballot-email-message"
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                rows={3}
                placeholder="Include any additional instructions or context for voters..."
                aria-label="Additional message"
                className="mt-1 block w-full bg-theme-input-bg border border-theme-input-border rounded-md shadow-xs py-2 px-3 text-theme-text-primary focus:outline-hidden focus:ring-theme-focus-ring focus:border-theme-focus-ring"
              />
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sendEligibilitySummary}
                onChange={(e) => setSendEligibilitySummary(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-theme-input-border text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-theme-text-secondary">
                Email me a summary of who received ballots and who was skipped (with reasons)
              </span>
            </label>
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
              onClick={handleSubmit}
              disabled={sending}
              className="btn-primary disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Send Ballots'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SendBallotEmailsModal;
