/**
 * Messages Inbox Page
 *
 * Member-facing inbox for department messages/announcements. Lists the
 * messages targeted to the current user (the backend filters by targeting),
 * marks a message read when its body is expanded, and lets the member
 * acknowledge messages that require it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Megaphone, Pin, Check, CheckCheck, Loader2, AlertCircle } from 'lucide-react';
import { Breadcrumbs, EmptyState, LinkifiedText, SkeletonPage } from '../../../components/ux';
import { messagesService } from '../../../services/api';
import type { InboxMessage } from '../../../services/adminServices';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import toast from 'react-hot-toast';

const PRIORITY_BADGE: Record<string, string> = {
  normal: 'bg-theme-surface-secondary text-theme-text-secondary',
  important: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

const MessagesInboxPage: React.FC = () => {
  const tz = useTimezone();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeRead, setIncludeRead] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

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

  const handleExpand = async (msg: InboxMessage) => {
    if (expandedId === msg.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(msg.id);
    // Mark read the first time the body is opened.
    if (!msg.is_read) {
      try {
        await messagesService.markAsRead(msg.id);
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_read: true } : m)));
      } catch {
        // Non-fatal: reading still works even if the read receipt fails.
      }
    }
  };

  const handleAcknowledge = async (msg: InboxMessage) => {
    setAcknowledging(msg.id);
    try {
      await messagesService.acknowledge(msg.id);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_acknowledged: true, is_read: true } : m)));
      toast.success('Acknowledged');
    } catch {
      toast.error('Unable to acknowledge this message. Please try again.');
    } finally {
      setAcknowledging(null);
    }
  };

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
        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
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
          {messages.map((msg) => {
            const expanded = expandedId === msg.id;
            return (
              <li
                key={msg.id}
                className={`border-theme-surface-border bg-theme-surface rounded-lg border ${
                  msg.is_read ? '' : 'border-l-theme-info border-l-4'
                }`}
              >
                <button
                  type="button"
                  onClick={() => void handleExpand(msg)}
                  aria-expanded={expanded}
                  className="flex w-full items-start justify-between gap-3 p-4 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {msg.is_pinned && <Pin className="text-theme-info h-4 w-4 shrink-0" aria-label="Pinned" />}
                      <span className={`text-theme-text-primary font-semibold ${msg.is_read ? '' : 'font-bold'}`}>
                        {msg.title}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          PRIORITY_BADGE[msg.priority] ?? PRIORITY_BADGE.normal
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
                      <span className="text-theme-success flex items-center gap-1 text-xs">
                        <CheckCheck className="h-4 w-4" aria-hidden="true" />
                        Acknowledged
                      </span>
                    ) : msg.requires_acknowledgment ? (
                      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Action needed</span>
                    ) : null}
                  </div>
                </button>

                {expanded && (
                  <div className="border-theme-surface-border border-t px-4 py-3">
                    <p className="text-theme-text-secondary text-sm whitespace-pre-wrap">
                      <LinkifiedText text={msg.body} />
                    </p>
                    {msg.requires_acknowledgment && !msg.is_acknowledged && (
                      <button
                        type="button"
                        onClick={() => void handleAcknowledge(msg)}
                        disabled={acknowledging === msg.id}
                        className="btn-info mt-3 inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {acknowledging === msg.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Check className="h-4 w-4" aria-hidden="true" />
                        )}
                        Acknowledge
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default MessagesInboxPage;
