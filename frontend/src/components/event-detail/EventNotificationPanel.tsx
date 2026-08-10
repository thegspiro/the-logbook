/**
 * EventNotificationPanel
 *
 * Allows managers to send targeted notifications (announcements, reminders,
 * follow-ups, etc.) to various audience segments for an event.
 */

import React from 'react';
import { Send } from 'lucide-react';
import { formatDateTime } from '../../utils/dateFormatting';

export type NotificationType = 'announcement' | 'reminder' | 'follow_up' | 'missed_event' | 'check_in_confirmation';

export type NotificationTarget = 'all' | 'going' | 'not_responded' | 'checked_in' | 'not_checked_in';

export interface LastNotificationInfo {
  type: string;
  target: string;
  recipients: number;
  sentAt: string;
}

export interface EventNotificationPanelProps {
  notificationType: NotificationType;
  onNotificationTypeChange: (value: NotificationType) => void;
  notificationTarget: NotificationTarget;
  onNotificationTargetChange: (value: NotificationTarget) => void;
  notificationMessage: string;
  onNotificationMessageChange: (value: string) => void;
  sendingNotification: boolean;
  showNotifyConfirm: boolean;
  onShowNotifyConfirm: (value: boolean) => void;
  onSendNotification: () => void;
  lastNotification: LastNotificationInfo | null;
  timezone: string;
}

const TARGET_OPTIONS = [
  { value: 'all', label: 'All members' },
  { value: 'going', label: "Going (RSVP'd yes)" },
  { value: 'not_responded', label: 'Not responded' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'not_checked_in', label: "Not checked in (RSVP'd but absent)" },
] as const;

export const EventNotificationPanel: React.FC<EventNotificationPanelProps> = ({
  notificationType,
  onNotificationTypeChange,
  notificationTarget,
  onNotificationTargetChange,
  notificationMessage,
  onNotificationMessageChange,
  sendingNotification,
  showNotifyConfirm,
  onShowNotifyConfirm,
  onSendNotification,
  lastNotification,
  timezone,
}) => {
  return (
    <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
      <h2 className="text-theme-text-primary mb-4 flex items-center gap-2 text-lg font-medium">
        <Send className="h-5 w-5" />
        Notifications
      </h2>

      <div className="space-y-4">
        {/* Notification Type */}
        <div>
          <label htmlFor="notification-type" className="text-theme-text-secondary mb-1 block text-sm font-medium">
            Notification Type
          </label>
          <select
            id="notification-type"
            value={notificationType}
            onChange={(e) => onNotificationTypeChange(e.target.value as NotificationType)}
            className="form-input shadow-xs sm:text-sm"
          >
            <option value="announcement">Announcement</option>
            <option value="reminder">Pre-Event Reminder</option>
            <option value="follow_up">Post-Event Follow-Up</option>
            <option value="missed_event">Missed Event Notice</option>
            <option value="check_in_confirmation">Check-In Confirmation</option>
          </select>
        </div>

        {/* Target Audience */}
        <fieldset>
          <legend className="text-theme-text-secondary mb-2 block text-sm font-medium">Target Audience</legend>
          <div className="space-y-2">
            {TARGET_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center">
                <input
                  type="radio"
                  name="notification-target"
                  value={opt.value}
                  checked={notificationTarget === opt.value}
                  onChange={(e) => onNotificationTargetChange(e.target.value as NotificationTarget)}
                  className="focus:ring-theme-focus-ring border-theme-surface-border h-4 w-4 text-blue-600"
                />
                <span className="text-theme-text-secondary ml-2 text-sm">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Custom Message */}
        <div>
          <label htmlFor="notification-message" className="text-theme-text-secondary mb-1 block text-sm font-medium">
            Custom Message (optional)
          </label>
          <textarea
            id="notification-message"
            rows={3}
            maxLength={2000}
            value={notificationMessage}
            onChange={(e) => onNotificationMessageChange(e.target.value)}
            className="form-input shadow-xs sm:text-sm"
            placeholder="Add a custom message to include with the notification..."
          />
        </div>

        {/* Send Button / Confirmation */}
        {!showNotifyConfirm ? (
          <button
            onClick={() => onShowNotifyConfirm(true)}
            disabled={sendingNotification}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-transparent bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {sendingNotification ? 'Sending...' : 'Send Notification'}
          </button>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
            <p className="mb-3 text-sm text-amber-800 dark:text-amber-300">
              Send a <strong>{notificationType.replace(/_/g, ' ')}</strong> notification to{' '}
              <strong>{notificationTarget.replace(/_/g, ' ')}</strong>?
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={onSendNotification}
                disabled={sendingNotification}
                className="inline-flex flex-1 items-center justify-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {sendingNotification ? 'Sending...' : 'Confirm & Send'}
              </button>
              <button
                onClick={() => onShowNotifyConfirm(false)}
                className="text-theme-text-secondary bg-theme-surface-secondary hover:bg-theme-surface-hover inline-flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Last notification sent */}
        {lastNotification && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 dark:border-green-700 dark:bg-green-900/20">
            <p className="text-xs font-medium text-green-800 dark:text-green-300">Last notification sent</p>
            <p className="mt-1 text-xs text-green-700 dark:text-green-400">
              {lastNotification.type.replace(/_/g, ' ')} to {lastNotification.target.replace(/_/g, ' ')} (
              {lastNotification.recipients} recipient{lastNotification.recipients !== 1 ? 's' : ''})
            </p>
            <p className="mt-0.5 text-xs text-green-600 dark:text-green-500">
              {formatDateTime(lastNotification.sentAt, timezone)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
