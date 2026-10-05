import React, { useId, useState } from 'react';
import { CheckCheck, ChevronDown, Loader2 } from 'lucide-react';
import { formatRelativeTime } from '../hooks/useRelativeTime';
import type { NotificationLogRecord } from '../services/adminServices';
import { describeStack } from '../utils/notificationStacks';
import NotificationCard from './NotificationCard';
import { getCategoryDisplay } from './notificationCategoryDisplay';

interface NotificationStackProps {
  category: string;
  /** The loaded rows in this category, newest first. */
  notifications: NotificationLogRecord[];
  /** Unread rows in the category, including ones on pages not yet loaded. */
  unreadCount: number;
  onMarkRead: (id: string) => void | Promise<void>;
  onTogglePin: (id: string, pinned: boolean) => void;
  onMarkStackRead: (category: string) => Promise<void>;
}

const NotificationStack: React.FC<NotificationStackProps> = ({
  category,
  notifications,
  unreadCount,
  onMarkRead,
  onTogglePin,
  onMarkStackRead,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const contentId = useId();

  const newest = notifications[0];
  const categoryDisplay = getCategoryDisplay(category);
  const loadedUnread = notifications.filter((n) => !n.read).length;
  const unloadedUnread = Math.max(0, unreadCount - loadedUnread);
  const hasUnread = unreadCount > 0;
  // The whole stack, which is never fewer than two — counting only the unread
  // rows read "1 attendance validations" once one of two had been opened. The
  // badge beside it carries the unread figure.
  const title = describeStack(category, Math.max(unreadCount, notifications.length));

  const handleMarkStackRead = async () => {
    setMarkingRead(true);
    try {
      await onMarkStackRead(category);
    } finally {
      setMarkingRead(false);
    }
  };

  return (
    <div data-testid={`notification-stack-${category}`}>
      <div
        className={`card overflow-hidden rounded-lg transition-all duration-300 ease-in-out ${hasUnread ? 'border-l-4 border-l-red-800 opacity-100' : 'border-l-4 border-l-transparent opacity-60'}`}
      >
        <div className="flex items-stretch">
          <button
            onClick={() => setIsExpanded((v) => !v)}
            className="hover:bg-theme-surface-hover min-w-0 flex-1 p-4 text-left transition-colors"
            aria-expanded={isExpanded}
            aria-controls={contentId}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className={`mt-0.5 shrink-0 ${categoryDisplay.color}`} aria-hidden="true">
                  {categoryDisplay.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm ${hasUnread ? 'text-theme-text-primary font-semibold' : 'text-theme-text-muted'}`}
                  >
                    {title}
                  </p>
                  {!isExpanded && newest && (
                    <p className="text-theme-text-muted mt-0.5 truncate text-xs">
                      Latest: {newest.subject || 'Notification'}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {hasUnread && (
                  <span className="rounded-full bg-red-800 px-2 py-0.5 text-xs font-semibold text-white">
                    {unreadCount} unread
                  </span>
                )}
                {newest && (
                  <span className="text-theme-text-muted text-xs whitespace-nowrap">
                    {formatRelativeTime(newest.sent_at)}
                  </span>
                )}
                <ChevronDown
                  className={`text-theme-text-muted h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </div>
            </div>
          </button>
          {/* A sibling of the header, not a child: a button inside a button is
              invalid HTML and the parser splits the tree. */}
          {hasUnread && (
            <button
              onClick={() => void handleMarkStackRead()}
              disabled={markingRead}
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover border-theme-surface-border touch:min-h-[44px] inline-flex shrink-0 items-center gap-1.5 border-l px-3 text-xs transition-colors disabled:opacity-50"
              aria-label={`Mark all ${title} as read`}
            >
              {markingRead ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="max-sm:sr-only">Mark all read</span>
            </button>
          )}
        </div>

        {isExpanded && (
          <div id={contentId} role="region" className="border-theme-surface-border space-y-2 border-t p-2 sm:p-3">
            {notifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                onMarkRead={onMarkRead}
                onTogglePin={onTogglePin}
              />
            ))}
            {unloadedUnread > 0 && (
              <p className="text-theme-text-muted px-1 text-xs">
                {unloadedUnread} more unread in this group {unloadedUnread === 1 ? 'is' : 'are'} further down — use Load
                more to see {unloadedUnread === 1 ? 'it' : 'them'}.
              </p>
            )}
          </div>
        )}
      </div>
      {/* The peeking edge that reads as "more than one" while collapsed. */}
      {!isExpanded && (
        <div
          className="border-theme-surface-border bg-theme-surface mx-2 h-1.5 rounded-b-lg border border-t-0"
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default NotificationStack;
