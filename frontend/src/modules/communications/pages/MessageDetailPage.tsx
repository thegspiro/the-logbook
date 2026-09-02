/**
 * Message Detail Page
 *
 * Member-facing view of a single department message. Opening a message from
 * the inbox or the dashboard feed navigates here rather than expanding the
 * body in place, so the message has a URL that can be linked to and — the
 * reason it exists — a breadcrumb back to the full inbox. Previously the only
 * route back to "all messages" was the dashboard.
 *
 * Visibility is enforced server-side: GET /messages/inbox/{id} runs the same
 * targeting gate as the inbox list, so a guessed id 404s rather than
 * revealing a message the member was never sent.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertCircle, ArrowLeft, Check, CheckCheck, Loader2, Megaphone, Pin } from 'lucide-react';
import { Breadcrumbs, EmptyState, LinkifiedText, SkeletonPage } from '../../../components/ux';
import { messagesService } from '../../../services/api';
import type { InboxMessage } from '../../../services/adminServices';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { MESSAGE_PRIORITY_BADGE } from '../constants/messages';
import toast from 'react-hot-toast';

const MessageDetailPage: React.FC = () => {
  const { messageId } = useParams<{ messageId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();
  const [message, setMessage] = useState<InboxMessage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAcknowledging, setIsAcknowledging] = useState(false);

  const load = useCallback(async () => {
    if (!messageId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await messagesService.getInboxMessage(messageId);
      setMessage(data);
      // Opening the message is what marks it read — the same trigger the
      // inbox used when its rows expanded in place.
      if (!data.is_read) {
        try {
          await messagesService.markAsRead(data.id);
          setMessage((prev) => (prev ? { ...prev, is_read: true } : prev));
        } catch {
          // Non-fatal: reading still works even if the read receipt fails.
        }
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load this message. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  }, [messageId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAcknowledge = async () => {
    if (!message) return;
    setIsAcknowledging(true);
    try {
      await messagesService.acknowledge(message.id);
      setMessage((prev) => (prev ? { ...prev, is_acknowledged: true, is_read: true } : prev));
      toast.success('Acknowledged');
    } catch {
      toast.error('Unable to acknowledge this message. Please try again.');
    } finally {
      setIsAcknowledging(false);
    }
  };

  if (isLoading) {
    return <SkeletonPage />;
  }

  if (error || !message) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <Breadcrumbs items={[{ label: 'Messages', path: '/messages' }, { label: 'Message' }]} />
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300"
        >
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          {error || 'This message is no longer available.'}
        </div>
        <EmptyState
          icon={Megaphone}
          title="Message unavailable"
          description="It may have expired or been removed. Your other messages are still in your inbox."
          actions={[{ label: 'Back to Messages', onClick: () => void navigate('/messages') }]}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Messages', path: '/messages' }, { label: message.title }]} />

      {/* The breadcrumb is the canonical path back; this repeats it as a
          full-width target because on a phone the crumb sits above a long
          title and is easy to miss. */}
      <Link
        to="/messages"
        className="text-theme-text-secondary hover:text-theme-text-primary mb-4 inline-flex items-center gap-1.5 text-sm max-md:min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All messages
      </Link>

      <article className="card p-4 sm:p-6">
        <header className="border-theme-surface-border border-b pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {message.is_pinned && <Pin className="text-theme-alert-info-text h-4 w-4 shrink-0" aria-label="Pinned" />}
            <h1 className="text-theme-text-primary text-xl font-bold sm:text-2xl">{message.title}</h1>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                MESSAGE_PRIORITY_BADGE[message.priority] ?? MESSAGE_PRIORITY_BADGE.normal
              }`}
            >
              {message.priority}
            </span>
          </div>
          <p className="text-theme-text-muted mt-1 text-sm">
            {message.author_name ? `${message.author_name} · ` : ''}
            {formatDateTime(message.created_at, tz)}
          </p>
        </header>

        <p className="text-theme-text-secondary mt-4 text-sm whitespace-pre-wrap">
          <LinkifiedText text={message.body} />
        </p>

        {message.requires_acknowledgment && (
          <div className="border-theme-surface-border mt-6 border-t pt-4">
            {message.is_acknowledged ? (
              <span className="text-theme-alert-success-text flex items-center gap-1.5 text-sm font-medium">
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
                Acknowledged
                {message.acknowledged_at ? ` on ${formatDateTime(message.acknowledged_at, tz)}` : ''}
              </span>
            ) : (
              <>
                <p className="text-theme-text-secondary mb-3 text-sm">
                  This message needs your acknowledgement before it clears from your inbox.
                </p>
                <button
                  type="button"
                  onClick={() => void handleAcknowledge()}
                  disabled={isAcknowledging}
                  className="btn-info inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 max-md:min-h-[44px]"
                >
                  {isAcknowledging ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  )}
                  Acknowledge
                </button>
              </>
            )}
          </div>
        )}
      </article>
    </div>
  );
};

export default MessageDetailPage;
