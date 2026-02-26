/**
 * Event Requests Tab
 *
 * Displays the event request pipeline for public outreach event coordination.
 * Shows a flexible task-based workflow where departments can complete checklist
 * items in any order. Supports fuzzy date preferences and configurable pipeline tasks.
 *
 * Shown within the Events Admin Hub.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ClipboardList,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  Eye,
  ChevronDown,
  ChevronUp,
  Users,
  MapPin,
  Loader2,
  Square,
  CheckSquare,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService, eventRequestService } from '../services/api';
import type {
  EventRequestListItem,
  EventRequest,
  EventRequestStatus,
  PipelineTaskConfig,
  TaskCompletion,
  DateFlexibility,
} from '../types/event';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime } from '../utils/dateFormatting';

const STATUS_CONFIG: Record<
  EventRequestStatus,
  { label: string; color: string; icon: React.ElementType }
> = {
  submitted: {
    label: 'Submitted',
    color: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
    icon: ClipboardList,
  },
  in_progress: {
    label: 'In Progress',
    color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
    icon: Clock,
  },
  scheduled: {
    label: 'Scheduled',
    color: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400',
    icon: Calendar,
  },
  declined: {
    label: 'Declined',
    color: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
    icon: XCircle,
  },
  cancelled: {
    label: 'Cancelled',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-300',
    icon: XCircle,
  },
  completed: {
    label: 'Completed',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400',
    icon: CheckCircle,
  },
};

const STATUS_FILTERS: EventRequestStatus[] = [
  'submitted',
  'in_progress',
  'scheduled',
  'declined',
  'cancelled',
  'completed',
];

const DATE_FLEXIBILITY_LABELS: Record<DateFlexibility, string> = {
  specific_dates: 'Has specific dates',
  general_timeframe: 'General timeframe',
  flexible: 'Flexible',
};

const EventRequestsTab: React.FC = () => {
  const [requests, setRequests] = useState<EventRequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<EventRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [outreachLabels, setOutreachLabels] = useState<Record<string, string>>({});
  const [pipelineTasks, setPipelineTasks] = useState<PipelineTaskConfig[]>([]);
  const tz = useTimezone();

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const data = await eventRequestService.listRequests(params);
      setRequests(data);
    } catch {
      setError('Failed to load event requests.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  // Fetch outreach type labels and pipeline tasks from settings
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [labels, settings] = await Promise.all([
          eventRequestService.getOutreachTypeLabels(),
          eventService.getModuleSettings(),
        ]);
        setOutreachLabels(labels);
        setPipelineTasks(settings.request_pipeline?.tasks || []);
      } catch {
        // Silently fail — we'll fall back to defaults
      }
    };
    void fetchConfig();
  }, []);

  const getOutreachLabel = (value: string): string => {
    return outreachLabels[value] || value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }

    setExpandedId(id);
    setDetailLoading(true);
    try {
      const detail = await eventRequestService.getRequest(id);
      setExpandedDetail(detail);
    } catch {
      toast.error('Failed to load request details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleStatusChange = async (
    requestId: string,
    newStatus: EventRequestStatus,
    notes?: string,
    declineReasonValue?: string
  ) => {
    setActionLoading(true);
    try {
      await eventRequestService.updateRequestStatus(requestId, {
        status: newStatus,
        notes: notes || undefined,
        decline_reason: declineReasonValue || undefined,
      });
      toast.success(`Request ${STATUS_CONFIG[newStatus].label.toLowerCase()}.`);
      setDeclineReason('');
      setReviewNotes('');
      void fetchRequests();
      if (expandedId === requestId) {
        const detail = await eventRequestService.getRequest(requestId);
        setExpandedDetail(detail);
      }
    } catch {
      toast.error('Failed to update request status.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTaskToggle = async (requestId: string, taskId: string, currentlyCompleted: boolean) => {
    setActionLoading(true);
    try {
      const result = await eventRequestService.updateTaskCompletion(requestId, {
        task_id: taskId,
        completed: !currentlyCompleted,
      });
      // Update local state
      if (expandedDetail && expandedDetail.id === requestId) {
        setExpandedDetail({
          ...expandedDetail,
          task_completions: result.task_completions as Record<string, TaskCompletion>,
          status: result.status as EventRequestStatus,
        });
      }
      void fetchRequests();
    } catch {
      toast.error('Failed to update task.');
    } finally {
      setActionLoading(false);
    }
  };

  const getVenueLabel = (pref: string) => {
    switch (pref) {
      case 'their_location':
        return 'Their Location';
      case 'our_station':
        return 'Our Station';
      case 'either':
        return 'Either';
      default:
        return pref;
    }
  };

  const getDatePreferenceDisplay = (req: EventRequest | EventRequestListItem) => {
    if ('preferred_timeframe' in req && req.preferred_timeframe) {
      return req.preferred_timeframe;
    }
    if (req.preferred_date_start) {
      return formatShortDateTime(req.preferred_date_start, tz);
    }
    return DATE_FLEXIBILITY_LABELS[req.date_flexibility] || 'Flexible';
  };

  // Task progress for list items
  const getTaskProgress = (completions: Record<string, TaskCompletion> | undefined | null): string => {
    if (!completions || pipelineTasks.length === 0) return '';
    const done = pipelineTasks.filter((t) => completions[t.id]?.completed).length;
    return `${done}/${pipelineTasks.length}`;
  };

  // Count by status for the filter bar
  const counts = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  if (loading && requests.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => void fetchRequests()}
            className="mt-2 text-sm text-red-700 dark:text-red-400 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-lg font-bold text-theme-text-primary flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-red-700" />
            Public Outreach Requests
          </h2>
          <p className="text-sm text-theme-text-muted mt-1">
            Review and manage event requests from the community.
          </p>
        </div>

        {/* Status filter chips */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStatusFilter('')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              statusFilter === ''
                ? 'bg-red-600 text-white'
                : 'bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover'
            }`}
          >
            All ({requests.length})
          </button>
          {STATUS_FILTERS.filter((s) => counts[s]).map((s) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-red-600 text-white'
                    : `${cfg.color}`
                }`}
              >
                {cfg.label} ({counts[s] || 0})
              </button>
            );
          })}
        </div>

        {/* Requests list */}
        {requests.length === 0 ? (
          <div className="text-center py-16 bg-theme-surface-secondary rounded-lg">
            <ClipboardList className="w-12 h-12 text-theme-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-theme-text-primary mb-1">
              No event requests yet
            </h3>
            <p className="text-sm text-theme-text-muted">
              Community event requests will appear here once submitted.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => {
              const statusCfg = STATUS_CONFIG[req.status];
              const StatusIcon = statusCfg.icon;
              const isExpanded = expandedId === req.id;
              const taskProgress = getTaskProgress(req.task_completions);

              return (
                <div
                  key={req.id}
                  className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden"
                >
                  {/* Summary row */}
                  <button
                    onClick={() => void toggleExpand(req.id)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-theme-surface-secondary transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                      <StatusIcon className="w-5 h-5 flex-shrink-0 text-theme-text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-theme-text-primary truncate">
                            {req.contact_name}
                          </span>
                          {req.organization_name && (
                            <span className="text-sm text-theme-text-muted truncate">
                              — {req.organization_name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-theme-text-muted">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                            {statusCfg.label}
                          </span>
                          <span>{getOutreachLabel(req.outreach_type)}</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {getDatePreferenceDisplay(req)}
                          </span>
                          {req.audience_size && (
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              ~{req.audience_size}
                            </span>
                          )}
                          {taskProgress && (
                            <span className="flex items-center gap-1 text-xs">
                              <CheckSquare className="w-3 h-3" />
                              {taskProgress}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-theme-text-muted flex-shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-theme-text-muted flex-shrink-0" />
                    )}
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-theme-surface-border p-4 bg-theme-surface-secondary">
                      {detailLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
                        </div>
                      ) : expandedDetail ? (
                        <div className="space-y-6">
                          {/* Contact & Details grid */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
                                Contact Info
                              </h4>
                              <dl className="space-y-1 text-sm">
                                <div className="flex gap-2">
                                  <dt className="text-theme-text-muted w-24 flex-shrink-0">Name:</dt>
                                  <dd className="text-theme-text-primary">{expandedDetail.contact_name}</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="text-theme-text-muted w-24 flex-shrink-0">Email:</dt>
                                  <dd className="text-theme-text-primary">{expandedDetail.contact_email}</dd>
                                </div>
                                {expandedDetail.contact_phone && (
                                  <div className="flex gap-2">
                                    <dt className="text-theme-text-muted w-24 flex-shrink-0">Phone:</dt>
                                    <dd className="text-theme-text-primary">{expandedDetail.contact_phone}</dd>
                                  </div>
                                )}
                                {expandedDetail.organization_name && (
                                  <div className="flex gap-2">
                                    <dt className="text-theme-text-muted w-24 flex-shrink-0">Org:</dt>
                                    <dd className="text-theme-text-primary">{expandedDetail.organization_name}</dd>
                                  </div>
                                )}
                              </dl>
                            </div>

                            <div className="space-y-3">
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
                                Event Details
                              </h4>
                              <dl className="space-y-1 text-sm">
                                <div className="flex gap-2">
                                  <dt className="text-theme-text-muted w-24 flex-shrink-0">Type:</dt>
                                  <dd className="text-theme-text-primary">
                                    {getOutreachLabel(expandedDetail.outreach_type)}
                                  </dd>
                                </div>
                                {expandedDetail.audience_size && (
                                  <div className="flex gap-2">
                                    <dt className="text-theme-text-muted w-24 flex-shrink-0">Audience:</dt>
                                    <dd className="text-theme-text-primary">~{expandedDetail.audience_size} people</dd>
                                  </div>
                                )}
                                {expandedDetail.age_group && (
                                  <div className="flex gap-2">
                                    <dt className="text-theme-text-muted w-24 flex-shrink-0">Age Group:</dt>
                                    <dd className="text-theme-text-primary">{expandedDetail.age_group}</dd>
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <dt className="text-theme-text-muted w-24 flex-shrink-0">Venue:</dt>
                                  <dd className="text-theme-text-primary flex items-center gap-1">
                                    <MapPin className="w-3 h-3" />
                                    {getVenueLabel(expandedDetail.venue_preference)}
                                  </dd>
                                </div>
                                {expandedDetail.venue_address && (
                                  <div className="flex gap-2">
                                    <dt className="text-theme-text-muted w-24 flex-shrink-0">Address:</dt>
                                    <dd className="text-theme-text-primary">{expandedDetail.venue_address}</dd>
                                  </div>
                                )}
                              </dl>
                            </div>
                          </div>

                          {/* Date preferences */}
                          <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                            <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-2">
                              Date Preference
                            </h4>
                            <div className="text-sm space-y-1">
                              <p className="text-theme-text-primary">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium mr-2 ${
                                  expandedDetail.date_flexibility === 'flexible'
                                    ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                                    : expandedDetail.date_flexibility === 'general_timeframe'
                                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400'
                                      : 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400'
                                }`}>
                                  {DATE_FLEXIBILITY_LABELS[expandedDetail.date_flexibility]}
                                </span>
                                {expandedDetail.preferred_time_of_day && expandedDetail.preferred_time_of_day !== 'flexible' && (
                                  <span className="text-theme-text-muted">
                                    Prefers {expandedDetail.preferred_time_of_day}
                                  </span>
                                )}
                              </p>
                              {expandedDetail.preferred_timeframe && (
                                <p className="text-theme-text-primary italic">
                                  &ldquo;{expandedDetail.preferred_timeframe}&rdquo;
                                </p>
                              )}
                              {expandedDetail.preferred_date_start && (
                                <p className="text-theme-text-muted">
                                  {expandedDetail.preferred_date_end
                                    ? `${formatShortDateTime(expandedDetail.preferred_date_start, tz)} — ${formatShortDateTime(expandedDetail.preferred_date_end, tz)}`
                                    : `From ${formatShortDateTime(expandedDetail.preferred_date_start, tz)}`
                                  }
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Description */}
                          <div>
                            <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-2">
                              Description
                            </h4>
                            <p className="text-sm text-theme-text-primary whitespace-pre-wrap bg-theme-surface rounded-lg p-3 border border-theme-surface-border">
                              {expandedDetail.description}
                            </p>
                          </div>

                          {expandedDetail.special_requests && (
                            <div>
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-2">
                                Special Requests
                              </h4>
                              <p className="text-sm text-theme-text-primary whitespace-pre-wrap bg-theme-surface rounded-lg p-3 border border-theme-surface-border">
                                {expandedDetail.special_requests}
                              </p>
                            </div>
                          )}

                          {/* Pipeline Tasks Checklist */}
                          {pipelineTasks.length > 0 && expandedDetail.status !== 'declined' && expandedDetail.status !== 'cancelled' && expandedDetail.status !== 'completed' && (
                            <div>
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">
                                Pipeline Tasks
                              </h4>
                              <div className="space-y-1">
                                {pipelineTasks.map((task) => {
                                  const completion = expandedDetail.task_completions?.[task.id];
                                  const isCompleted = !!completion?.completed;

                                  return (
                                    <button
                                      key={task.id}
                                      onClick={() => void handleTaskToggle(expandedDetail.id, task.id, isCompleted)}
                                      disabled={actionLoading}
                                      className="w-full flex items-center gap-3 p-2.5 rounded-lg text-left hover:bg-theme-surface transition-colors disabled:opacity-50"
                                    >
                                      {isCompleted ? (
                                        <CheckSquare className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                                      ) : (
                                        <Square className="w-5 h-5 text-theme-text-muted flex-shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                        <span className={`text-sm font-medium ${isCompleted ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}>
                                          {task.label}
                                        </span>
                                        {task.description && task.description !== task.label && (
                                          <p className="text-xs text-theme-text-muted">{task.description}</p>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Status token for sharing */}
                          {expandedDetail.status_token && (
                            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                              <p className="text-xs text-blue-700 dark:text-blue-300">
                                <Eye className="w-3 h-3 inline mr-1" />
                                Public status link:{' '}
                                <code className="bg-blue-500/10 px-1 rounded text-xs">
                                  {window.location.origin}/event-request/status/{expandedDetail.status_token}
                                </code>
                              </p>
                            </div>
                          )}

                          {/* Status Actions */}
                          {(expandedDetail.status === 'submitted' ||
                            expandedDetail.status === 'in_progress') && (
                            <div className="border-t border-theme-surface-border pt-4 space-y-3">
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
                                Actions
                              </h4>

                              <div>
                                <label htmlFor={`notes-${expandedDetail.id}`} className="block text-xs font-medium text-theme-text-muted mb-1">
                                  Notes (optional)
                                </label>
                                <textarea
                                  id={`notes-${expandedDetail.id}`}
                                  rows={2}
                                  value={reviewNotes}
                                  onChange={(e) => setReviewNotes(e.target.value)}
                                  className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                                  placeholder="Add notes about this request..."
                                />
                              </div>

                              <div className="flex flex-wrap gap-2">
                                {expandedDetail.status === 'submitted' && (
                                  <button
                                    onClick={() => void handleStatusChange(expandedDetail.id, 'in_progress', reviewNotes)}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 hover:bg-yellow-200 dark:text-yellow-300 dark:bg-yellow-500/20 dark:hover:bg-yellow-500/30 rounded-lg disabled:opacity-50 transition-colors"
                                  >
                                    Start Working
                                  </button>
                                )}
                                {expandedDetail.status === 'in_progress' && (
                                  <button
                                    onClick={() => void handleStatusChange(expandedDetail.id, 'scheduled', reviewNotes)}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-purple-700 bg-purple-100 hover:bg-purple-200 dark:text-purple-300 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 rounded-lg disabled:opacity-50 transition-colors"
                                  >
                                    Mark as Scheduled
                                  </button>
                                )}
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={declineReason}
                                    onChange={(e) => setDeclineReason(e.target.value)}
                                    className="px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                                    placeholder="Reason for declining..."
                                  />
                                  <button
                                    onClick={() => void handleStatusChange(expandedDetail.id, 'declined', reviewNotes, declineReason)}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:text-red-300 dark:bg-red-500/20 dark:hover:bg-red-500/30 rounded-lg disabled:opacity-50 transition-colors"
                                  >
                                    Decline
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          {expandedDetail.status === 'scheduled' && (
                            <div className="border-t border-theme-surface-border pt-4">
                              <button
                                onClick={() => void handleStatusChange(expandedDetail.id, 'completed', reviewNotes)}
                                disabled={actionLoading}
                                className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 rounded-lg disabled:opacity-50 transition-colors"
                              >
                                Mark as Completed
                              </button>
                            </div>
                          )}

                          {/* Activity log */}
                          {expandedDetail.activity_log.length > 0 && (
                            <div className="border-t border-theme-surface-border pt-4">
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">
                                Activity Log
                              </h4>
                              <div className="space-y-2">
                                {expandedDetail.activity_log.map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="flex items-start gap-3 text-sm"
                                  >
                                    <div className="w-2 h-2 rounded-full bg-theme-text-muted mt-1.5 flex-shrink-0" />
                                    <div className="min-w-0">
                                      <p className="text-theme-text-primary">
                                        {entry.new_status && (
                                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium mr-1 ${STATUS_CONFIG[entry.new_status as EventRequestStatus]?.color || 'bg-gray-100 text-gray-800'}`}>
                                            {STATUS_CONFIG[entry.new_status as EventRequestStatus]?.label || entry.new_status}
                                          </span>
                                        )}
                                        {entry.action.startsWith('task_') && (
                                          <span className="text-xs text-theme-text-muted">
                                            {entry.action.includes('completed') ? 'Completed task' : 'Uncompleted task'}
                                            {entry.details && typeof entry.details === 'object' && 'task_id' in entry.details && (
                                              <span className="font-medium"> {String(entry.details.task_id).replace(/_/g, ' ')}</span>
                                            )}
                                          </span>
                                        )}
                                        {entry.notes && <span className="text-theme-text-muted"> — {entry.notes}</span>}
                                      </p>
                                      <p className="text-xs text-theme-text-muted mt-0.5">
                                        {entry.performer_name || 'System'} &middot;{' '}
                                        {formatShortDateTime(entry.created_at, tz)}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default EventRequestsTab;
