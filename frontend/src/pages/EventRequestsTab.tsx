/**
 * Event Requests Tab
 *
 * The queue of outreach requests from the public, laid out as a triage list:
 * grouped by what needs doing (needs a reply, in progress, scheduled,
 * postponed, closed), with each row saying how soon the event is, whether
 * intake flagged it as short notice, who has it, and the next step. A request
 * opens in a drawer that leads with the action that moves it forward, so the
 * list stays in place while the coordinator works one request.
 *
 * Shown within the Events Admin Hub.
 */

import React, { useEffect, useState, useCallback } from 'react';
import DialogPanel from '../components/ux/DialogPanel';
import { PromptDialog } from '../components/ux/PromptDialog';
import DateTimeQuarterHour from '../components/ux/DateTimeQuarterHour';
import {
  ClipboardList,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
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
  UserPlus,
  Megaphone,
  MoreHorizontal,
  Phone,
  Plus,
  Play,
  Search,
  Trash2,
  X,
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
  EventRequestStaffing,
  OutreachRole,
  StaffingRoleNeed,
} from '../types/event';
import { useTimezone } from '../hooks/useTimezone';
import { useRanks } from '../hooks/useRanks';
import { formatShortDateTime, localToUTC } from '../utils/dateFormatting';
import { getErrorDetail, getErrorMessage } from '../utils/errorHandling';
import { positionLabel } from '../modules/scheduling/utils/positionLabels';
import { asArray, expectArray } from '../utils/asArray';
import { displayNameOf } from '../utils/memberName';
import { useAuthStore } from '../stores/authStore';
import { useConfirm } from '../contexts/ConfirmContext';
import { useMediaQuery } from '../hooks/useMediaQuery';
import RequestInboxRow, { ChecklistBar, CoordinatorChip, RequestDateLine } from './event-requests/RequestInboxRow';
import {
  INBOX_GROUPS,
  groupRequests,
  isOpenStatus,
  matchesScope,
  matchesSearch,
  nextStep,
  receivedAge,
  taskProgress,
  type InboxGroupKey,
  type InboxScope,
} from './event-requests/requestInbox';

const isRecord = (value: unknown): value is Record<string, string> => typeof value === 'object' && value !== null;

const STATUS_CONFIG: Record<EventRequestStatus, { label: string; color: string; icon: React.ElementType }> = {
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
    color: 'bg-theme-surface-secondary text-theme-text-muted',
    icon: XCircle,
  },
  completed: {
    label: 'Completed',
    color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
    icon: CheckCircle,
  },
};

/** The left rule on each group's card, so the groups read apart at a glance. */
const GROUP_TONE: Record<InboxGroupKey, string> = {
  reply: 'border-l-blue-700',
  working: 'border-l-amber-600',
  scheduled: 'border-l-violet-700',
  postponed: 'border-l-orange-600',
  closed: 'border-l-slate-400',
};

