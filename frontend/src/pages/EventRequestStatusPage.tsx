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
import { useParams } from 'react-router';
import { ClipboardList, Clock, CheckCircle, XCircle, Calendar, Loader2, Pause } from 'lucide-react';
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
      <div
        className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="text-theme-accent-red h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br px-4">
        <div className="bg-theme-surface w-full max-w-md rounded-xl p-8 text-center shadow-lg">
          <XCircle className="text-theme-accent-red mx-auto mb-4 h-12 w-12" />
          <h1 className="text-theme-text-primary mb-2 text-xl font-bold">Request Not Found</h1>
          <p className="text-theme-text-secondary">{error || 'Unable to find this event request.'}</p>
        </div>
      </div>
    );
  }

  const isTerminal = data.status === 'declined' || data.status === 'cancelled';
  const isPostponed = data.status === 'postponed';
  const currentStep = STATUS_ORDER[data.status] ?? -1;

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br px-4 py-12">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="bg-theme-accent-red-muted mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full">
            <ClipboardList className="text-theme-accent-red h-8 w-8" />
          </div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Event Request Status</h1>
          <p className="text-theme-text-secondary mt-1">
            {getOutreachLabel(data.outreach_type)} — requested by {data.contact_name}
          </p>
        </div>

        {/* Status card */}
        <div className="bg-theme-surface overflow-hidden rounded-xl shadow-lg">
          {/* Terminal states */}
          {isTerminal ? (
            <div
              className={`p-6 ${data.status === 'declined' ? 'bg-theme-accent-red-muted' : 'bg-theme-surface-secondary'}`}
            >
              <div className="mb-3 flex items-center gap-3">
                <XCircle
                  className={`h-6 w-6 ${data.status === 'declined' ? 'text-theme-accent-red' : 'text-theme-text-muted'}`}
                />
                <h2
                  className={`text-lg font-semibold ${data.status === 'declined' ? 'text-theme-accent-red' : 'text-theme-text-secondary'}`}
                >
                  Request {data.status === 'declined' ? 'Declined' : 'Cancelled'}
                </h2>
              </div>
              {data.decline_reason && <p className="text-theme-text-secondary mt-2 text-sm">{data.decline_reason}</p>}
            </div>
          ) : isPostponed ? (
            <div className="bg-theme-accent-orange-muted p-6">
              <div className="mb-3 flex items-center gap-3">
                <Pause className="text-theme-accent-orange h-6 w-6" />
                <h2 className="text-theme-accent-orange text-lg font-semibold">Request Postponed</h2>
              </div>
              <p className="text-theme-text-secondary text-sm">
                This event has been postponed.{' '}
                {data.event_date
                  ? `A tentative new date has been set for ${formatDate(data.event_date, tz)}.`
                  : 'A new date has not been set yet. We will notify you when it is rescheduled.'}
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
                          className={`flex h-10 w-10 items-center justify-center rounded-full ${
                            isCurrent
                              ? 'ring-theme-accent-red-muted bg-red-600 text-white ring-4'
                              : isActive
                                ? 'bg-green-500 text-white'
                                : 'bg-theme-surface-hover text-theme-text-muted'
                          }`}
                        >
                          <StepIcon className="h-5 w-5" />
                        </div>
                        <span
                          className={`mt-2 text-xs font-medium ${
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
                          className={`mx-2 h-0.5 flex-1 ${
                            currentStep > idx ? 'bg-green-500' : 'bg-theme-surface-hover'
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
            <div className="border-theme-surface-border border-t p-6">
              <h3 className="text-theme-text-secondary mb-3 text-sm font-semibold">
                Planning Progress ({data.task_progress.completed}/{data.task_progress.total})
              </h3>
              <div className="bg-theme-surface-hover mb-3 h-2 w-full rounded-full">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{
                    width: `${data.task_progress.total > 0 ? (data.task_progress.completed / data.task_progress.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="space-y-1">
                {data.task_progress.tasks.map((task, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    {task.completed ? (
                      <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
                    ) : (
                      <div className="border-theme-surface-border h-4 w-4 shrink-0 rounded-full border-2" />
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
          <div className="border-theme-surface-border space-y-4 border-t p-6">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-theme-text-muted mb-0.5 block">Submitted</span>
                <span className="text-theme-text-primary font-medium">{formatDate(data.created_at, tz)}</span>
              </div>
              <div>
                <span className="text-theme-text-muted mb-0.5 block">Last Updated</span>
                <span className="text-theme-text-primary font-medium">{formatDate(data.updated_at, tz)}</span>
              </div>
              {data.date_flexibility && (
                <div>
                  <span className="text-theme-text-muted mb-0.5 block">Date Preference</span>
                  <span className="text-theme-text-primary font-medium">
                    {DATE_FLEXIBILITY_LABELS[data.date_flexibility] || data.date_flexibility}
                  </span>
                </div>
              )}
              {data.preferred_date_start && (
                <div>
                  <span className="text-theme-text-muted mb-0.5 block">Preferred Date</span>
                  <span className="text-theme-text-primary font-medium">
                    {formatDate(data.preferred_date_start, tz)}
                    {data.preferred_date_end && ` — ${formatDate(data.preferred_date_end, tz)}`}
                  </span>
                </div>
              )}
              {data.preferred_timeframe && (
                <div>
                  <span className="text-theme-text-muted mb-0.5 block">Timeframe</span>
                  <span className="text-theme-text-primary font-medium">{data.preferred_timeframe}</span>
                </div>
              )}
              {data.event_date && !isPostponed && (
                <div>
                  <span className="text-theme-text-muted mb-0.5 block">Scheduled Date</span>
                  <span className="text-theme-accent-green font-semibold">{formatDate(data.event_date, tz)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Cancel action */}
          {data.can_cancel && !isTerminal && (
            <div className="border-theme-surface-border border-t p-6">
              {!showCancelConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(true)}
                  className="text-theme-text-muted hover:text-theme-accent-red text-sm transition-colors"
                >
                  Need to cancel this request?
                </button>
              ) : (
                <div className="space-y-3">
                  <p className="text-theme-text-secondary text-sm font-medium">
                    Are you sure you want to cancel this request?
                  </p>
                  <input
                    type="text"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Reason for cancelling (optional)"
                    className="form-input"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCancel()}
                      disabled={cancelling}
                      className="btn-primary text-sm font-medium"
                    >
                      {cancelling ? 'Cancelling...' : 'Yes, Cancel Request'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCancelConfirm(false);
                        setCancelReason('');
                      }}
                      className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 text-sm font-medium transition-colors"
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
        <p className="text-theme-text-muted mt-8 text-center text-xs">
          You will receive email updates when your request status changes.
        </p>
      </div>
    </div>
  );
};

export default EventRequestStatusPage;
