/**
 * Messages Inbox Page
 *
 * Member-facing inbox for department messages/announcements. Lists the
 * messages targeted to the current user (the backend filters by targeting).
 * A row opens the message on its own route rather than expanding in place:
 * that is what gives a message a breadcrumb back to this list, and it is
 * where reading and acknowledging now happen.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Megaphone, Pin, CheckCheck, ChevronRight, AlertCircle } from 'lucide-react';
import { Breadcrumbs, EmptyState, SkeletonPage } from '../../../components/ux';
import { messagesService } from '../../../services/api';
import type { InboxMessage } from '../../../services/adminServices';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { MESSAGE_PRIORITY_BADGE } from '../constants/messages';

const MessagesInboxPage: React.FC = () => {
  const tz = useTimezone();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeRead, setIncludeRead] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await messagesService.getInbox({ include_read: includeRead });
      setMessages(data);
    } catch {
      setError('Unable to load your messages. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [includeRead]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading) {
    return <SkeletonPage />;
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Messages' }]} />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <Megaphone className="h-6 w-6" aria-hidden="true" />
          Messages
        </h1>
        <label className="text-theme-text-secondary flex items-center gap-2 text-sm max-md:min-h-[44px]">
          <input
            type="checkbox"
            checked={includeRead}
            onChange={(e) => setIncludeRead(e.target.checked)}
            className="form-checkbox border-theme-surface-border"
          />
          Show read
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          {error}
        </div>
      )}

      {messages.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No messages"
          description="Department announcements targeted to you will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {messages.map((msg) => (
            <li key={msg.id} className={`card ${msg.is_read ? '' : 'border-l-theme-info border-l-4'}`}>
              <Link
                to={`/messages/${msg.id}`}
                className="flex w-full items-start justify-between gap-3 p-4 text-left max-md:min-h-[44px]"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {msg.is_pinned && (
                      <Pin className="text-theme-alert-info-text h-4 w-4 shrink-0" aria-label="Pinned" />
                    )}
                    <span className={`text-theme-text-primary font-semibold ${msg.is_read ? '' : 'font-bold'}`}>
                      {msg.title}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                        MESSAGE_PRIORITY_BADGE[msg.priority] ?? MESSAGE_PRIORITY_BADGE.normal
                      }`}
                    >
                      {msg.priority}
                    </span>
                  </div>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {msg.author_name ? `${msg.author_name} · ` : ''}
                    {formatDateTime(msg.created_at, tz)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {msg.is_acknowledged ? (
                    <span className="text-theme-alert-success-text flex items-center gap-1 text-xs">
                      <CheckCheck className="h-4 w-4" aria-hidden="true" />
                      Acknowledged
                    </span>
                  ) : msg.requires_acknowledgment ? (
                    <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Action needed</span>
                  ) : null}
                  <ChevronRight className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MessagesInboxPage;