const SCOPES: { key: InboxScope; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
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
  preferred_name?: string | null | undefined;
  display_name?: string | undefined;
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
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<InboxScope>('all');
  const [showClosed, setShowClosed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<EventRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
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

  // Volunteer staffing (the tie-in to the shift schedule)
  const [staffing, setStaffing] = useState<EventRequestStaffing | null>(null);
  const [staffingLoading, setStaffingLoading] = useState(false);
  const [outreachRoles, setOutreachRoles] = useState<OutreachRole[]>([]);
  const [roleNeeds, setRoleNeeds] = useState<StaffingRoleNeed[]>([]);
  const [showVolunteerCall, setShowVolunteerCall] = useState(false);
  const [volunteerCallMessage, setVolunteerCallMessage] = useState('');

  const tz = useTimezone();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { confirm } = useConfirm();
  // The drawer's action bar sits under the header on a wide screen and at the
  // bottom on a phone, where a thumb reaches it without scrolling back up.
  const isWide = useMediaQuery('(min-width: 640px)');
  // Inactive ranks too, so a member holding a retired rank still reads by its name.
  const { formatRank } = useRanks(false);

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Every status, grouped on screen: the groups replace the status filter,
      // and their counts have to describe the whole queue, not one slice of it.
      const data = await eventRequestService.listRequests({});
      // Verified, not substituted: an empty queue reads as "no requests to
      // handle", so a body that is not a list takes the error path instead.
      setRequests(expectArray(data, 'event requests'));
    } catch {
      setError('Failed to load event requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  // Fetch config data on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [labels, settings, memberList, locationList, templates, roles] = await Promise.all([
          eventRequestService.getOutreachTypeLabels(),
          eventService.getModuleSettings(),
          userService.getUsers() as Promise<OrgMember[]>,
          locationsService.getLocations({ is_active: true }) as unknown as Promise<OrgLocation[]>,
          eventRequestService.listEmailTemplates(),
          eventRequestService.getOutreachRoles(),
        ]);
        setOutreachLabels(isRecord(labels) ? labels : {});
        const roleList = asArray(roles);
        setOutreachRoles(roleList);
        // Seed the sheet with one of the first role the department configured,
        // so a coordinator opening signups for a simple event can just press
        // the button.
        setRoleNeeds(roleList[0] ? [{ role: roleList[0].value, count: 1 }] : []);
        setPipelineTasks(asArray(settings?.request_pipeline?.tasks ?? []));
        setMembers(memberList);
        setLocations(asArray(locationList));
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

  const loadStaffing = useCallback(async (requestId: string) => {
    setStaffingLoading(true);
    try {
      setStaffing(await eventRequestService.getStaffing(requestId));
    } catch {
      // A request with no signup sheet is the common case, not an error worth
      // a toast — the panel falls back to its "open signups" prompt.
      setStaffing(null);
    } finally {
      setStaffingLoading(false);
    }
  }, []);

  const resetPanels = () => {
    setShowScheduleForm(false);
    setShowPostponeForm(false);
    setShowMore(false);
    setShowEmail(false);
    setShowDecline(false);
    setAssigningId(null);
    setStaffing(null);
    setShowVolunteerCall(false);
    setVolunteerCallMessage('');
  };

  const closeRequest = () => {
    setExpandedId(null);
    setExpandedDetail(null);
    resetPanels();
  };

  const openRequest = async (id: string) => {
    setExpandedId(id);
    setExpandedDetail(null);
    setDetailLoading(true);
    resetPanels();
    try {
      const detail = await eventRequestService.getRequest(id);
      setExpandedDetail(detail);
      if (detail.status === 'scheduled') {
        await loadStaffing(id);
      }
    } catch {
      toast.error('Failed to load request details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (requestId: string) => {
    // "Take it" acts on a row whose request is not open, and must not put that
    // request's detail behind whichever one the drawer is showing.
    if (expandedId === requestId) {
      try {
        const detail = await eventRequestService.getRequest(requestId);
        setExpandedDetail(detail);
      } catch {
        // The list refresh below still reports the change.
      }
    }
    void fetchRequests();
  };

  const addRoleNeed = () => {
    const unused = outreachRoles.find((r) => !roleNeeds.some((n) => n.role === r.value));
    if (!unused) return;
    setRoleNeeds([...roleNeeds, { role: unused.value, count: 1 }]);
  };

  const updateRoleNeed = (index: number, patch: Partial<StaffingRoleNeed>) => {
    setRoleNeeds(roleNeeds.map((need, i) => (i === index ? { ...need, ...patch } : need)));
  };

  const removeRoleNeed = (index: number) => {
    setRoleNeeds(roleNeeds.filter((_, i) => i !== index));
  };

  const handleOpenStaffing = async (requestId: string) => {
    if (roleNeeds.length === 0) {
      toast.error('Add at least one role you need help with.');
      return;
    }
    setActionLoading(true);
    try {
      const result = await eventRequestService.openStaffing(requestId, { roles: roleNeeds });
      setStaffing(result);
      toast.success('Volunteer signups are open on the schedule.');
      await refreshDetail(requestId);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to open volunteer signups.'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleVolunteerCall = async (requestId: string) => {
    setActionLoading(true);
    try {
      const result = await eventRequestService.sendVolunteerCall(requestId, {
        message: volunteerCallMessage.trim() || undefined,
      });
      toast.success(result.message);
      setShowVolunteerCall(false);
      setVolunteerCallMessage('');
      await loadStaffing(requestId);
      await refreshDetail(requestId);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to email the membership.'));
    } finally {
      setActionLoading(false);
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
      setShowMore(false);
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
      toast.error('Pick a start date.');
      return;
    }
    setActionLoading(true);
    try {
      await eventRequestService.scheduleRequest(requestId, {
        // DateTimeQuarterHour yields a naive "YYYY-MM-DDTHH:mm" in the
        // department's own timezone. Sent as-is the backend stores it as UTC,
        // which shifts the confirmed date by the offset — and with it the
        // calendar event, the requester's "Scheduled Date" email, the staffing
        // shift and the volunteer call, all by the same amount.
        event_date: localToUTC(scheduleDate, tz),
        event_end_date: scheduleEndDate ? localToUTC(scheduleEndDate, tz) : undefined,
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
      // The server's sentence when it gave one: a double-booked room, or an
      // event whose attendance is already closed, are different fixes and the
      // coordinator can only tell them apart by reading which it was. The
      // room hint is kept for a failure that came back without a reason.
      toast.error(getErrorDetail(err) || 'Failed to schedule request. The room may be double-booked.');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePostpone = async (requestId: string) => {
    setActionLoading(true);
    try {
      await eventRequestService.postponeRequest(requestId, {
        reason: postponeReason || undefined,
        new_event_date: postponeNewDate ? localToUTC(postponeNewDate, tz) : undefined,
      });
      toast.success('Request postponed.');
      setShowPostponeForm(false);
      setShowMore(false);
      setPostponeReason('');
      setPostponeNewDate('');
      await refreshDetail(requestId);
    } catch (err) {
      toast.error(getErrorDetail(err) || 'Failed to postpone request.');
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
      setShowEmail(false);
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

  const isActiveStatus = (s: EventRequestStatus) => s !== 'declined' && s !== 'cancelled' && s !== 'completed';

  const handleCancelRequest = async (requestId: string) => {
    const ok = await confirm({
      title: 'Cancel this request?',
      message:
        'The request closes and leaves the queue. If it is on the calendar, that event and any volunteer signup sheet are stood down too.',
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (ok) await handleStatusChange(requestId, 'cancelled');
  };

  const takeRequest = (requestId: string) => {
    if (currentUserId) void handleAssign(requestId, currentUserId);
  };

  const visible = requests.filter(
    (req) => matchesScope(req, scope, currentUserId) && matchesSearch(req, search, getOutreachLabel(req.outreach_type))
  );
  const grouped = groupRequests(visible);
  const unassignedOpen = requests.filter((r) => !r.assigned_to && isOpenStatus(r.status)).length;
  const openGroups = INBOX_GROUPS.filter((g) => g.key !== 'closed');
  const nothingOpenShown = openGroups.every((g) => grouped[g.key].length === 0);

  if (loading && requests.length === 0) {
    return (
      <div className="mx-auto max-w-6xl py-8">
        <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl py-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => void fetchRequests()}
            className="mt-2 min-h-11 text-sm text-red-700 underline dark:text-red-400"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const detail = expandedDetail;
  const detailOpen = detail ? isActiveStatus(detail.status) : false;
  const detailProgress = detail ? taskProgress(detail, pipelineTasks) : { done: 0, total: 0 };
  const detailNext = detail ? nextStep(detail, pipelineTasks) : null;

  const primaryAction = (() => {
    if (!detail) return null;
    switch (detail.status) {
      case 'submitted':
        return !detail.assigned_to && currentUserId
          ? { label: 'Take it', icon: UserPlus, run: () => takeRequest(detail.id) }
          : { label: 'Start working', icon: Play, run: () => void handleStatusChange(detail.id, 'in_progress') };
      case 'in_progress':
      case 'postponed':
        return { label: 'Schedule event', icon: CalendarCheck, run: () => setShowScheduleForm(!showScheduleForm) };
      case 'scheduled':
        return {
          label: 'Mark completed',
          icon: CheckCircle,
          run: () => void handleStatusChange(detail.id, 'completed'),
        };
      default:
        return null;
    }
  })();

  const actionBar = detail && detailOpen && (
    <div
      className={`bg-theme-surface-modal border-theme-surface-border flex flex-wrap items-center gap-2 px-5 py-3 ${
        isWide ? 'border-b' : 'pb-safe border-t shadow-[0_-4px_12px_rgba(0,0,0,0.06)]'
      }`}
    >
      {primaryAction && (
        <button
          type="button"
          onClick={primaryAction.run}
          disabled={actionLoading}
          className="btn-primary flex flex-1 items-center justify-center gap-2 sm:flex-none"
        >
          <primaryAction.icon className="h-4 w-4" aria-hidden="true" />
          {primaryAction.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowEmail(!showEmail)}
        aria-expanded={showEmail}
        className="btn-secondary flex min-w-11 items-center justify-center gap-2"
      >
        <Mail className="h-4 w-4" aria-hidden="true" />
        <span className={isWide ? '' : 'sr-only'}>Email requester</span>
      </button>
      <button
        type="button"
        onClick={() => setShowMore(!showMore)}
        aria-expanded={showMore}
        aria-controls="request-more-actions"
        className="btn-secondary flex min-w-11 items-center justify-center gap-1"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        <span className={isWide ? 'text-sm' : 'sr-only'}>More</span>
        {isWide && <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl py-8">
      <div className="space-y-5">
        <div>
          <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-bold">
            <ClipboardList className="h-5 w-5 text-red-700" aria-hidden="true" />
            Public Outreach Requests
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            Requests from the community, grouped by what needs doing next.
          </p>
        </div>

        {requests.length === 0 ? (
          <div className="bg-theme-surface-secondary rounded-lg py-16 text-center">
            <ClipboardList className="text-theme-text-muted mx-auto mb-4 h-12 w-12" aria-hidden="true" />
            <h3 className="text-theme-text-primary mb-1 text-lg font-medium">No event requests yet</h3>
            <p className="text-theme-text-muted text-sm">Community event requests will appear here once submitted.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 basis-full sm:max-w-xs sm:flex-1 sm:basis-auto">
                <Search
                  className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="form-input pl-9 text-sm"
                  placeholder="Search requester, organization, type…"
                  aria-label="Search requests"
                />
              </label>
              <div className="segmented-group flex gap-1" role="group" aria-label="Whose requests">
                {SCOPES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setScope(s.key)}
                    aria-pressed={scope === s.key}
                    className={`settings-section-tab ${scope === s.key ? 'settings-nav-item-active' : ''}`}
                  >
                    {s.label}
                    {s.key === 'unassigned' && unassignedOpen > 0 && (
                      <span className="ml-1 rounded-full bg-amber-800 px-1.5 text-[11px] text-white">
                        {unassignedOpen}
                        <span className="sr-only"> open</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {nothingOpenShown && (
              <p className="text-theme-text-muted bg-theme-surface-secondary rounded-lg px-4 py-6 text-center text-sm">
                {search.trim() || scope !== 'all'
                  ? 'No open requests match. Clear the search or choose All to see the rest.'
                  : 'Nothing open. Every request has been completed, declined or cancelled.'}
              </p>
            )}

            {INBOX_GROUPS.map((group) => {
              const items = grouped[group.key];
              if (items.length === 0) return null;
              const isClosed = group.key === 'closed';
              const headingId = `request-group-${group.key}`;
              return (
                <section key={group.key} aria-labelledby={headingId}>
                  {isClosed ? (
                    <button
                      type="button"
                      id={headingId}
                      onClick={() => setShowClosed(!showClosed)}
                      aria-expanded={showClosed}
                      className="text-theme-text-secondary hover:text-theme-text-primary mb-2 flex min-h-11 items-center gap-1 text-sm"
                    >
                      {showClosed ? (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      )}
                      {group.title} ({items.length}) — {group.hint.toLowerCase()}
                    </button>
                  ) : (
                    <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                      <h3 id={headingId} className="text-theme-text-primary text-sm font-semibold">
                        {group.title}
                      </h3>
                      <span className="text-theme-text-muted text-xs">
                        {items.length} · {group.hint}
                      </span>
                    </div>
                  )}
                  {(!isClosed || showClosed) && (
                    <ul className={`card overflow-hidden border-l-4 p-0 ${GROUP_TONE[group.key]}`}>
                      {items.map((req) => (
                        <RequestInboxRow
                          key={req.id}
                          request={req}
                          tasks={pipelineTasks}
                          typeLabel={getOutreachLabel(req.outreach_type)}
                          dateLabel={getDatePreferenceDisplay(req)}
                          timezone={tz}
                          selected={expandedId === req.id}
                          onTake={
                            req.status === 'submitted' && !req.assigned_to && currentUserId
                              ? () => takeRequest(req.id)
                              : undefined
                          }
                          taking={actionLoading}
                          onOpen={() => void openRequest(req.id)}
                          wide={isWide}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>

      {expandedId && (
        // The scrim is inert: a slip outside the drawer must not discard a
        // half-written schedule, postponement or comment (CLAUDE.md pitfall
        // #31). Escape and the close button are the ways out.
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="modal-overlay absolute inset-0" aria-hidden="true" />
          <DialogPanel
            onClose={closeRequest}
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-drawer-title"
            className="relative flex h-full max-h-dvh w-full max-w-xl flex-col overflow-hidden rounded-none border-y-0 border-r-0"
          >
            {detailLoading || !detail ? (
              <div className="flex flex-1 items-center justify-center" role="status" aria-live="polite">
                <h2 id="request-drawer-title" className="sr-only">
                  Loading request
                </h2>
                <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
              </div>
            ) : (
              <>
                <header className="px-5 pt-5 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_CONFIG[detail.status].color}`}
                        >
                          {STATUS_CONFIG[detail.status].label}
                        </span>
                        <span className="text-theme-text-muted text-xs">
                          Received {receivedAge(detail.created_at, tz)}
                        </span>
                      </div>
                      <h2 id="request-drawer-title" className="text-theme-text-primary text-xl font-semibold">
                        {detail.organization_name || detail.contact_name}
                      </h2>
                      <p className="text-theme-text-secondary text-sm">
                        {getOutreachLabel(detail.outreach_type)}
                        {detail.audience_size ? ` · ~${detail.audience_size} people` : ''}
                        {detail.organization_name ? ` · ${detail.contact_name}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeRequest}
                      className="btn-icon text-theme-text-muted hover:text-theme-text-primary shrink-0"
                      aria-label="Close request"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="mt-3">
                    <RequestDateLine request={detail} dateLabel={getDatePreferenceDisplay(detail)} timezone={tz} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-theme-text-muted text-xs font-medium">Coordinator</span>
                    <CoordinatorChip name={detail.assignee_name} />
                    {detailOpen && assigningId !== detail.id && (
                      <button
                        type="button"
                        onClick={() => setAssigningId(detail.id)}
                        className="touch-target-phone text-xs font-medium text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                      >
                        {detail.assigned_to ? 'Reassign' : 'Assign'}
                      </button>
                    )}
                  </div>
                  {assigningId === detail.id && (
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          void handleAssign(detail.id, e.target.value);
                        }
                      }}
                      defaultValue=""
                      disabled={actionLoading}
                      aria-label="Coordinator"
                      className="form-input mt-2 text-sm"
                    >
                      <option value="" disabled>
                        Select a coordinator...
                      </option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {displayNameOf(m)}
                          {m.rank ? ` — ${formatRank(m.rank)}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </header>

                {isWide && actionBar}

                <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                  {showMore && detailOpen && (
                    <div id="request-more-actions" className="card-secondary flex flex-wrap gap-2 p-3">
                      {(detail.status === 'in_progress' || detail.status === 'scheduled') && (
                        <button
                          type="button"
                          onClick={() => setShowPostponeForm(!showPostponeForm)}
                          disabled={actionLoading}
                          className="btn-secondary btn-sm flex items-center gap-1"
                        >
                          <Pause className="h-4 w-4" aria-hidden="true" />
                          Postpone
                        </button>
                      )}
                      {detail.status === 'postponed' && (
                        <button
                          type="button"
                          onClick={() => void handleStatusChange(detail.id, 'in_progress')}
                          disabled={actionLoading}
                          className="btn-secondary btn-sm flex items-center gap-1"
                        >
                          <Play className="h-4 w-4" aria-hidden="true" />
                          Resume Work
                        </button>
                      )}
                      {/* Only offered where the backend allows it: a scheduled
                          or postponed request can be cancelled but not
                          declined, and showing the button anyway produced a
                          400 the coordinator read as the app being broken. */}
                      {(detail.status === 'submitted' || detail.status === 'in_progress') && (
                        <button
                          type="button"
                          onClick={() => setShowDecline(true)}
                          disabled={actionLoading}
                          className="btn-secondary btn-sm flex items-center gap-1"
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                          Decline…
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleCancelRequest(detail.id)}
                        disabled={actionLoading}
                        className="btn-secondary btn-sm flex items-center gap-1"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                        Cancel Request
                      </button>
                    </div>
                  )}

                  {showEmail && (
                    <div className="card space-y-3 p-4">
                      <h3 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
                        <Mail className="h-4 w-4" aria-hidden="true" />
                        Email {detail.contact_name}
                      </h3>
                      {emailTemplates.length > 0 && detailOpen && (
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedTemplateId}
                            onChange={(e) => setSelectedTemplateId(e.target.value)}
                            aria-label="Email template"
                            className="form-input flex-1"
                          >
                            <option value="">Choose a template...</option>
                            {emailTemplates.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleSendTemplate(detail.id)}
                            disabled={actionLoading || !selectedTemplateId}
                            className="btn-primary flex items-center gap-1 px-3 text-sm font-medium"
                          >
                            <Send className="h-3.5 w-3.5" aria-hidden="true" />
                            Send
                          </button>
                        </div>
                      )}
                      <a
                        href={`mailto:${detail.contact_email}`}
                        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-blue-700 hover:underline dark:text-blue-400"
                      >
                        Write your own from your email app
                      </a>
                    </div>
                  )}

                  {showScheduleForm && detailOpen && (
                    <div className="card space-y-3 border-purple-200 p-4 dark:border-purple-500/30">
                      <h3 className="text-sm font-semibold text-purple-700 dark:text-purple-400">Schedule Event</h3>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                            Start Date & Time *
                          </label>
                          <DateTimeQuarterHour
                            value={scheduleDate}
                            onChange={(val) => setScheduleDate(val)}
                            className="form-input text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                            End Date & Time
                          </label>
                          <DateTimeQuarterHour
                            value={scheduleEndDate}
                            onChange={(val) => setScheduleEndDate(val)}
                            className="form-input text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          htmlFor="schedule-location"
                          className="text-theme-text-muted mb-1 block text-xs font-medium"
                        >
                          Location / Room
                        </label>
                        <select
                          id="schedule-location"
                          value={scheduleLocationId}
                          onChange={(e) => setScheduleLocationId(e.target.value)}
                          className="form-input text-sm"
                        >
                          <option value="">Off-site or none</option>
                          {locations.map((loc) => (
                            <option key={loc.id} value={loc.id}>
                              {loc.name}
                              {loc.capacity ? ` (cap: ${loc.capacity})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <input
                        type="text"
                        value={scheduleNotes}
                        onChange={(e) => setScheduleNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        aria-label="Scheduling notes"
                        className="form-input placeholder-theme-text-muted text-sm"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSchedule(detail.id)}
                          disabled={actionLoading || !scheduleDate}
                          className="btn-primary text-sm font-medium"
                        >
                          Confirm & Create Calendar Event
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowScheduleForm(false)}
                          className="text-theme-text-muted hover:text-theme-text-primary min-h-11 px-4 text-sm font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {showPostponeForm && detailOpen && (
                    <div className="card space-y-3 border-orange-200 p-4 dark:border-orange-500/30">
                      <h3 className="text-sm font-semibold text-orange-700 dark:text-orange-400">Postpone Event</h3>
                      <input
                        type="text"
                        value={postponeReason}
                        onChange={(e) => setPostponeReason(e.target.value)}
                        placeholder="Reason for postponing (optional)"
                        aria-label="Reason for postponing"
                        className="form-input placeholder-theme-text-muted text-sm"
                      />
                      <div>
                        <label className="text-theme-text-muted mb-1 block text-xs font-medium">
                          New tentative date (optional — leave blank for TBD)
                        </label>
                        <DateTimeQuarterHour
                          value={postponeNewDate}
                          onChange={(val) => setPostponeNewDate(val)}
                          className="form-input text-sm"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePostpone(detail.id)}
                          disabled={actionLoading}
                          className="btn-warning text-sm font-medium"
                        >
                          Confirm Postpone
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowPostponeForm(false)}
                          className="text-theme-text-muted hover:text-theme-text-primary min-h-11 px-4 text-sm font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {detailNext && detailOpen && (
                    <p className="alert-info flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>
                        <strong>Next:</strong> {detailNext}
                      </span>
                    </p>
                  )}

                  {pipelineTasks.length > 0 && detailOpen && (
                    <section>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">
                          Checklist
                        </h3>
                        <ChecklistBar done={detailProgress.done} total={detailProgress.total} />
                      </div>
                      <div className="space-y-1">
                        {pipelineTasks.map((task) => {
                          const completion = detail.task_completions?.[task.id];
                          const isCompleted = !!completion?.completed;
                          return (
                            <button
                              key={task.id}
                              type="button"
                              onClick={() => void handleTaskToggle(detail.id, task.id, isCompleted)}
                              // Done or not was shown only by the icon and a strikethrough.
                              aria-pressed={isCompleted}
                              disabled={actionLoading}
                              className="hover:bg-theme-surface-hover flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors disabled:opacity-50"
                            >
                              {isCompleted ? (
                                <CheckSquare className="h-5 w-5 shrink-0 text-green-700 dark:text-green-400" />
                              ) : (
                                <Square className="text-theme-text-muted h-5 w-5 shrink-0" />
                              )}
                              <span className="min-w-0">
                                <span
                                  className={`block text-sm font-medium ${isCompleted ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'}`}
                                >
                                  {task.label}
                                </span>
                                {task.description && task.description !== task.label && (
                                  <span className="text-theme-text-muted block text-xs">{task.description}</span>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {detail.status === 'scheduled' && (
                    <section className="space-y-3">
                      <h3 className="text-theme-text-muted flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                        Volunteer Staffing
                      </h3>

                      {staffingLoading && (
                        <p className="text-theme-text-muted flex items-center gap-2 text-sm">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Loading signups…
                        </p>
                      )}

                      {!staffingLoading && !staffing?.shift_id && (
                        <div className="card space-y-3 p-4">
                          <p className="text-theme-text-muted text-sm">
                            Say what help you need and members can claim a role from{' '}
                            <span className="font-medium">Scheduling → Open Shifts</span>. These are outreach roles, not
                            riding positions — nobody is taking a seat on an engine at a school visit. Edit the list in
                            Event settings.
                          </p>
                          <div className="space-y-2">
                            {roleNeeds.map((need, idx) => (
                              <div key={need.role} className="flex flex-wrap items-center gap-2">
                                <select
                                  value={need.role}
                                  onChange={(e) => updateRoleNeed(idx, { role: e.target.value })}
                                  aria-label="Role needed"
                                  className="form-input flex-1 text-sm sm:max-w-xs"
                                >
                                  {outreachRoles
                                    .filter((r) => r.value === need.role || !roleNeeds.some((n) => n.role === r.value))
                                    .map((r) => (
                                      <option key={r.value} value={r.value}>
                                        {r.label}
                                      </option>
                                    ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  max={50}
                                  value={need.count}
                                  aria-label="How many needed"
                                  onChange={(e) => {
                                    const val = parseInt(e.target.value, 10);
                                    if (!isNaN(val) && val >= 1 && val <= 50) {
                                      updateRoleNeed(idx, { count: val });
                                    }
                                  }}
                                  className="form-input w-20 text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeRoleNeed(idx)}
                                  disabled={roleNeeds.length === 1}
                                  title="Remove this role"
                                  className="text-theme-text-muted p-2 transition-colors hover:text-red-600 disabled:opacity-30 dark:hover:text-red-400"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              type="button"
                              onClick={addRoleNeed}
                              disabled={roleNeeds.length >= outreachRoles.length}
                              className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-40"
                            >
                              <Plus className="h-4 w-4" />
                              Add another role
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleOpenStaffing(detail.id)}
                              disabled={actionLoading || roleNeeds.length === 0}
                              className="btn-primary flex items-center gap-1.5 text-sm font-medium"
                            >
                              <UserPlus className="h-4 w-4" />
                              Open Signups
                            </button>
                          </div>
                        </div>
                      )}

                      {!staffingLoading && staffing?.shift_id && (
                        <div className="card space-y-3 p-4">
                          <p className="text-theme-text-primary text-sm font-medium">
                            {staffing.slots_filled} of {staffing.slots_total} filled
                          </p>
                          {staffing.roles.length > 0 && (
                            <ul className="space-y-1">
                              {staffing.roles.map((role) => (
                                <li
                                  key={role.role}
                                  className="text-theme-text-secondary flex items-center justify-between gap-3 text-sm"
                                >
                                  <span className="text-theme-text-primary">{role.label}</span>
                                  <span
                                    className={
                                      role.remaining > 0
                                        ? 'text-amber-700 dark:text-amber-400'
                                        : 'text-emerald-700 dark:text-emerald-400'
                                    }
                                  >
                                    {role.filled} of {role.total}
                                    {role.remaining > 0 ? ` — ${role.remaining} still needed` : ' — covered'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {staffing.volunteers.length === 0 ? (
                            <p className="text-theme-text-muted text-sm">
                              Nobody has signed up yet. Email the membership below to ask for help.
                            </p>
                          ) : (
                            <ul className="border-theme-surface-border space-y-1 border-t pt-3">
                              {staffing.volunteers.map((v) => (
                                <li
                                  key={v.user_id}
                                  className="text-theme-text-secondary flex items-center gap-2 text-sm"
                                >
                                  <UserCheck className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                                  <span className="text-theme-text-primary font-medium">{v.member_name}</span>
                                  <span className="text-theme-text-muted text-xs">
                                    {v.outreach_role_label || positionLabel(v.position)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setShowVolunteerCall(!showVolunteerCall)}
                          disabled={actionLoading}
                          className="btn-info flex items-center gap-1.5 px-3 text-sm font-medium"
                        >
                          <Megaphone className="h-4 w-4" />
                          Email the Membership
                        </button>
                        {staffing?.volunteer_call_sent_at && (
                          <span className="text-theme-text-muted text-xs">
                            Last sent {formatShortDateTime(staffing.volunteer_call_sent_at, tz)}
                          </span>
                        )}
                      </div>

                      {showVolunteerCall && (
                        <div className="card space-y-3 p-4">
                          <p className="text-theme-text-muted text-xs">
                            Emails every active member with the event details and a link to sign up. Members who have
                            turned off email notifications are skipped.
                          </p>
                          <textarea
                            value={volunteerCallMessage}
                            onChange={(e) => setVolunteerCallMessage(e.target.value)}
                            rows={3}
                            maxLength={2000}
                            placeholder="Optional note — e.g. 'Looking for two people with the smoke trailer.'"
                            className="form-input placeholder-theme-text-muted text-sm"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void handleVolunteerCall(detail.id)}
                              disabled={actionLoading}
                              className="btn-primary flex items-center gap-1.5 text-sm font-medium"
                            >
                              <Send className="h-4 w-4" />
                              Send Request for Help
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowVolunteerCall(false)}
                              className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 text-sm font-medium transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  <section className="border-theme-surface-border space-y-3 border-t pt-4">
                    <h3 className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">
                      What they asked for
                    </h3>
                    <p className="text-theme-text-primary text-sm leading-relaxed whitespace-pre-wrap">
                      {detail.description}
                    </p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                      <dt className="text-theme-text-muted">When</dt>
                      <dd className="text-theme-text-primary space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
                              detail.date_flexibility === 'flexible'
                                ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
                                : detail.date_flexibility === 'general_timeframe'
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400'
                                  : 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400'
                            }`}
                          >
                            {DATE_FLEXIBILITY_LABELS[detail.date_flexibility]}
                          </span>
                          {detail.preferred_time_of_day && detail.preferred_time_of_day !== 'flexible' && (
                            <span className="text-theme-text-muted">Prefers {detail.preferred_time_of_day}</span>
                          )}
                        </span>
                        {detail.preferred_timeframe && (
                          <span className="block italic">&ldquo;{detail.preferred_timeframe}&rdquo;</span>
                        )}
                        {detail.preferred_date_start && (
                          <span className="text-theme-text-muted block">
                            {detail.preferred_date_end
                              ? `${formatShortDateTime(detail.preferred_date_start, tz)} — ${formatShortDateTime(detail.preferred_date_end, tz)}`
                              : `From ${formatShortDateTime(detail.preferred_date_start, tz)}`}
                          </span>
                        )}
                        {detail.event_date && (
                          <span className="block font-semibold text-green-700 dark:text-green-400">
                            Confirmed: {formatShortDateTime(detail.event_date, tz)}
                            {detail.event_location_name && ` @ ${detail.event_location_name}`}
                          </span>
                        )}
                      </dd>
                      <dt className="text-theme-text-muted">Where</dt>
                      <dd className="text-theme-text-primary flex items-start gap-1">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          {getVenueLabel(detail.venue_preference)}
                          {detail.venue_address && ` · ${detail.venue_address}`}
                        </span>
                      </dd>
                      {(detail.audience_size || detail.age_group) && (
                        <>
                          <dt className="text-theme-text-muted">Who</dt>
                          <dd className="text-theme-text-primary">
                            {[detail.age_group, detail.audience_size ? `~${detail.audience_size} people` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </dd>
                        </>
                      )}
                      {detail.special_requests && (
                        <>
                          <dt className="text-theme-text-muted">Special requests</dt>
                          <dd className="text-theme-text-primary whitespace-pre-wrap">{detail.special_requests}</dd>
                        </>
                      )}
                    </dl>
                  </section>

                  <section className="border-theme-surface-border space-y-1 border-t pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">Contact</h3>
                      {detail.status_token && (
                        <button
                          type="button"
                          onClick={() => copyStatusLink(detail.status_token ?? '')}
                          className="text-theme-text-muted hover:text-theme-text-primary flex min-h-11 items-center gap-1 text-xs"
                          title="The requester can follow progress at this link"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          Copy status link
                        </button>
                      )}
                    </div>
                    <p className="text-theme-text-primary text-sm font-medium">{detail.contact_name}</p>
                    {detail.organization_name && (
                      <p className="text-theme-text-secondary text-sm">{detail.organization_name}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 text-sm">
                      <a
                        href={`mailto:${detail.contact_email}`}
                        className="flex min-h-11 items-center gap-1 break-all text-blue-700 hover:underline dark:text-blue-400"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {detail.contact_email}
                      </a>
                      {detail.contact_phone && (
                        <a
                          href={`tel:${detail.contact_phone}`}
                          className="flex min-h-11 items-center gap-1 text-blue-700 hover:underline dark:text-blue-400"
                        >
                          <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {detail.contact_phone}
                        </a>
                      )}
                    </div>
                  </section>

                  <section className="border-theme-surface-border border-t pt-4">
                    <h3 className="text-theme-text-muted mb-3 flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                      Comments & Activity
                    </h3>
                    <div className="mb-3 space-y-2">
                      {detail.activity_log.map((entry) => {
                        const isComment = entry.action === 'comment';
                        return (
                          <div
                            key={entry.id}
                            className={`flex items-start gap-3 text-sm ${
                              isComment ? 'bg-theme-surface border-theme-surface-border rounded-lg border p-3' : ''
                            }`}
                          >
                            {isComment ? (
                              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                            ) : (
                              <div className="bg-theme-text-muted mt-1.5 h-2 w-2 shrink-0 rounded-full" />
                            )}
                            <div className="min-w-0 flex-1">
                              {isComment ? (
                                <p className="text-theme-text-primary whitespace-pre-wrap">{entry.notes}</p>
                              ) : (
                                <p className="text-theme-text-primary">
                                  {entry.new_status && (
                                    <span
                                      className={`mr-1 inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium ${STATUS_CONFIG[entry.new_status as EventRequestStatus]?.color || 'bg-theme-surface-secondary text-theme-text-muted'}`}
                                    >
                                      {STATUS_CONFIG[entry.new_status as EventRequestStatus]?.label || entry.new_status}
                                    </span>
                                  )}
                                  {entry.action.startsWith('task_') && (
                                    <span className="text-theme-text-muted text-xs">
                                      {entry.action.includes('completed') ? 'Completed task' : 'Uncompleted task'}
                                      {entry.details &&
                                        typeof entry.details === 'object' &&
                                        'task_id' in entry.details && (
                                          <span className="font-medium">
                                            {' '}
                                            {String(entry.details.task_id).replace(/_/g, ' ')}
                                          </span>
                                        )}
                                    </span>
                                  )}
                                  {entry.action === 'assigned' && entry.details && (
                                    <span className="text-theme-text-muted text-xs">
                                      Assigned to{' '}
                                      <span className="font-medium">
                                        {typeof entry.details === 'object' && 'assignee_name' in entry.details
                                          ? String(entry.details.assignee_name)
                                          : 'coordinator'}
                                      </span>
                                    </span>
                                  )}
                                  {entry.action === 'email_sent' && (
                                    <span className="text-theme-text-muted flex items-center gap-1 text-xs">
                                      <Mail className="h-3 w-3" />
                                      {entry.notes}
                                    </span>
                                  )}
                                  {!isComment &&
                                    !entry.new_status &&
                                    !entry.action.startsWith('task_') &&
                                    entry.action !== 'assigned' &&
                                    entry.action !== 'email_sent' &&
                                    entry.notes && <span className="text-theme-text-muted">{entry.notes}</span>}
                                </p>
                              )}
                              <p className="text-theme-text-muted mt-0.5 text-xs">
                                {entry.performer_name || 'System'} &middot; {formatShortDateTime(entry.created_at, tz)}
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
                            void handleAddComment(detail.id);
                          }
                        }}
                        placeholder="Add a comment..."
                        className="form-input flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddComment(detail.id)}
                        disabled={actionLoading || !commentText.trim()}
                        className="btn-primary flex min-w-11 items-center justify-center px-3 text-sm font-medium"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </section>
                </div>

                {!isWide && actionBar}
              </>
            )}
          </DialogPanel>
        </div>
      )}

      <PromptDialog
        isOpen={showDecline && !!detail}
        onClose={() => setShowDecline(false)}
        onSubmit={(reason) => {
          setShowDecline(false);
          if (detail) void handleStatusChange(detail.id, 'declined', undefined, reason);
        }}
        title="Decline this request?"
        message="The request closes and the requester is told it was declined."
        label="Reason"
        placeholder="e.g. We have no crew available that weekend"
        required={false}
        multiline
        hint="The requester will see this reason."
        confirmLabel="Decline request"
        cancelLabel="Keep it"
        confirmVariant="warning"
        loading={actionLoading}
      />
    </div>
  );
};

export default EventRequestsTab;
