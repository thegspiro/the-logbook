/**
 * EventNotificationPanel
 *
 * Allows managers to send targeted notifications (announcements, reminders,
 * follow-ups, etc.) to various audience segments for an event.
 */

import React from 'react';
import { Send } from 'lucide-react';
import { formatDateTime } from '../../utils/dateFormatting';

export type NotificationType =
  | 'announcement'
  | 'reminder'
  | 'follow_up'
  | 'missed_event'
  | 'check_in_confirmation';

export type NotificationTarget =
  | 'all'
  | 'going'
  | 'not_responded'
  | 'checked_in'
  | 'not_checked_in';

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
  { value: 'going', label: 'Going (RSVP\'d yes)' },
  { value: 'not_responded', label: 'Not responded' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'not_checked_in', label: 'Not checked in (RSVP\'d but absent)' },
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
    <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
      <h2 className="text-lg font-medium text-theme-text-primary mb-4 flex items-center gap-2">
        <Send className="h-5 w-5" />
        Notifications
      </h2>

      <div className="space-y-4">
        {/* Notification Type */}
        <div>
          <label htmlFor="notification-type" className="block text-sm font-medium text-theme-text-secondary mb-1">
            Notification Type
          </label>
          <select
            id="notification-type"
            value={notificationType}
            onChange={(e) => onNotificationTypeChange(e.target.value as NotificationType)}
            className="block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
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
          <legend className="block text-sm font-medium text-theme-text-secondary mb-2">
            Target Audience
          </legend>
          <div className="space-y-2">
            {TARGET_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center">
                <input
                  type="radio"
                  name="notification-target"
                  value={opt.value}
                  checked={notificationTarget === opt.value}
                  onChange={(e) => onNotificationTargetChange(e.target.value as NotificationTarget)}
                  className="h-4 w-4 text-blue-600 focus:ring-theme-focus-ring border-theme-surface-border"
                />
                <span className="ml-2 text-sm text-theme-text-secondary">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Custom Message */}
        <div>
          <label htmlFor="notification-message" className="block text-sm font-medium text-theme-text-secondary mb-1">
            Custom Message (optional)
          </label>
          <textarea
            id="notification-message"
            rows={3}
            maxLength={2000}
            value={notificationMessage}
            onChange={(e) => onNotificationMessageChange(e.target.value)}
            className="block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
            placeholder="Add a custom message to include with the notification..."
          />
        </div>

        {/* Send Button / Confirmation */}
        {!showNotifyConfirm ? (
          <button
            onClick={() => onShowNotifyConfirm(true)}
            disabled={sendingNotification}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-transparent rounded-md shadow-xs text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
            {sendingNotification ? 'Sending...' : 'Send Notification'}
          </button>
        ) : (
          <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3">
            <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">
              Send a <strong>{notificationType.replace(/_/g, ' ')}</strong> notification to <strong>{notificationTarget.replace(/_/g, ' ')}</strong>?
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={onSendNotification}
                disabled={sendingNotification}
                className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md disabled:opacity-50 transition-colors"
              >
                {sendingNotification ? 'Sending...' : 'Confirm & Send'}
              </button>
              <button
                onClick={() => onShowNotifyConfirm(false)}
                className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium text-theme-text-secondary bg-theme-surface-secondary hover:bg-theme-surface-hover rounded-md transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Last notification sent */}
        {lastNotification && (
          <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-3">
            <p className="text-xs font-medium text-green-800 dark:text-green-300">Last notification sent</p>
            <p className="text-xs text-green-700 dark:text-green-400 mt-1">
              {lastNotification.type.replace(/_/g, ' ')} to {lastNotification.target.replace(/_/g, ' ')} ({lastNotification.recipients} recipient{lastNotification.recipients !== 1 ? 's' : ''})
            </p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
              {formatDateTime(lastNotification.sentAt, timezone)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
