/**
 * Event Request Status Page (Public)
 *
 * Token-based public page for community members to check
 * the status of their event request. No authentication required.
 *
 * Features:
 * - Progress stepper with status visualization
 * - Flexible date preference display
 * - Optional pipeline progress (if department enables it)
 * - Self-service cancellation
 * - Postponed state display
 */

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ClipboardList,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  Loader2,
  Pause,
} from 'lucide-react';
import { eventRequestService } from '../services/api';
import { formatDate } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import type { EventRequestPublicStatus, EventRequestStatus } from '../types/event';

const STATUS_STEPS: { key: EventRequestStatus; label: string; icon: React.ElementType }[] = [
  { key: 'submitted', label: 'Submitted', icon: ClipboardList },
  { key: 'in_progress', label: 'In Progress', icon: Clock },
  { key: 'scheduled', label: 'Scheduled', icon: Calendar },
  { key: 'completed', label: 'Completed', icon: CheckCircle },
];

const STATUS_ORDER: Record<string, number> = {
  submitted: 0,
  in_progress: 1,
  scheduled: 2,
  completed: 3,
};

const DATE_FLEXIBILITY_LABELS: Record<string, string> = {
  specific_dates: 'Specific Dates',
  general_timeframe: 'General Timeframe',
  flexible: 'Flexible',
};

const EventRequestStatusPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const tz = useTimezone();
  const [data, setData] = useState<EventRequestPublicStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outreachLabels, setOutreachLabels] = useState<Record<string, string>>({});
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!token) return;

    const fetchStatus = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await eventRequestService.checkPublicStatus(token);
        setData(result);
      } catch {
        setError('Request not found. Please check your status link and try again.');
      } finally {
        setLoading(false);
      }
    };

    void fetchStatus();
  }, [token]);

  // Fetch outreach type labels
  useEffect(() => {
    const fetchLabels = async () => {
      try {
        const labels = await eventRequestService.getOutreachTypeLabels();
        setOutreachLabels(labels);
      } catch {
        // Silently fail — we'll fall back to the raw value
      }
    };
    void fetchLabels();
  }, []);

  const getOutreachLabel = (value: string): string => {
    return outreachLabels[value] || value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const handleCancel = async () => {
    if (!token) return;
    setCancelling(true);
    try {
      await eventRequestService.publicCancelRequest(token, {
        reason: cancelReason || undefined,
      });
      // Refresh status
      const result = await eventRequestService.checkPublicStatus(token);
      setData(result);
      setShowCancelConfirm(false);
      setCancelReason('');
    } catch {
      setError('Failed to cancel request. Please try again.');
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-theme-accent-red" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-linear-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-theme-surface rounded-xl shadow-lg p-8 text-center">
          <XCircle className="w-12 h-12 text-theme-accent-red mx-auto mb-4" />
          <h1 className="text-xl font-bold text-theme-text-primary mb-2">
            Request Not Found
          </h1>
          <p className="text-theme-text-secondary">
            {error || 'Unable to find this event request.'}
          </p>
        </div>
      </div>
    );
  }

  const isTerminal = data.status === 'declined' || data.status === 'cancelled';
  const isPostponed = data.status === 'postponed';
  const currentStep = STATUS_ORDER[data.status] ?? -1;

  return (
    <div className="min-h-screen bg-linear-to-br from-theme-bg-from via-theme-bg-via to-theme-bg-to py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-theme-accent-red-muted mb-4">
            <ClipboardList className="w-8 h-8 text-theme-accent-red" />
          </div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Event Request Status
          </h1>
          <p className="mt-1 text-theme-text-secondary">
            {getOutreachLabel(data.outreach_type)} — requested by {data.contact_name}
          </p>
        </div>

        {/* Status card */}
        <div className="bg-theme-surface rounded-xl shadow-lg overflow-hidden">
          {/* Terminal states */}
          {isTerminal ? (
            <div className={`p-6 ${data.status === 'declined' ? 'bg-theme-accent-red-muted' : 'bg-theme-surface-secondary'}`}>
              <div className="flex items-center gap-3 mb-3">
                <XCircle className={`w-6 h-6 ${data.status === 'declined' ? 'text-theme-accent-red' : 'text-theme-text-muted'}`} />
                <h2 className={`text-lg font-semibold ${data.status === 'declined' ? 'text-theme-accent-red' : 'text-theme-text-secondary'}`}>
                  Request {data.status === 'declined' ? 'Declined' : 'Cancelled'}
                </h2>
              </div>
              {data.decline_reason && (
                <p className="text-sm text-theme-text-secondary mt-2">
                  {data.decline_reason}
                </p>
              )}
            </div>
          ) : isPostponed ? (
            <div className="p-6 bg-theme-accent-orange-muted">
              <div className="flex items-center gap-3 mb-3">
                <Pause className="w-6 h-6 text-theme-accent-orange" />
                <h2 className="text-lg font-semibold text-theme-accent-orange">
                  Request Postponed
                </h2>
              </div>
              <p className="text-sm text-theme-text-secondary">
                This event has been postponed. {data.event_date
                  ? `A tentative new date has been set for ${formatDate(data.event_date, tz)}.`
                  : 'A new date has not been set yet. We will notify you when it is rescheduled.'
                }
              </p>
            </div>
          ) : (
            /* Progress stepper */
            <div className="p-6">
              <div className="flex items-center justify-between">
                {STATUS_STEPS.map((step, idx) => {
                  const isActive = currentStep >= idx;
                  const isCurrent = currentStep === idx;
                  const StepIcon = step.icon;

                  return (
                    <React.Fragment key={step.key}>
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center ${
                            isCurrent
                              ? 'bg-red-600 text-white ring-4 ring-theme-accent-red-muted'
                              : isActive
                                ? 'bg-green-500 text-white'
                                : 'bg-theme-surface-hover text-theme-text-muted'
                          }`}
                        >
                          <StepIcon className="w-5 h-5" />
                        </div>
                        <span
                          className={`text-xs mt-2 font-medium ${
                            isCurrent
                              ? 'text-theme-accent-red'
                              : isActive
                                ? 'text-theme-accent-green'
                                : 'text-theme-text-muted'
                          }`}
                        >
                          {step.label}
                        </span>
                      </div>
                      {idx < STATUS_STEPS.length - 1 && (
                        <div
                          className={`flex-1 h-0.5 mx-2 ${
                            currentStep > idx
                              ? 'bg-green-500'
                              : 'bg-theme-surface-hover'
                          }`}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {/* Task progress (if department enables public visibility) */}
          {data.task_progress && !isTerminal && (
            <div className="border-t border-theme-surface-border p-6">
              <h3 className="text-sm font-semibold text-theme-text-secondary mb-3">
                Planning Progress ({data.task_progress.completed}/{data.task_progress.total})
              </h3>
              <div className="w-full bg-theme-surface-hover rounded-full h-2 mb-3">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all"
                  style={{ width: `${data.task_progress.total > 0 ? (data.task_progress.completed / data.task_progress.total) * 100 : 0}%` }}
                />
              </div>
              <div className="space-y-1">
                {data.task_progress.tasks.map((task, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    {task.completed ? (
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    ) : (
                      <div className="w-4 h-4 rounded-full border-2 border-theme-surface-border shrink-0" />
                    )}
                    <span className={task.completed ? 'text-theme-accent-green' : 'text-theme-text-secondary'}>
                      {task.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Details */}
          <div className="border-t border-theme-surface-border p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="block text-theme-text-muted mb-0.5">Submitted</span>
                <span className="text-theme-text-primary font-medium">
                  {formatDate(data.created_at, tz)}
                </span>
              </div>
              <div>
                <span className="block text-theme-text-muted mb-0.5">Last Updated</span>
                <span className="text-theme-text-primary font-medium">
                  {formatDate(data.updated_at, tz)}
                </span>
              </div>
              {data.date_flexibility && (
                <div>
                  <span className="block text-theme-text-muted mb-0.5">Date Preference</span>
                  <span className="text-theme-text-primary font-medium">
                    {DATE_FLEXIBILITY_LABELS[data.date_flexibility] || data.date_flexibility}
                  </span>
                </div>
              )}
              {data.preferred_date_start && (
                <div>
                  <span className="block text-theme-text-muted mb-0.5">Preferred Date</span>
                  <span className="text-theme-text-primary font-medium">
                    {formatDate(data.preferred_date_start, tz)}
                    {data.preferred_date_end && ` — ${formatDate(data.preferred_date_end, tz)}`}
                  </span>
                </div>
              )}
              {data.preferred_timeframe && (
                <div>
                  <span className="block text-theme-text-muted mb-0.5">Timeframe</span>
                  <span className="text-theme-text-primary font-medium">
                    {data.preferred_timeframe}
                  </span>
                </div>
              )}
              {data.event_date && !isPostponed && (
                <div>
                  <span className="block text-theme-text-muted mb-0.5">Scheduled Date</span>
                  <span className="text-theme-accent-green font-semibold">
                    {formatDate(data.event_date, tz)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Cancel action */}
          {data.can_cancel && !isTerminal && (
            <div className="border-t border-theme-surface-border p-6">
              {!showCancelConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(true)}
                  className="text-sm text-theme-text-muted hover:text-theme-accent-red transition-colors"
                >
                  Need to cancel this request?
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-theme-text-secondary font-medium">
                    Are you sure you want to cancel this request?
                  </p>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Reason for cancelling (optional)"
                    className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCancel()}
                      disabled={cancelling}
                      className="btn-primary font-medium text-sm"
                    >
                      {cancelling ? 'Cancelling...' : 'Yes, Cancel Request'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCancelConfirm(false);
                        setCancelReason('');
                      }}
                      className="px-4 py-2 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary transition-colors"
                    >
                      Never mind
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-theme-text-muted mt-8">
          You will receive email updates when your request status changes.
        </p>
      </div>
    </div>
  );
};

export default EventRequestStatusPage;
