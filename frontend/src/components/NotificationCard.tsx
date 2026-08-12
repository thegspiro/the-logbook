import React, { useState, useRef, useEffect, useId } from 'react';
import { useNavigate } from 'react-router';
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
  ClipboardCheck,
  ArrowLeftRight,
} from 'lucide-react';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatTime } from '../utils/dateFormatting';
import { formatRelativeTime } from '../hooks/useRelativeTime';
import type { NotificationLogRecord } from '../services/adminServices';

const CATEGORY_DISPLAY: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  events: {
    icon: <Calendar className="h-4 w-4" />,
    color: 'text-blue-600 dark:text-blue-400',
    label: 'Event',
  },
  training: {
    icon: <GraduationCap className="h-4 w-4" />,
    color: 'text-purple-600 dark:text-purple-400',
    label: 'Training',
  },
  scheduling: {
    icon: <Clock className="h-4 w-4" />,
    color: 'text-violet-600 dark:text-violet-400',
    label: 'Scheduling',
  },
  members: {
    icon: <Users className="h-4 w-4" />,
    color: 'text-green-600 dark:text-green-400',
    label: 'Members',
  },
  maintenance: {
    icon: <AlertTriangle className="h-4 w-4" />,
    color: 'text-orange-600 dark:text-orange-400',
    label: 'Maintenance',
  },
  general: {
    icon: <FileText className="h-4 w-4" />,
    color: 'text-cyan-600 dark:text-cyan-400',
    label: 'General',
  },
};

// NotificationLog.category is free-form text written by whichever task raised the
// notification, so it carries far more values than CATEGORY_DISPLAY's six groups
// ("event_reminder", "shift_checkout_reminder", "series_end_reminder", …). Map the
// ones we ship onto a group so they get the right icon rather than a wrench.
const CATEGORY_ALIASES: Record<string, string> = {
  event_reminder: 'events',
  event_update: 'events',
  event_validation: 'events',
  series_end_reminder: 'events',
  shift_reminder: 'scheduling',
  shift_validation: 'scheduling',
  shift_summary: 'scheduling',
  shift_swap: 'scheduling',
  shift_assignment: 'scheduling',
  shift_confirmation: 'scheduling',
  shift_cancelled: 'scheduling',
  shift_decline: 'scheduling',
  shift_finalized: 'scheduling',
  shift_checkout_reminder: 'scheduling',
  shift_report_followup: 'scheduling',
  time_off: 'scheduling',
  equipment_check: 'maintenance',
  inventory: 'maintenance',
  action_items: 'general',
  minutes: 'general',
  meetings: 'general',
};

function getCategoryDisplay(category: string | undefined) {
  if (!category) {
    return { icon: <Wrench className="h-4 w-4" />, color: 'text-theme-text-muted', label: 'Notification' };
  }
  const known = CATEGORY_DISPLAY[category] ?? CATEGORY_DISPLAY[CATEGORY_ALIASES[category] ?? ''];
  if (known) return known;
  return {
    icon: <Wrench className="h-4 w-4" />,
    color: 'text-theme-text-muted',
    // Humanize rather than print the raw token: an unmapped category used to
    // reach the member as "Event_reminder", underscore and all.
    label: category
      .split('_')
      .filter(Boolean)
      .map((word) => (word[0] ?? '').toUpperCase() + word.slice(1))
      .join(' '),
  };
}

interface CtaAction {
  label: string;
  icon: React.ReactNode;
  url: string;
}

function isChecklistWindowActive(metadata: Record<string, unknown> | undefined): boolean {
  const now = Date.now();
  const hours24 = 24 * 60 * 60 * 1000;
  const hours2 = 2 * 60 * 60 * 1000;

  const endTime = metadata?.shift_end_time;
  if (typeof endTime === 'string') {
    const shiftEnd = new Date(endTime).getTime();
    if (!Number.isNaN(shiftEnd) && now >= shiftEnd - hours2 && now <= shiftEnd + hours2) {
      return true;
    }
  }

  const startTime = metadata?.shift_start_time;
  if (typeof startTime === 'string') {
    const shiftStart = new Date(startTime).getTime();
    if (!Number.isNaN(shiftStart) && now >= shiftStart - hours24 && now <= shiftStart + hours2) {
      return true;
    }
  }

  return false;
}

