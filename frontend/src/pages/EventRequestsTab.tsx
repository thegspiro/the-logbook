/**
 * Event Requests Tab
 *
 * Displays the event request pipeline for public outreach event coordination.
 * Shows a flexible task-based workflow where departments can complete checklist
 * items in any order. Supports assignment, comments, scheduling with room
 * booking, and postponement.
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
  MessageSquare,
  Send,
  UserCheck,
  Pause,
  Mail,
  Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService, eventRequestService, userService, locationsService } from '../services/api';
import type {
  EventRequestListItem,
  EventRequest,
  EventRequestStatus,
  PipelineTaskConfig,
  TaskCompletion,
  DateFlexibility,
  EmailTemplate,
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
  postponed: {
    label: 'Postponed',
    color: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400',
    icon: Pause,
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
  'postponed',
  'declined',
  'cancelled',
  'completed',
];

const DATE_FLEXIBILITY_LABELS: Record<DateFlexibility, string> = {
  specific_dates: 'Has specific dates',
  general_timeframe: 'General timeframe',
  flexible: 'Flexible',
};

interface OrgMember {
  id: string;
  first_name: string;
  last_name: string;
  rank?: string;
}

interface OrgLocation {
  id: string;
  name: string;
  capacity?: number;
}

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
  const [outreachLabels, setOutreachLabels] = useState<Record<string, string>>({});
  const [pipelineTasks, setPipelineTasks] = useState<PipelineTaskConfig[]>([]);

  // Assignment
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  // Comments
  const [commentText, setCommentText] = useState('');

  // Scheduling
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleEndDate, setScheduleEndDate] = useState('');
  const [scheduleLocationId, setScheduleLocationId] = useState('');
  const [scheduleNotes, setScheduleNotes] = useState('');
  const [locations, setLocations] = useState<OrgLocation[]>([]);

  // Postpone
  const [showPostponeForm, setShowPostponeForm] = useState(false);
  const [postponeReason, setPostponeReason] = useState('');
  const [postponeNewDate, setPostponeNewDate] = useState('');

  // Email templates
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

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

  // Fetch config data on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [labels, settings, memberList, locationList, templates] = await Promise.all([
          eventRequestService.getOutreachTypeLabels(),
          eventService.getModuleSettings(),
          userService.getUsers() as Promise<OrgMember[]>,
          locationsService.getLocations({ is_active: true }) as unknown as Promise<OrgLocation[]>,
          eventRequestService.listEmailTemplates(),
        ]);
        setOutreachLabels(labels);
        setPipelineTasks(settings.request_pipeline?.tasks || []);
        setMembers(memberList);
        setLocations(locationList);
        setEmailTemplates(templates);
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
      setShowScheduleForm(false);
      setShowPostponeForm(false);
      return;
    }

    setExpandedId(id);
    setDetailLoading(true);
    setShowScheduleForm(false);
    setShowPostponeForm(false);
    try {
      const detail = await eventRequestService.getRequest(id);
      setExpandedDetail(detail);
    } catch {
      toast.error('Failed to load request details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (requestId: string) => {
    try {
      const detail = await eventRequestService.getRequest(requestId);
      setExpandedDetail(detail);
    } catch {
      // ignore
    }
    void fetchRequests();
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
      await refreshDetail(requestId);
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

  const handleAssign = async (requestId: string, userId: string) => {
    setActionLoading(true);
    try {
      const result = await eventRequestService.assignRequest(requestId, { assigned_to: userId });
      toast.success(`Assigned to ${result.assignee_name}.`);
      setAssigningId(null);
      await refreshDetail(requestId);
    } catch {
      toast.error('Failed to assign request.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddComment = async (requestId: string) => {
    if (!commentText.trim()) return;
    setActionLoading(true);
    try {
      await eventRequestService.addComment(requestId, { message: commentText.trim() });
      setCommentText('');
      await refreshDetail(requestId);
    } catch {
      toast.error('Failed to add comment.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSchedule = async (requestId: string) => {
    if (!scheduleDate) {
      toast.error('Please select a date.');
      return;
    }
    setActionLoading(true);
    try {
      await eventRequestService.scheduleRequest(requestId, {
        event_date: scheduleDate,
        event_end_date: scheduleEndDate || undefined,
        location_id: scheduleLocationId || undefined,
        notes: scheduleNotes || undefined,
        create_calendar_event: true,
      });
      toast.success('Event scheduled and added to calendar.');
      setShowScheduleForm(false);
      setScheduleDate('');
      setScheduleEndDate('');
      setScheduleLocationId('');
      setScheduleNotes('');
      await refreshDetail(requestId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to schedule request.';
      toast.error(message.includes('already booked') ? message : 'Failed to schedule request. The room may be double-booked.');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePostpone = async (requestId: string) => {
    setActionLoading(true);
    try {
      await eventRequestService.postponeRequest(requestId, {
        reason: postponeReason || undefined,
        new_event_date: postponeNewDate || undefined,
      });
      toast.success('Request postponed.');
      setShowPostponeForm(false);
      setPostponeReason('');
      setPostponeNewDate('');
      await refreshDetail(requestId);
    } catch {
      toast.error('Failed to postpone request.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendTemplate = async (requestId: string) => {
    if (!selectedTemplateId) return;
    setActionLoading(true);
    try {
      const result = await eventRequestService.sendTemplateEmail(requestId, {
        template_id: selectedTemplateId,
      });
      toast.success(result.message);
      setSelectedTemplateId('');
      await refreshDetail(requestId);
    } catch {
      toast.error('Failed to send email.');
    } finally {
      setActionLoading(false);
    }
  };

  const copyStatusLink = (token: string) => {
    const url = `${window.location.origin}/event-request/status/${token}`;
    void navigator.clipboard.writeText(url);
    toast.success('Status link copied to clipboard.');
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
    if (req.event_date) {
      return formatShortDateTime(req.event_date, tz);
    }
    if ('preferred_timeframe' in req && req.preferred_timeframe) {
      return req.preferred_timeframe;
    }
    if (req.preferred_date_start) {
      return formatShortDateTime(req.preferred_date_start, tz);
    }
    return DATE_FLEXIBILITY_LABELS[req.date_flexibility] || 'Flexible';
  };

  const getTaskProgress = (completions: Record<string, TaskCompletion> | undefined | null): string => {
    if (!completions || pipelineTasks.length === 0) return '';
    const done = pipelineTasks.filter((t) => completions[t.id]?.completed).length;
    return `${done}/${pipelineTasks.length}`;
  };

  const counts = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const isActiveStatus = (s: EventRequestStatus) =>
    s !== 'declined' && s !== 'cancelled' && s !== 'completed';

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
                          {req.assignee_name && (
                            <span className="text-xs text-theme-text-muted flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              {req.assignee_name}
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

                          {/* Assignment */}
                          <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider flex items-center gap-2">
                                <UserCheck className="w-4 h-4" />
                                Coordinator
                              </h4>
                              {assigningId !== expandedDetail.id && (
                                <button
                                  type="button"
                                  onClick={() => setAssigningId(expandedDetail.id)}
                                  className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                >
                                  {expandedDetail.assigned_to ? 'Reassign' : 'Assign'}
                                </button>
                              )}
                            </div>
                            {expandedDetail.assignee_name ? (
                              <p className="text-sm text-theme-text-primary">{expandedDetail.assignee_name}</p>
                            ) : (
                              <p className="text-sm text-theme-text-muted italic">Not yet assigned</p>
                            )}
                            {assigningId === expandedDetail.id && (
                              <select
                                onChange={(e) => {
                                  if (e.target.value) {
                                    void handleAssign(expandedDetail.id, e.target.value);
                                  }
                                }}
                                defaultValue=""
                                disabled={actionLoading}
                                className="mt-2 w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                              >
                                <option value="" disabled>Select a coordinator...</option>
                                {members.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.first_name} {m.last_name}{m.rank ? ` — ${m.rank}` : ''}
                                  </option>
                                ))}
                              </select>
                            )}
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
                              {expandedDetail.event_date && (
                                <p className="text-green-700 dark:text-green-400 font-semibold mt-2">
                                  Confirmed: {formatShortDateTime(expandedDetail.event_date, tz)}
                                  {expandedDetail.event_location_name && ` @ ${expandedDetail.event_location_name}`}
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
                          {pipelineTasks.length > 0 && isActiveStatus(expandedDetail.status) && (
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

                          {/* Status token + copy link */}
                          {expandedDetail.status_token && (
                            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-blue-700 dark:text-blue-300">
                                  <Eye className="w-3 h-3 inline mr-1" />
                                  Public status link available
                                </p>
                                <button
                                  type="button"
                                  onClick={() => copyStatusLink(expandedDetail.status_token ?? '')}
                                  className="flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
                                >
                                  <Copy className="w-3 h-3" />
                                  Copy Link
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Send email template */}
                          {emailTemplates.length > 0 && isActiveStatus(expandedDetail.status) && (
                            <div className="bg-theme-surface rounded-lg border border-theme-surface-border p-3">
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                Send Email
                              </h4>
                              <div className="flex items-center gap-2">
                                <select
                                  value={selectedTemplateId}
                                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                                  className="flex-1 px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                                >
                                  <option value="">Choose a template...</option>
                                  {emailTemplates.map((tpl) => (
                                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => void handleSendTemplate(expandedDetail.id)}
                                  disabled={actionLoading || !selectedTemplateId}
                                  className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1"
                                >
                                  <Send className="w-3 h-3" />
                                  Send
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Status Actions */}
                          {isActiveStatus(expandedDetail.status) && (
                            <div className="border-t border-theme-surface-border pt-4 space-y-3">
                              <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
                                Actions
                              </h4>

                              <div className="flex flex-wrap gap-2">
                                {expandedDetail.status === 'submitted' && (
                                  <button
                                    onClick={() => void handleStatusChange(expandedDetail.id, 'in_progress')}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 hover:bg-yellow-200 dark:text-yellow-300 dark:bg-yellow-500/20 dark:hover:bg-yellow-500/30 rounded-lg disabled:opacity-50 transition-colors"
                                  >
                                    Start Working
                                  </button>
                                )}

                                {(expandedDetail.status === 'in_progress' || expandedDetail.status === 'postponed') && (
                                  <button
                                    onClick={() => setShowScheduleForm(!showScheduleForm)}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-purple-700 bg-purple-100 hover:bg-purple-200 dark:text-purple-300 dark:bg-purple-500/20 dark:hover:bg-purple-500/30 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1"
                                  >
                                    <Calendar className="w-4 h-4" />
                                    Schedule Event
                                  </button>
                                )}

                                {(expandedDetail.status === 'in_progress' || expandedDetail.status === 'scheduled') && (
                                  <button
                                    onClick={() => setShowPostponeForm(!showPostponeForm)}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-orange-700 bg-orange-100 hover:bg-orange-200 dark:text-orange-300 dark:bg-orange-500/20 dark:hover:bg-orange-500/30 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1"
                                  >
                                    <Pause className="w-4 h-4" />
                                    Postpone
                                  </button>
                                )}

                                {expandedDetail.status === 'postponed' && (
                                  <button
                                    onClick={() => void handleStatusChange(expandedDetail.id, 'in_progress')}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 hover:bg-yellow-200 dark:text-yellow-300 dark:bg-yellow-500/20 dark:hover:bg-yellow-500/30 rounded-lg disabled:opacity-50 transition-colors"
                                  >
                                    Resume Work
                                  </button>
                                )}

                                {expandedDetail.status === 'scheduled' && (
                                  <button
                                    onClick={() => void handleStatusChange(expandedDetail.id, 'completed')}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-100 hover:bg-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/30 rounded-lg disabled:opacity-50 transition-colors"
                                  >
                                    Mark as Completed
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
                                    onClick={() => void handleStatusChange(expandedDetail.id, 'declined', undefined, declineReason)}
                                    disabled={actionLoading}
                                    className="px-4 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:text-red-300 dark:bg-red-500/20 dark:hover:bg-red-500/30 rounded-lg disabled:opacity-50 transition-colors"
                                  >
                                    Decline
                                  </button>
                                </div>

                                <button
                                  onClick={() => void handleStatusChange(expandedDetail.id, 'cancelled')}
                                  disabled={actionLoading}
                                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-500/20 dark:hover:bg-gray-500/30 rounded-lg disabled:opacity-50 transition-colors"
                                >
                                  Cancel Request
                                </button>
                              </div>

                              {/* Schedule form */}
                              {showScheduleForm && (
                                <div className="bg-theme-surface rounded-lg border border-purple-200 dark:border-purple-500/30 p-4 space-y-3">
                                  <h5 className="text-sm font-semibold text-purple-700 dark:text-purple-400">
                                    Schedule Event
                                  </h5>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                      <label className="block text-xs font-medium text-theme-text-muted mb-1">
                                        Start Date & Time *
                                      </label>
                                      <input
                                        type="datetime-local"
                                        value={scheduleDate}
                                        onChange={(e) => setScheduleDate(e.target.value)}
                                        className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs font-medium text-theme-text-muted mb-1">
                                        End Date & Time
                                      </label>
                                      <input
                                        type="datetime-local"
                                        value={scheduleEndDate}
                                        onChange={(e) => setScheduleEndDate(e.target.value)}
                                        className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500"
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-theme-text-muted mb-1">
                                      Location / Room
                                    </label>
                                    <select
                                      value={scheduleLocationId}
                                      onChange={(e) => setScheduleLocationId(e.target.value)}
                                      className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    >
                                      <option value="">Off-site or none</option>
                                      {locations.map((loc) => (
                                        <option key={loc.id} value={loc.id}>
                                          {loc.name}{loc.capacity ? ` (cap: ${loc.capacity})` : ''}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <input
                                    type="text"
                                    value={scheduleNotes}
                                    onChange={(e) => setScheduleNotes(e.target.value)}
                                    placeholder="Notes (optional)"
                                    className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-purple-500"
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleSchedule(expandedDetail.id)}
                                      disabled={actionLoading || !scheduleDate}
                                      className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50 transition-colors"
                                    >
                                      Confirm & Create Calendar Event
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setShowScheduleForm(false)}
                                      className="px-4 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text-primary transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Postpone form */}
                              {showPostponeForm && (
                                <div className="bg-theme-surface rounded-lg border border-orange-200 dark:border-orange-500/30 p-4 space-y-3">
                                  <h5 className="text-sm font-semibold text-orange-700 dark:text-orange-400">
                                    Postpone Event
                                  </h5>
                                  <input
                                    type="text"
                                    value={postponeReason}
                                    onChange={(e) => setPostponeReason(e.target.value)}
                                    placeholder="Reason for postponing (optional)"
                                    className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-orange-500"
                                  />
                                  <div>
                                    <label className="block text-xs font-medium text-theme-text-muted mb-1">
                                      New tentative date (optional — leave blank for TBD)
                                    </label>
                                    <input
                                      type="datetime-local"
                                      value={postponeNewDate}
                                      onChange={(e) => setPostponeNewDate(e.target.value)}
                                      className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handlePostpone(expandedDetail.id)}
                                      disabled={actionLoading}
                                      className="px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50 transition-colors"
                                    >
                                      Confirm Postpone
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setShowPostponeForm(false)}
                                      className="px-4 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text-primary transition-colors"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Comment thread */}
                          <div className="border-t border-theme-surface-border pt-4">
                            <h4 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3 flex items-center gap-2">
                              <MessageSquare className="w-4 h-4" />
                              Comments & Activity
                            </h4>
                            <div className="space-y-2 mb-3">
                              {expandedDetail.activity_log.map((entry) => {
                                const isComment = entry.action === 'comment';
                                return (
                                  <div
                                    key={entry.id}
                                    className={`flex items-start gap-3 text-sm ${
                                      isComment ? 'bg-theme-surface rounded-lg p-3 border border-theme-surface-border' : ''
                                    }`}
                                  >
                                    {isComment ? (
                                      <MessageSquare className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                                    ) : (
                                      <div className="w-2 h-2 rounded-full bg-theme-text-muted mt-1.5 flex-shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      {isComment ? (
                                        <p className="text-theme-text-primary whitespace-pre-wrap">{entry.notes}</p>
                                      ) : (
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
                                          {entry.action === 'assigned' && entry.details && (
                                            <span className="text-xs text-theme-text-muted">
                                              Assigned to{' '}
                                              <span className="font-medium">
                                                {typeof entry.details === 'object' && 'assignee_name' in entry.details
                                                  ? String(entry.details.assignee_name)
                                                  : 'coordinator'}
                                              </span>
                                            </span>
                                          )}
                                          {entry.action === 'email_sent' && (
                                            <span className="text-xs text-theme-text-muted flex items-center gap-1">
                                              <Mail className="w-3 h-3" />
                                              {entry.notes}
                                            </span>
                                          )}
                                          {!isComment && !entry.new_status && !entry.action.startsWith('task_') && entry.action !== 'assigned' && entry.action !== 'email_sent' && entry.notes && (
                                            <span className="text-theme-text-muted">{entry.notes}</span>
                                          )}
                                        </p>
                                      )}
                                      <p className="text-xs text-theme-text-muted mt-0.5">
                                        {entry.performer_name || 'System'} &middot;{' '}
                                        {formatShortDateTime(entry.created_at, tz)}
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Add comment */}
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={commentText}
                                onChange={(e) => setCommentText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && commentText.trim()) {
                                    void handleAddComment(expandedDetail.id);
                                  }
                                }}
                                placeholder="Add a comment..."
                                className="flex-1 px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                              />
                              <button
                                type="button"
                                onClick={() => void handleAddComment(expandedDetail.id)}
                                disabled={actionLoading || !commentText.trim()}
                                className="px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
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
