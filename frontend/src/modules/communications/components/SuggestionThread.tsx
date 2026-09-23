/**
 * The follow-up thread between a box's reviewers and a submitter.
 */

import React, { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { useTimezone } from '../../../hooks/useTimezone';
import type { ThreadMessage } from '../types/suggestions';
import { formatSuggestionTime } from '../utils/suggestionTime';

interface SuggestionThreadProps {
  messages: ThreadMessage[];
  /** Absent: the thread is read-only. */
  onReply?: ((body: string) => Promise<void>) | undefined;
  /** How the other party is labelled when they have no name to show. */
  anonymousLabel?: string;
}

const MAX_REPLY_LENGTH = 5000;

const SuggestionThread: React.FC<SuggestionThreadProps> = ({ messages, onReply, anonymousLabel = 'Submitter' }) => {
  const tz = useTimezone();
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  const send = async () => {
    const body = draft.trim();
    if (!body || !onReply) return;
    setIsSending(true);
    try {
      await onReply(body);
      setDraft('');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section aria-label="Follow-up conversation" className="space-y-3">
      <h3 className="text-theme-text-secondary text-sm font-medium">Follow-up</h3>
      {messages.length === 0 ? (
        <p className="text-theme-text-muted text-sm">No follow-up messages yet.</p>
      ) : (
        <ol className="space-y-2">
          {messages.map((message) => (
            <li
              key={message.id}
              className={`rounded-md p-3 text-sm ${
                message.isMine ? 'bg-theme-surface-secondary ml-6' : 'border-theme-surface-border mr-6 border'
              }`}
            >
              <p className="text-theme-text-muted mb-1 text-xs">
                {message.isMine
                  ? 'You'
                  : message.authorName || (message.authorRole === 'reviewer' ? 'Reviewer' : anonymousLabel)}{' '}
                · {formatSuggestionTime(message.createdAt, message.timestampPrecision, tz)}
              </p>
              <p className="text-theme-text-primary whitespace-pre-wrap">{message.body}</p>
            </li>
          ))}
        </ol>
      )}
      {onReply && (
        <div className="space-y-2">
          <label htmlFor="suggestion-reply" className="form-label">
            Reply
          </label>
          <textarea
            id="suggestion-reply"
            className="form-input"
            rows={3}
            maxLength={MAX_REPLY_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 disabled:opacity-60"
            disabled={isSending || !draft.trim()}
            onClick={() => void send()}
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Send reply
          </button>
        </div>
      )}
    </section>
  );
};

export default SuggestionThread;