function getCtaActions(notification: NotificationLogRecord): CtaAction[] {
  const actions: CtaAction[] = [];
  const { action_url: actionUrl, category, subject, metadata } = notification;

  if (!actionUrl) return actions;

  const subjectLower = (subject || '').toLowerCase();

  // Shift reminder — offer "View Shift" and conditionally "Start Checklist"
  if (category === 'shift_reminder') {
    actions.push({
      label: 'View Shift',
      icon: <ExternalLink className="h-3.5 w-3.5" />,
      url: actionUrl,
    });
    if (isChecklistWindowActive(metadata)) {
      actions.push({
        label: 'Start Checklist',
        icon: <ClipboardCheck className="h-3.5 w-3.5" />,
        url: '/scheduling?tab=equipment-checks',
      });
    }
    return actions;
  }

  // Post-shift validation — offer "View Shift", optionally "Start Checklist" and "File Report"
  if (category === 'shift_validation') {
    actions.push({
      label: 'View Shift',
      icon: <ExternalLink className="h-3.5 w-3.5" />,
      url: actionUrl,
    });
    if (isChecklistWindowActive(metadata)) {
      actions.push({
        label: 'Start Checklist',
        icon: <ClipboardCheck className="h-3.5 w-3.5" />,
        url: '/scheduling?tab=equipment-checks',
      });
    }
    const shiftId = typeof metadata?.shift_id === 'string' ? metadata.shift_id : '';
    if (shiftId) {
      actions.push({
        label: 'File Report',
        icon: <FileText className="h-3.5 w-3.5" />,
        url: `/scheduling?tab=shift-reports&shift=${shiftId}`,
      });
    }
    return actions;
  }

  // Shift swap — offer "Review Swap"
  if (category === 'shift_swap' && subjectLower.includes('request')) {
    actions.push({
      label: 'Review Swap',
      icon: <ArrowLeftRight className="h-3.5 w-3.5" />,
      url: actionUrl,
    });
    return actions;
  }

  // Default: single CTA based on URL/category
  let label = 'View Details';
  if (actionUrl.startsWith('/scheduling')) label = 'View Shift';
  else if (actionUrl.startsWith('/events')) label = 'View Event';
  else if (actionUrl.startsWith('/training')) label = 'View Training';
  else if (actionUrl.startsWith('/maintenance') || actionUrl.startsWith('/apparatus')) label = 'View Details';
  else if (actionUrl.startsWith('/members') || actionUrl.startsWith('/users')) label = 'View Member';
  else if (category === 'scheduling') label = 'View Shift';
  else if (category === 'events') label = 'View Event';
  else if (category === 'training') label = 'View Training';

  actions.push({
    label,
    icon: <ExternalLink className="h-3.5 w-3.5" />,
    url: actionUrl,
  });

  return actions;
}

interface NotificationCardProps {
  notification: NotificationLogRecord;
  onMarkRead: (id: string) => void;
  onTogglePin: (id: string, pinned: boolean) => void;
}

const NotificationCard: React.FC<NotificationCardProps> = ({ notification, onMarkRead, onTogglePin }) => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(0);
  const contentId = useId();

  const categoryDisplay = getCategoryDisplay(notification.category);
  const ctaActions = getCtaActions(notification);
  // Stay visually active while expanded for the first time, or if pinned
  const isVisuallyActive = !notification.read || notification.pinned || (isExpanded && !hasBeenOpened);

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

    // Mark as read when the user collapses after their first open
    if (!willExpand && !hasBeenOpened && !notification.read) {
      setHasBeenOpened(true);
      onMarkRead(notification.id);
    }
  };

  const handleNavigate = (url: string) => {
    if (url.startsWith('/')) {
      void navigate(url);
    }
  };

  const handlePinClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin(notification.id, !notification.pinned);
  };

  return (
    <div
      className={`card overflow-hidden rounded-lg transition-all duration-300 ease-in-out ${
        isVisuallyActive ? 'border-l-4 border-l-blue-500 opacity-100' : 'border-l-4 border-l-transparent opacity-60'
      }`}
    >
      {/* Collapsed header — always visible */}
      <button
        onClick={handleToggle}
        className="hover:bg-theme-surface-hover w-full p-4 text-left transition-colors"
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
                className={`truncate text-sm transition-all duration-300 ${isVisuallyActive ? 'text-theme-text-primary font-semibold' : 'text-theme-text-muted'}`}
              >
                {notification.subject || 'Notification'}
              </p>
              {!isExpanded && (
                <p className="text-theme-text-muted mt-0.5 truncate text-xs">{notification.message || ''}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {notification.pinned && <Pin className="h-3.5 w-3.5 text-orange-500" aria-label="Pinned" />}
            <span className="text-theme-text-muted text-xs whitespace-nowrap">
              {formatRelativeTime(notification.sent_at)}
            </span>
            <ChevronDown
              className={`text-theme-text-muted h-4 w-4 transition-transform duration-200 ${
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
        className="overflow-hidden transition-[height] duration-200 ease-in-out"
      >
        <div className="border-theme-surface-border border-t px-4 pb-4">
          {/* Full message */}
          <div className="pt-3 pb-3">
            <p className="text-theme-text-secondary text-sm whitespace-pre-line">
              {notification.message || 'No additional details.'}
            </p>
          </div>

          {/* Metadata row */}
          <div className="text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 text-xs">
            <span className={`inline-flex items-center gap-1 ${categoryDisplay.color}`}>
              {categoryDisplay.icon}
              {categoryDisplay.label}
            </span>
            <span>
              {formatDate(notification.sent_at, tz)} at {formatTime(notification.sent_at, tz)}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {ctaActions.map((action, idx) => (
              <button
                key={action.label}
                onClick={() => handleNavigate(action.url)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors max-md:min-h-[44px] ${
                  idx === 0
                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                    : 'border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover border'
                }`}
              >
                <span aria-hidden="true">{action.icon}</span>
                {action.label}
              </button>
            ))}
            <button
              onClick={handlePinClick}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors max-md:min-h-[44px] ${
                notification.pinned
                  ? 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-600 dark:bg-orange-900/20 dark:text-orange-400 dark:hover:bg-orange-900/30'
                  : 'border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover'
              }`}
              title={notification.pinned ? 'Unpin notification' : 'Pin notification'}
            >
              {notification.pinned ? (
                <>
                  <PinOff className="h-3.5 w-3.5" aria-hidden="true" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="h-3.5 w-3.5" aria-hidden="true" />
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
