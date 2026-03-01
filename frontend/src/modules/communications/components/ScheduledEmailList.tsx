/**
 * Scheduled Email List Component
 *
 * Displays a list of scheduled emails with status and actions.
 */

import React, { useEffect } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Trash2,
  XCircle,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useScheduledEmailsStore } from '../store/scheduledEmailsStore';

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  pending: { icon: Clock, color: 'text-yellow-500', label: 'Pending' },
  sent: { icon: CheckCircle2, color: 'text-green-500', label: 'Sent' },
  failed: { icon: AlertTriangle, color: 'text-red-500', label: 'Failed' },
  cancelled: { icon: XCircle, color: 'text-gray-400', label: 'Cancelled' },
};

const ScheduledEmailList: React.FC = () => {
  const {
    scheduledEmails,
    isLoading,
    fetchScheduledEmails,
    cancelScheduledEmail,
    isSaving,
  } = useScheduledEmailsStore();

  useEffect(() => {
    void fetchScheduledEmails();
  }, [fetchScheduledEmails]);

  const handleCancel = async (id: string) => {
    try {
      await cancelScheduledEmail(id);
      toast.success('Scheduled email cancelled');
    } catch {
      // Error handled by store
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-5 w-5 animate-spin text-theme-text-secondary" />
        <span className="ml-2 text-sm text-theme-text-secondary">
          Loading scheduled emails...
        </span>
      </div>
    );
  }

  if (scheduledEmails.length === 0) {
    return (
      <div className="py-8 text-center">
        <CalendarClock className="mx-auto h-10 w-10 text-theme-text-secondary opacity-50" />
        <p className="mt-2 text-sm text-theme-text-secondary">
          No scheduled emails yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {scheduledEmails.map((email) => {
        const fallback = STATUS_CONFIG['pending'] as typeof STATUS_CONFIG[string];
        const statusInfo = STATUS_CONFIG[email.status] ?? fallback;
        const StatusIcon = statusInfo.icon;

        return (
          <div
            key={email.id}
            className="flex items-center justify-between rounded-lg border border-theme-surface-border bg-theme-surface p-4"
          >
            <div className="flex items-start gap-3">
              <StatusIcon className={`mt-0.5 h-5 w-5 ${statusInfo.color}`} />
              <div>
                <div className="text-sm font-medium text-theme-text-primary">
                  {email.template_type
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
                </div>
                <div className="mt-0.5 text-xs text-theme-text-secondary">
                  To: {email.to_emails.join(', ')}
                </div>
                <div className="mt-0.5 text-xs text-theme-text-secondary">
                  <CalendarClock className="mr-1 inline h-3 w-3" />
                  {formatDate(email.scheduled_at)}
                </div>
                {email.error_message && (
                  <div className="mt-1 text-xs text-red-500">
                    {email.error_message}
                  </div>
                )}
                {email.sent_at && (
                  <div className="mt-0.5 text-xs text-green-600">
                    Sent: {formatDate(email.sent_at)}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  email.status === 'pending'
                    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                    : email.status === 'sent'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                      : email.status === 'failed'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {statusInfo.label}
              </span>
              {email.status === 'pending' && (
                <button
                  onClick={() => void handleCancel(email.id)}
                  disabled={isSaving}
                  className="rounded p-1 text-red-500 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/20"
                  title="Cancel"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ScheduledEmailList;
