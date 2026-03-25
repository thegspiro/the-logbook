import React, { useState, useRef, useEffect, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pin,
  PinOff,
  ChevronDown,
  Calendar,
  GraduationCap,
  Clock,
  Users,
  AlertTriangle,
  FileText,
  Wrench,
  ExternalLink,
} from 'lucide-react';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatTime } from '../utils/dateFormatting';
import { formatRelativeTime } from '../hooks/useRelativeTime';
import type { NotificationLogRecord } from '../services/adminServices';

const CATEGORY_DISPLAY: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  events: {
    icon: <Calendar className="w-4 h-4" />,
    color: 'text-blue-600 dark:text-blue-400',
    label: 'Event',
  },
  training: {
    icon: <GraduationCap className="w-4 h-4" />,
    color: 'text-purple-600 dark:text-purple-400',
    label: 'Training',
  },
  scheduling: {
    icon: <Clock className="w-4 h-4" />,
    color: 'text-violet-600 dark:text-violet-400',
    label: 'Scheduling',
  },
  members: {
    icon: <Users className="w-4 h-4" />,
    color: 'text-green-600 dark:text-green-400',
    label: 'Members',
  },
  maintenance: {
    icon: <AlertTriangle className="w-4 h-4" />,
    color: 'text-orange-600 dark:text-orange-400',
    label: 'Maintenance',
  },
  general: {
    icon: <FileText className="w-4 h-4" />,
    color: 'text-cyan-600 dark:text-cyan-400',
    label: 'General',
  },
};

function getCategoryDisplay(category: string | undefined) {
  if (!category) {
    return { icon: <Wrench className="w-4 h-4" />, color: 'text-theme-text-muted', label: 'Notification' };
  }
  return CATEGORY_DISPLAY[category] ?? {
    icon: <Wrench className="w-4 h-4" />,
    color: 'text-theme-text-muted',
    label: category.charAt(0).toUpperCase() + category.slice(1),
  };
}

function getCtaLabel(actionUrl: string | undefined, category: string | undefined): string {
  if (!actionUrl) return '';

  if (actionUrl.startsWith('/scheduling')) return 'View Shift';
  if (actionUrl.startsWith('/events')) return 'View Event';
  if (actionUrl.startsWith('/training')) return 'View Training';
  if (actionUrl.startsWith('/maintenance') || actionUrl.startsWith('/apparatus')) return 'View Details';
  if (actionUrl.startsWith('/members') || actionUrl.startsWith('/users')) return 'View Member';

  if (category === 'scheduling') return 'View Shift';
  if (category === 'events') return 'View Event';
  if (category === 'training') return 'View Training';

  return 'View Details';
}

interface NotificationCardProps {
  notification: NotificationLogRecord;
  onMarkRead: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}

const NotificationCard: React.FC<NotificationCardProps> = ({
  notification,
  onMarkRead,
  onTogglePin,
}) => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(0);
  const contentId = useId();

  const categoryDisplay = getCategoryDisplay(notification.category);
  const ctaLabel = getCtaLabel(notification.action_url, notification.category);
  const isVisuallyActive = !notification.read || notification.pinned;

  useEffect(() => {
    if (!contentRef.current) return undefined;

    if (isExpanded) {
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      const timer = setTimeout(() => setHeight(undefined), 200);
      return () => clearTimeout(timer);
    } else {
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHeight(0));
      });
      return undefined;
    }
  }, [isExpanded]);

  const handleToggle = () => {
    const willExpand = !isExpanded;
    setIsExpanded(willExpand);

    if (willExpand && !notification.read) {
      onMarkRead(notification.id);
    }
  };

  const handleNavigate = () => {
    if (notification.action_url && notification.action_url.startsWith('/')) {
      navigate(notification.action_url);
    }
  };

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(notification.id, !notification.pinned);
  };

  return (
    <div
      className={`rounded-lg transition-colors card overflow-hidden ${
        isVisuallyActive
          ? 'border-l-4 border-l-blue-500'
          : 'opacity-60'
      }`}
    >
      {/* Collapsed header — always visible */}
      <button
        onClick={handleToggle}
        className="w-full text-left p-4 hover:bg-theme-surface-hover transition-colors"
        aria-expanded={isExpanded}
        aria-controls={contentId}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className={`mt-0.5 shrink-0 ${categoryDisplay.color}`} aria-hidden="true">
              {categoryDisplay.icon}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm truncate ${isVisuallyActive ? 'font-semibold text-theme-text-primary' : 'text-theme-text-muted'}`}>
                {notification.subject || 'Notification'}
              </p>
              {!isExpanded && (
                <p className="text-xs text-theme-text-muted mt-0.5 truncate">
                  {notification.message || ''}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center shrink-0 gap-2">
            {notification.pinned && (
              <Pin className="w-3.5 h-3.5 text-orange-500" aria-label="Pinned" />
            )}
            <span className="text-xs text-theme-text-muted whitespace-nowrap">
              {formatRelativeTime(notification.sent_at)}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-theme-text-muted transition-transform duration-200 ${
                isExpanded ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </div>
        </div>
      </button>

      {/* Expandable detail area */}
      <div
        ref={contentRef}
        id={contentId}
        role="region"
        style={{ height: height !== undefined ? `${height}px` : 'auto' }}
        className="transition-[height] duration-200 ease-in-out overflow-hidden"
      >
        <div className="px-4 pb-4 border-t border-theme-surface-border">
          {/* Full message */}
          <div className="pt-3 pb-3">
            <p className="text-sm text-theme-text-secondary whitespace-pre-line">
              {notification.message || 'No additional details.'}
            </p>
          </div>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-text-muted pb-3">
            <span className={`inline-flex items-center gap-1 ${categoryDisplay.color}`}>
              {categoryDisplay.icon}
              {categoryDisplay.label}
            </span>
            <span>
              {formatDate(notification.sent_at, tz)} at {formatTime(notification.sent_at, tz)}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {notification.action_url && (
              <button
                onClick={handleNavigate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                {ctaLabel}
              </button>
            )}
            <button
              onClick={handlePinClick}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                notification.pinned
                  ? 'border-orange-300 dark:border-orange-600 text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                  : 'border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
              }`}
              title={notification.pinned ? 'Unpin notification' : 'Pin notification'}
            >
              {notification.pinned ? (
                <>
                  <PinOff className="w-3.5 h-3.5" aria-hidden="true" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                  Pin
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationCard;
