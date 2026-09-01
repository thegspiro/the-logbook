/**
 * Event Detail Page
 *
 * Shows detailed information about an event including RSVPs and attendee management.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import { eventService, meetingsService } from '../services/api';
import { electionService } from '../services/electionService';
import type { ElectionListItem } from '../types/election';
import { getStatusBadgeClass } from '../utils/electionHelpers';
import type { Event, EventAttendee, EventListItem, RSVP, EventStats, RSVPHistory } from '../types/event';
import { useAuthStore } from '../stores/authStore';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EventTypeBadge } from '../components/EventTypeBadge';
import { RSVPStatusBadge } from '../components/RSVPStatusBadge';
import { downloadICSFile } from '../utils/eventHelpers';
import {
  formatDateTime,
  formatShortDateTime,
  formatTime,
  formatForDateTimeInput,
  localToUTC,
} from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useRSVPForm } from '../hooks/useRSVPForm';
import { useEventNotifications } from '../hooks/useEventNotifications';
import { useOverrideAttendance } from '../hooks/useOverrideAttendance';
import { EventType as EventTypeEnum, RSVPStatus as RSVPStatusEnum } from '../constants/enums';
import {
  Bell,
  Repeat,
  CalendarPlus,
  CheckCircle,
  Clock,
  ChevronDown,
  MapPin,
  StopCircle,
  Lock,
  Unlock,
} from 'lucide-react';
import { useConfirm } from '../contexts/ConfirmContext';
import { PromptDialog } from '../components/ux';
import { SimpleMarkdown } from '../utils/simpleMarkdown';
import { EventAttachmentsList } from '../components/event-detail/EventAttachmentsList';
import { EventRecurrenceInfo } from '../components/event-detail/EventRecurrenceInfo';
import { EventNotificationPanel } from '../components/event-detail/EventNotificationPanel';
import { errorTracker } from '../services/errorTracking';
import { getErrorMessage } from '../utils/errorHandling';
import { EventRSVPSection } from '../components/event-detail/EventRSVPSection';
import { EventAttendeesCard } from '../components/event-detail/EventAttendeesCard';
import EventRSVPModal from '../components/event-detail/EventRSVPModal';
import EventCancelModal from '../components/event-detail/EventCancelModal';
import EventCancelSeriesModal from '../components/event-detail/EventCancelSeriesModal';
import EventCheckInModal from '../components/event-detail/EventCheckInModal';
import EventRecordTimesModal from '../components/event-detail/EventRecordTimesModal';
import EventOverrideAttendanceModal from '../components/event-detail/EventOverrideAttendanceModal';
import EventEndConfirmModal from '../components/event-detail/EventEndConfirmModal';
import EventDeleteConfirmModal from '../components/event-detail/EventDeleteConfirmModal';
import EventSaveTemplateModal from '../components/event-detail/EventSaveTemplateModal';
import TrainingSessionLinkageCard from '../components/event-detail/TrainingSessionLinkageCard';
import EventProspectsCard from '../components/event-detail/EventProspectsCard';
import { buildCsv, downloadCsv } from '../utils/csv';

/**
 * `custom_fields` keys that are not custom fields.
 *
 * Two kinds of bookkeeping share the column with what a coordinator typed:
 * the training block above renders its own keys, and the scheduled tasks use
 * it to remember what they have already sent. Neither belongs in the "Event
 * Details" list, which is otherwise a faithful dump of the column — a member
 * opening an event saw "Validation Notification Sent: true" beside the
 * description.
 */
const HIDDEN_CUSTOM_FIELD_KEYS = new Set([
  // Rendered by the training-specific block above.
  'course_name',
  'course_code',
  'credit_hours',
  'training_type',
  'instructor',
  'issuing_agency',
  'certification_name',
  'certification_expiry_months',
  'issues_certification',
  'auto_create_records',
  'expiration_months',
  // Written by the scheduler to avoid re-sending; internal bookkeeping.
  'reminders_sent',
  'validation_notification_sent',
  'series_end_reminder_sent',
  // Legacy twin of attendance_finalized_at, kept for the reminder task. The
  // lock is shown as a banner, not as a details row reading "true".
  'attendance_finalized',
]);

const DISPLAYED_TRAINING_FIELD_KEYS = [
  'course_name',
  'course_code',
  'credit_hours',
  'training_type',
  'instructor',
  'issuing_agency',
  'expiration_months',
  'issues_certification',
  'auto_create_records',
] as const;

/** True when the column holds anything the details card would draw. */
const hasVisibleCustomFields = (event: Event): boolean => {
  const fields = event.custom_fields;
  if (!fields) return false;

  return (
    Object.keys(fields).some((key) => !HIDDEN_CUSTOM_FIELD_KEYS.has(key)) ||
    (event.event_type === EventTypeEnum.TRAINING && DISPLAYED_TRAINING_FIELD_KEYS.some((key) => Boolean(fields[key])))
  );
};

export const EventDetailPage: React.FC = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  // Distinguishes "the roster failed to load" from "nobody is going". Without
  // it an outage renders an empty list that reads as fact.
  const [attendeesFailed, setAttendeesFailed] = useState(false);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showRecordTimesModal, setShowRecordTimesModal] = useState(false);
  const [showCancelSeriesModal, setShowCancelSeriesModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEndEventConfirm, setShowEndEventConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finalizingAttendance, setFinalizingAttendance] = useState(false);
  const [showReopenPrompt, setShowReopenPrompt] = useState(false);
  const [reopeningAttendance, setReopeningAttendance] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [eligibleMembers, setEligibleMembers] = useState<
    Array<{ id: string; first_name: string; last_name: string; email: string }>
  >([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [actualStartTime, setActualStartTime] = useState('');
  const [actualEndTime, setActualEndTime] = useState('');
  const [removeConfirmUserId, setRemoveConfirmUserId] = useState<string | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [seriesEvents, setSeriesEvents] = useState<EventListItem[]>([]);
  const [showAllOccurrences, setShowAllOccurrences] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [bulkAddLoading, setBulkAddLoading] = useState(false);
  const [rsvpHistory, setRsvpHistory] = useState<RSVPHistory[]>([]);
  const [linkedElections, setLinkedElections] = useState<ElectionListItem[]>([]);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const reminderMenuRef = useRef<HTMLDivElement>(null);

  const { checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('events.manage');
  // Deliberately a separate grant from events.manage: whoever closed the event
  // should not also be able to quietly reopen it and move the numbers.
  const canReopenAttendance = checkPermission('events.reopen_attendance');
  const { confirm } = useConfirm();

  // Extracted hooks for RSVP form, notifications, and override attendance
  // Refreshes the shared roster alongside the event after the member responds.
  // fetchAttendees otherwise runs only on mount, so a member who joined stayed
  // absent from the list they were looking at until a reload.
  const rsvpForm = useRSVPForm({
    eventId,
    event,
    onSuccess: async () => {
      await fetchEvent();
      if (canManage) {
        await fetchRSVPs();
        await fetchStats();
      } else {
        await fetchAttendees();
      }
    },
  });
  const notifications = useEventNotifications(eventId);
  const override = useOverrideAttendance({
    eventId,
    timezone: tz,
    officialStartTime: event?.actual_start_time ?? event?.start_datetime,
    officialEndTime: event?.actual_end_time ?? event?.end_datetime,
    onSuccess: async () => {
      await fetchRSVPs();
      await fetchStats();
    },
  });

  // Close actions menu and reminder menu on click outside
  const closeReminderMenu = notifications.setShowReminderMenu;
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
      if (reminderMenuRef.current && !reminderMenuRef.current.contains(e.target as Node)) {
        closeReminderMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeReminderMenu]);

  useEffect(() => {
    if (eventId) {
      void fetchEvent();
      void fetchLinkedElections();
      if (canManage) {
        void fetchRSVPs();
        void fetchStats();
        void fetchRSVPHistory();
      } else {
        // Outside the canManage branch on purpose: this is the one roster an
        // ordinary member can see. A 403 (the event is not shared) resolves to
        // an empty list in the service, so there is nothing to handle here.
        void fetchAttendees();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, canManage]);

  const fetchEvent = async () => {
    if (!eventId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEvent(eventId);
      setEvent(data);
      void fetchSeriesEvents(data);
    } catch (err) {
      setError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to load event');
    } finally {
      setLoading(false);
    }
  };

  const fetchLinkedElections = async () => {
    if (!eventId) return;
    try {
      const elections = await electionService.getElectionsByEvent(eventId);
      setLinkedElections(elections);
    } catch {
      setLinkedElections([]);
    }
  };

  const fetchRSVPs = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEventRSVPs(eventId);
      setRsvps(data);
    } catch {
      toast.error('Failed to load RSVPs');
    }
  };

  const fetchAttendees = async () => {
    if (!eventId) return;

    try {
      setAttendeesLoading(true);
      setAttendeesFailed(false);
      const data = await eventService.getEventAttendees(eventId);
      // Coerced rather than trusted: this card is supplementary, and a
      // malformed roster payload must not be able to take down the whole
      // event page for a member who was only reading it.
      setAttendees(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      // getEventAttendees already turns 403/404 — "you may not see this" — into
      // an empty list, so anything reaching here is a genuine network or server
      // failure. Rendering an empty roster for one would tell the member
      // nobody is coming, which is a wrong answer rather than a safe one, so
      // the card is suppressed and the failure is recorded.
      errorTracker.logError(err instanceof Error ? err : new Error(getErrorMessage(err, 'Failed to load attendees')), {
        eventId,
        additionalContext: { operation: 'fetchAttendees' },
      });
      setAttendees([]);
      setAttendeesFailed(true);
    } finally {
      setAttendeesLoading(false);
    }
  };

  const fetchStats = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEventStats(eventId);
      setStats(data);
    } catch {
      toast.error('Failed to load event statistics');
    }
  };

  const fetchRSVPHistory = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getRSVPHistory(eventId, 50);
      setRsvpHistory(data);
    } catch {
      // Silently fail — history is supplementary info
    }
  };

  const fetchSeriesEvents = useCallback(async (ev: Event) => {
    const parentId = ev.recurrence_parent_id || (ev.is_recurring ? ev.id : null);
    if (!parentId) {
      setSeriesEvents([]);
      return;
    }
    try {
      const allEvents = await eventService.getEvents({ limit: 200 });
      const siblings = allEvents
        .filter((e) => e.recurrence_parent_id === parentId || e.id === parentId)
        .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime());
      setSeriesEvents(siblings);
    } catch {
      // Silently fail — series navigation is non-critical
      setSeriesEvents([]);
    }
  }, []);

  const printRoster = () => {
    if (!rsvps || !event) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rows = rsvps
      .map(
        (r) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd">${esc(r.user_name ?? '')}</td>
        <td style="padding:8px;border:1px solid #ddd">${esc(r.status)}</td>
        <td style="padding:8px;border:1px solid #ddd">${r.checked_in ? 'Yes' : 'No'}</td>
        <td style="padding:8px;border:1px solid #ddd">${r.guest_count ?? 0}</td>
        <td style="padding:8px;border:1px solid #ddd"></td>
      </tr>
    `
      )
      .join('');

    const safeTitle = esc(event.title);
    printWindow.document.write(`
      <html><head><title>Attendance Roster - ${safeTitle}</title></head>
      <body style="font-family:Arial,sans-serif;padding:20px">
        <h1 style="font-size:24px;margin-bottom:4px">${safeTitle}</h1>
        <p style="color:#666;margin-bottom:16px">${esc(formatDateTime(event.start_datetime, tz))}</p>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Name</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">RSVP Status</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Checked In</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Guests</th>
            <th style="padding:8px;border:1px solid #ddd;text-align:left">Signature</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:16px;color:#999;font-size:12px">Total RSVPs: ${rsvps.length}</p>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const fetchEligibleMembers = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEligibleMembers(eventId);
      setEligibleMembers(data);
    } catch {
      toast.error('Failed to load eligible members');
    }
  };

  const handleBulkAddAllEligible = async () => {
    if (!eventId) return;

    // Get eligible members who don't already have an RSVP
    const notRsvpd = eligibleMembers.filter((m) => !rsvps.find((r) => r.user_id === m.id));

    if (notRsvpd.length === 0) {
      toast.error('All eligible members already have an RSVP');
      return;
    }

    try {
      setBulkAddLoading(true);
      const result = await eventService.bulkAddAttendees(
        eventId,
        notRsvpd.map((m) => m.id),
        'going'
      );
      toast.success(`Added ${result.created_count} members to the event`);
      await fetchRSVPs();
      await fetchStats();
      await fetchEligibleMembers();
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to bulk add attendees');
    } finally {
      setBulkAddLoading(false);
    }
  };

  const openCheckInModal = () => {
    void fetchEligibleMembers();
    setShowCheckInModal(true);
    setMemberSearch('');
  };

  // handleRSVP is now in rsvpForm.handleSubmit

  const handleCancelEvent = async (payload: { cancellationReason: string; sendNotifications: boolean }) => {
    if (!eventId) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      await eventService.cancelEvent(eventId, {
        cancellation_reason: payload.cancellationReason,
        send_notifications: payload.sendNotifications,
      });

      setShowCancelModal(false);
      toast.success('Event cancelled successfully');
      await fetchEvent();
    } catch (err) {
      setSubmitError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to cancel event');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSeries = async (payload: {
    cancellationReason: string;
    sendNotifications: boolean;
    futureOnly: boolean;
  }) => {
    if (!event) return;

    const parentId = event.recurrence_parent_id || event.id;
    try {
      setSubmitting(true);
      setSubmitError(null);

      const result = await eventService.cancelEventSeries(
        parentId,
        {
          cancellation_reason: payload.cancellationReason,
          send_notifications: payload.sendNotifications,
        },
        payload.futureOnly
      );

      setShowCancelSeriesModal(false);
      toast.success(result.message);
      await fetchEvent();
    } catch (err) {
      setSubmitError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to cancel series');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckIn = async (userId: string) => {
    if (!eventId) return;

    try {
      await eventService.checkInAttendee(eventId, { user_id: userId });
      await fetchRSVPs();
      await fetchStats();
      toast.success('Member checked in successfully');
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to check in attendee');
    }
  };

  const handleDuplicateEvent = async () => {
    if (!eventId) return;

    try {
      setSubmitting(true);
      const newEvent = await eventService.duplicateEvent(eventId);
      toast.success('Event duplicated successfully');
      void navigate(`/events/${newEvent.id}/edit`);
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to duplicate event');
    } finally {
      setSubmitting(false);
    }
  };

  // handleSendReminders is now in notifications.handleSendReminders

  // handleSendNotification is now in notifications.handleSendNotification

  const handleDeleteEvent = async (scope: 'single' | 'series') => {
    if (!eventId || !event) return;

    try {
      setSubmitting(true);
      if (scope === 'series' && (event.is_recurring || event.recurrence_parent_id)) {
        const parentId = event.recurrence_parent_id || eventId;
        await eventService.deleteEventSeries(parentId);
        toast.success('All events in the series deleted');
      } else {
        await eventService.deleteEvent(eventId);
        toast.success('Event deleted successfully');
      }
      void navigate('/events');
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to delete event');
    } finally {
      setSubmitting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleFinalizeAttendance = async () => {
    if (!eventId) return;

    // Finalizing closes the event: check-in, attendee edits and time
    // corrections all stop working afterwards, and only a department leader
    // can undo it. That is worth a sentence before the click, not a toast
    // after it.
    const confirmed = await confirm({
      title: 'Finalize attendance?',
      message:
        'This closes the event. Credited hours are written to the members\u2019 ' +
        'records, and check-in, adding or removing attendees, and correcting ' +
        'times all stop being available. Only someone who can reopen ' +
        'attendance will be able to make further changes.',
      confirmLabel: 'Finalize and close',
      cancelLabel: 'Keep it open',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      setFinalizingAttendance(true);
      const result = await eventService.finalizeAttendance(eventId);
      if (result.updated_count > 0) {
        toast.success(
          `Attendance finalized for ${result.updated_count} member${result.updated_count !== 1 ? 's' : ''}`
        );
      } else {
        toast.success('Attendance finalized');
      }
      // Refetch the event too: the lock it just acquired is what decides which
      // actions this page still offers.
      await fetchEvent();
      await fetchRSVPs();
      await fetchStats();
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to finalize attendance');
    } finally {
      setFinalizingAttendance(false);
    }
  };

  const handleReopenAttendance = async (reason: string) => {
    if (!eventId) return;

    try {
      setReopeningAttendance(true);
      await eventService.reopenAttendance(eventId, reason);
      toast.success('Attendance reopened for corrections');
      setShowReopenPrompt(false);
      await fetchEvent();
      await fetchRSVPs();
      await fetchStats();
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to reopen attendance');
    } finally {
      setReopeningAttendance(false);
    }
  };

  const handleEndEvent = async () => {
    if (!eventId) return;

    try {
      setSubmitting(true);
      const result = await eventService.endEvent(eventId);
      const count = result.checked_out_count;
      toast.success(count > 0 ? `Event ended — ${count} member${count !== 1 ? 's' : ''} checked out` : 'Event ended');
      setShowEndEventConfirm(false);
      await fetchEvent();
      if (canManage) {
        await fetchRSVPs();
        await fetchStats();
      }
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to end event');
    } finally {
      setSubmitting(false);
    }
  };

  const openRecordTimesModal = () => {
    if (event) {
      // Prefer recorded official times, using the schedule until they are recorded.
      setActualStartTime(formatForDateTimeInput(event.actual_start_time ?? event.start_datetime, tz));
      setActualEndTime(formatForDateTimeInput(event.actual_end_time ?? event.end_datetime, tz));
    }
    setShowRecordTimesModal(true);
    setSubmitError(null);
  };

  const handleRecordTimes = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      await eventService.recordActualTimes(eventId, {
        actual_start_time: actualStartTime ? localToUTC(actualStartTime, tz) : undefined,
        actual_end_time: actualEndTime ? localToUTC(actualEndTime, tz) : undefined,
      });

      setShowRecordTimesModal(false);
      await fetchEvent();
      if (canManage) {
        await fetchRSVPs();
      }
    } catch (err) {
      setSubmitError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to record times');
    } finally {
      setSubmitting(false);
    }
  };

  // openOverrideModal/handleOverrideAttendance now in override hook

  const handleRemoveAttendee = async (userId: string) => {
    if (!eventId) return;

    try {
      await eventService.removeAttendee(eventId, userId);
      setRemoveConfirmUserId(null);
      await fetchRSVPs();
      await fetchStats();
      toast.success('Attendee removed');
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to remove attendee');
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading event details..." />;
  }

  if (error || !event) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error || 'Event not found'}</p>
          <button
            onClick={() => void navigate('/events')}
            className="mt-2 text-sm text-red-700 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
          >
            Back to Events
          </button>
        </div>
      </div>
    );
  }

  const isPastEvent = new Date(event.end_datetime) < new Date();
  const isEventOver = isPastEvent || Boolean(event.actual_end_time);
  const hasStarted = new Date(event.start_datetime) <= new Date();
  const isOngoing = hasStarted && !isPastEvent && !event.is_cancelled && !event.actual_end_time;
  // The API refuses every attendance write past this point, so the actions
  // that would hit those endpoints are not rendered at all — an enabled button
  // that always 409s is worse than an absent one.
  const isAttendanceFinalized = Boolean(event.attendance_finalized_at);
  // Seats taken, which is what max_attendees caps. Falls back to the member
  // count for payloads predating the aggregate.
  const occupiedSeats = event.occupied_seats ?? event.going_count ?? 0;
  // No requires_rsvp here, deliberately. That flag means "a response is
  // expected" — it drives the Required row in the sidebar, the deadline
  // countdown and the non-respondent reminder audience — not "responses are
  // permitted". A member may always tell the department they are coming.
  // is_draft is included because the API refuses drafts outright, and an
  // enabled button that always 400s is worse than an absent one.
  const canRSVP =
    !event.is_cancelled &&
    !event.is_draft &&
    !isPastEvent &&
    !isAttendanceFinalized &&
    (!event.rsvp_deadline || new Date(event.rsvp_deadline) > new Date());

  // RSVP deadline countdown
  const rsvpCountdown = (() => {
    if (!event.requires_rsvp || !event.rsvp_deadline) return null;
    const remaining = new Date(event.rsvp_deadline).getTime() - Date.now();
    const ONE_MINUTE = 60 * 1000;
    const ONE_HOUR = 60 * ONE_MINUTE;
    const ONE_DAY = 24 * ONE_HOUR;
    const SEVEN_DAYS = 7 * ONE_DAY;

    if (remaining <= 0) {
      return { text: 'RSVP Closed', color: 'text-red-500' };
    } else if (remaining < ONE_HOUR) {
      const minutes = Math.max(1, Math.ceil(remaining / ONE_MINUTE));
      return { text: `RSVP closes in ${minutes} minute${minutes !== 1 ? 's' : ''}`, color: 'text-red-500' };
    } else if (remaining < ONE_DAY) {
      const hours = Math.ceil(remaining / ONE_HOUR);
      return { text: `RSVP closes in ${hours} hour${hours !== 1 ? 's' : ''}`, color: 'text-amber-500' };
    } else if (remaining < SEVEN_DAYS) {
      const days = Math.ceil(remaining / ONE_DAY);
      return { text: `RSVP closes in ${days} day${days !== 1 ? 's' : ''}`, color: 'text-amber-500' };
    } else {
      return {
        text: `RSVP deadline: ${formatShortDateTime(event.rsvp_deadline, tz)}`,
        color: 'text-theme-text-secondary',
      };
    }
  })();

  const exportAttendanceCSV = () => {
    if (!rsvps || !event) return;
    const headers = ['Name', 'Email', 'RSVP Status', 'Guest Count', 'Checked In', 'Check-In Time', 'Notes'];
    const rows = rsvps.map((r) => [
      r.user_name || '',
      r.user_email || '',
      r.status,
      String(r.guest_count ?? 0),
      r.checked_in ? 'Yes' : 'No',
      r.checked_in_at ? formatDateTime(r.checked_in_at, tz) : '',
      r.notes || '',
    ]);
    downloadCsv(buildCsv([headers, ...rows]), `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}_attendance.csv`);
  };

  // Compute series navigation (prev/next occurrence)
  const currentSeriesIndex = seriesEvents.findIndex((e) => e.id === eventId);
  const prevOccurrence = currentSeriesIndex > 0 ? (seriesEvents[currentSeriesIndex - 1] ?? null) : null;
  const nextOccurrence =
    currentSeriesIndex >= 0 && currentSeriesIndex < seriesEvents.length - 1
      ? (seriesEvents[currentSeriesIndex + 1] ?? null)
      : null;
  const seriesPosition = currentSeriesIndex >= 0 ? currentSeriesIndex + 1 : null;
  const seriesTotal = seriesEvents.length > 0 ? seriesEvents.length : null;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            to="/events"
            className="text-theme-text-muted hover:text-theme-text-primary mb-4 inline-flex items-center text-sm"
          >
            <svg className="mr-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Events
          </Link>

          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
            <div className="min-w-0">
              <h1 className="text-theme-text-primary text-2xl font-bold wrap-break-word sm:text-3xl">{event.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <EventTypeBadge type={event.event_type} size="sm" />
                {event.is_draft && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-500/20 dark:text-gray-300">
                    Draft
                  </span>
                )}
                {event.is_cancelled && (
                  <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                    Cancelled
                  </span>
                )}
                {event.is_mandatory && (
                  <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                    Mandatory
                  </span>
                )}
                {(event.is_recurring || event.recurrence_parent_id) && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                    <Repeat className="h-3 w-3" />
                    Recurring
                  </span>
                )}
              </div>
              {/* Series navigation for recurring events */}
              {(event.is_recurring || event.recurrence_parent_id) && seriesEvents.length > 1 && (
                <EventRecurrenceInfo
                  eventId={eventId || ''}
                  seriesEvents={seriesEvents}
                  seriesPosition={seriesPosition}
                  seriesTotal={seriesTotal}
                  prevOccurrence={prevOccurrence}
                  nextOccurrence={nextOccurrence}
                  showAllOccurrences={showAllOccurrences}
                  onToggleAllOccurrences={() => setShowAllOccurrences((prev) => !prev)}
                  timezone={tz}
                />
              )}
            </div>

            {!event.is_cancelled && (
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {/* Primary actions — always visible */}
                {event.is_draft && canManage && (
                  <button
                    onClick={() => {
                      if (!eventId) return;
                      void (async () => {
                        try {
                          setSubmitting(true);
                          await eventService.publishEvent(eventId);
                          toast.success('Event published successfully');
                          await fetchEvent();
                        } catch (err) {
                          toast.error(
                            (err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to publish event'
                          );
                        } finally {
                          setSubmitting(false);
                        }
                      })();
                    }}
                    disabled={submitting}
                    className="btn-primary inline-flex items-center rounded-md text-sm font-medium"
                  >
                    Publish
                  </button>
                )}
                {canRSVP && (
                  <button
                    onClick={rsvpForm.openModal}
                    className="btn-primary inline-flex items-center rounded-md text-sm font-medium"
                  >
                    {event.user_rsvp_status ? 'Update RSVP' : event.requires_rsvp ? 'RSVP Now' : "I'm coming"}
                  </button>
                )}
                {rsvpCountdown && !event.user_rsvp_status && (
                  <span className={`inline-flex items-center gap-1.5 text-sm ${rsvpCountdown.color}`}>
                    <Clock className="h-4 w-4" />
                    {rsvpCountdown.text}
                  </span>
                )}
                <button
                  onClick={() => void navigate(`/events/${eventId}/qr-code`)}
                  className="btn-secondary inline-flex items-center border-blue-300 text-sm font-medium text-blue-700 shadow-xs hover:bg-blue-500/20 dark:text-blue-400"
                >
                  <svg
                    className="mr-2 h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                    />
                  </svg>
                  View QR Code
                </button>
                <button
                  onClick={() => downloadICSFile(event)}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors"
                >
                  <CalendarPlus className="h-4 w-4" />
                  Add to Calendar
                </button>
                {/* Outside the canManage group on purpose: events.reopen_attendance
                    is deliberately independent of events.manage, so a role that
                    holds only the recovery grant still gets the control the
                    backend already authorizes it for. */}
                {isAttendanceFinalized && canReopenAttendance && (
                  <button
                    onClick={() => setShowReopenPrompt(true)}
                    disabled={reopeningAttendance}
                    className="btn-secondary text-theme-text-secondary inline-flex items-center text-sm font-medium shadow-xs disabled:opacity-50"
                  >
                    <Unlock className="mr-2 h-4 w-4" />
                    {reopeningAttendance ? 'Reopening...' : 'Reopen Attendance'}
                  </button>
                )}

                {canManage && (
                  <>
                    {/* Kept when finalized: the API still accepts descriptive
                        edits (title, description, location) and refuses only
                        the fields the credited durations came from. Hiding this
                        made a leader reopen attendance just to fix a typo,
                        which unlocks far more than the typo needed. */}
                    <button
                      onClick={() => void navigate(`/events/${eventId}/edit`)}
                      className="btn-secondary text-theme-text-secondary inline-flex items-center text-sm font-medium shadow-xs"
                    >
                      <svg
                        className="mr-2 h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      Edit
                    </button>
                    {!isAttendanceFinalized && (
                      <button
                        onClick={openCheckInModal}
                        className="btn-secondary text-theme-text-secondary inline-flex items-center text-sm font-medium shadow-xs"
                      >
                        <svg
                          className="mr-2 h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                          />
                        </svg>
                        Check In
                      </button>
                    )}

                    {/* Send Reminders dropdown */}
                    {!event.is_cancelled && !isAttendanceFinalized && (
                      <div className="relative" ref={reminderMenuRef}>
                        <button
                          onClick={() => notifications.setShowReminderMenu(!notifications.showReminderMenu)}
                          disabled={notifications.sendingReminders}
                          className="btn-secondary text-theme-text-secondary inline-flex items-center text-sm font-medium shadow-xs"
                        >
                          <Bell className="mr-2 h-4 w-4" />
                          {notifications.sendingReminders ? 'Sending...' : 'Send Reminders'}
                          <ChevronDown className="ml-1 h-4 w-4" />
                        </button>
                        {notifications.showReminderMenu && (
                          <div className="popover-panel absolute right-0 z-20 mt-2 w-56">
                            <div className="py-1">
                              <button
                                onClick={() => void notifications.handleSendReminders('non_respondents')}
                                className="text-theme-text-secondary hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm"
                              >
                                Non-respondents only
                              </button>
                              <button
                                onClick={() => void notifications.handleSendReminders('all')}
                                className="text-theme-text-secondary hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm"
                              >
                                All members
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* End Event button — visible when event is in progress */}
                    {isOngoing && !isAttendanceFinalized && (
                      <button
                        onClick={() => setShowEndEventConfirm(true)}
                        disabled={submitting}
                        className="inline-flex items-center rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-xs hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40"
                      >
                        <StopCircle className="mr-2 h-4 w-4" />
                        End Event
                      </button>
                    )}

                    {isEventOver && !isAttendanceFinalized && (
                      <button
                        onClick={() => void handleFinalizeAttendance()}
                        disabled={finalizingAttendance}
                        className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
                      >
                        <CheckCircle className="mr-2 h-4 w-4" />
                        {finalizingAttendance ? 'Finalizing...' : 'Finalize Attendance'}
                      </button>
                    )}

                    {/* "More" dropdown for secondary actions */}
                    <div className="relative" ref={actionsMenuRef}>
                      <button
                        onClick={() => setShowActionsMenu(!showActionsMenu)}
                        className="btn-secondary text-theme-text-secondary inline-flex items-center text-sm font-medium shadow-xs"
                      >
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                          />
                        </svg>
                        <span className="ml-1">More</span>
                      </button>
                      {showActionsMenu && (
                        <div className="popover-panel absolute right-0 z-20 mt-2 w-56">
                          <div className="py-1">
                            <button
                              onClick={() => {
                                setShowActionsMenu(false);
                                void handleDuplicateEvent();
                              }}
                              disabled={submitting}
                              className="text-theme-text-secondary hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm disabled:opacity-50"
                            >
                              Duplicate Event
                            </button>
                            {!isAttendanceFinalized && (
                              <button
                                onClick={() => {
                                  setShowActionsMenu(false);
                                  openRecordTimesModal();
                                }}
                                className="text-theme-text-secondary hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm"
                              >
                                Record Times
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setShowActionsMenu(false);
                                void navigate(`/events/${eventId}/monitoring`);
                              }}
                              className="text-theme-text-secondary hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm"
                            >
                              Monitoring Dashboard
                            </button>
                            <button
                              onClick={() => {
                                setShowActionsMenu(false);
                                void (async () => {
                                  if (!eventId) return;
                                  try {
                                    await meetingsService.createFromEvent(eventId);
                                    toast.success('Meeting created from event');
                                    void navigate(`/minutes`);
                                  } catch (err) {
                                    const axiosErr = err as AxiosError<{ detail?: string }>;
                                    toast.error(axiosErr.response?.data?.detail || 'Failed to create meeting');
                                  }
                                })();
                              }}
                              disabled={submitting}
                              className="text-theme-text-secondary hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm disabled:opacity-50"
                            >
                              Create Meeting
                            </button>
                            <button
                              onClick={() => {
                                setShowActionsMenu(false);
                                setTemplateName(event.title);
                                setTemplateDescription('');
                                setShowTemplateModal(true);
                              }}
                              className="text-theme-text-secondary hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm"
                            >
                              Save as Template
                            </button>
                            {/* Cancelling or deleting a closed event would
                                contradict the attendance it already credited,
                                and the API refuses both. */}
                            {!isAttendanceFinalized && (
                              <>
                                <div className="border-theme-surface-border my-1 border-t" />
                                <button
                                  onClick={() => {
                                    setShowActionsMenu(false);
                                    setShowCancelModal(true);
                                  }}
                                  className="hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm text-red-600 dark:text-red-400"
                                >
                                  Cancel Event
                                </button>
                                {(event.is_recurring || event.recurrence_parent_id) && (
                                  <button
                                    onClick={() => {
                                      setShowActionsMenu(false);
                                      setShowCancelSeriesModal(true);
                                    }}
                                    className="hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm text-red-600 dark:text-red-400"
                                  >
                                    Cancel Entire Series
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setShowActionsMenu(false);
                                    setShowDeleteConfirm(true);
                                  }}
                                  className="hover:bg-theme-surface-hover w-full px-4 py-2.5 text-left text-sm text-red-600 dark:text-red-400"
                                >
                                  Delete Event
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Event Details */}
            <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
              <h2 className="text-theme-text-primary mb-4 text-lg font-medium">Event Details</h2>

              {event.is_cancelled && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                  <p className="text-sm font-medium text-red-700 dark:text-red-300">This event has been cancelled</p>
                  {event.cancellation_reason && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">Reason: {event.cancellation_reason}</p>
                  )}
                </div>
              )}

              {isAttendanceFinalized && (
                <div className="border-theme-surface-border bg-theme-surface-hover mb-4 rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <Lock className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                    <div>
                      <p className="text-theme-text-primary text-sm font-medium">Attendance finalized</p>
                      <p className="text-theme-text-secondary mt-1 text-sm">
                        {event.attendance_finalized_by_name
                          ? `Closed by ${event.attendance_finalized_by_name}`
                          : 'Closed'}
                        {event.attendance_finalized_at
                          ? ` on ${formatDateTime(event.attendance_finalized_at, tz)}`
                          : ''}
                        . Credited hours are recorded, and attendance can no longer be changed.
                      </p>
                      {canReopenAttendance && (
                        <p className="text-theme-text-muted mt-1 text-sm">
                          Use Reopen Attendance to make a correction, then finalize again.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {event.description && (
                <div className="mb-4">
                  <h3 className="text-theme-text-secondary mb-1 text-sm font-medium">Description</h3>
                  <SimpleMarkdown text={event.description} className="text-theme-text-secondary prose-sm" />
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-start">
                  <svg
                    className="text-theme-text-muted mr-3 h-5 w-5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <div>
                    <p className="text-theme-text-secondary text-sm font-medium">Date & Time</p>
                    <p className="text-theme-text-secondary text-sm">{formatDateTime(event.start_datetime, tz)}</p>
                    <p className="text-theme-text-secondary text-sm">to {formatTime(event.end_datetime, tz)}</p>
                  </div>
                </div>

                {(event.location_name || event.location) && (
                  <div className="flex items-start">
                    <svg
                      className="text-theme-text-muted mr-3 h-5 w-5 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    <div>
                      <p className="text-theme-text-secondary text-sm font-medium">Location</p>
                      <p className="text-theme-text-secondary text-sm">{event.location_name || event.location}</p>
                      {event.location_details && (
                        <p className="text-theme-text-muted mt-1 text-sm">{event.location_details}</p>
                      )}
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location_name || event.location || '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        Get Directions
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Custom Fields / Training Session Details.
                Gated on there being something *visible* to show. Keying it on
                the column being non-empty drew an empty purple card for any
                event the scheduler had touched, since its bookkeeping keys
                count towards the length but never render. */}
            {event.custom_fields && hasVisibleCustomFields(event) && (
              <div className="bg-theme-surface rounded-lg border-l-4 border-purple-600 p-6 shadow-sm backdrop-blur-xs">
                <div className="mb-4 flex items-center">
                  <svg
                    className="mr-2 h-6 w-6 text-purple-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    />
                  </svg>
                  <h2 className="text-theme-text-primary text-lg font-medium">
                    {event.event_type === EventTypeEnum.TRAINING ? 'Training Session Details' : 'Event Details'}
                  </h2>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {event.event_type === EventTypeEnum.TRAINING && (
                    <>
                      {event.custom_fields.course_name && (
                        <div>
                          <p className="text-theme-text-secondary text-sm font-medium">Course Name</p>
                          <p className="text-theme-text-primary text-sm">{event.custom_fields.course_name}</p>
                        </div>
                      )}

                      {event.custom_fields.course_code && (
                        <div>
                          <p className="text-theme-text-secondary text-sm font-medium">Course Code</p>
                          <p className="text-theme-text-primary text-sm">{event.custom_fields.course_code}</p>
                        </div>
                      )}

                      {event.custom_fields.credit_hours && (
                        <div>
                          <p className="text-theme-text-secondary text-sm font-medium">Credit Hours</p>
                          <p className="text-theme-text-primary text-sm">{event.custom_fields.credit_hours} hours</p>
                        </div>
                      )}

                      {event.custom_fields.training_type && (
                        <div>
                          <p className="text-theme-text-secondary text-sm font-medium">Training Type</p>
                          <p className="text-theme-text-primary text-sm capitalize">
                            {typeof event.custom_fields.training_type === 'string'
                              ? event.custom_fields.training_type.replace('_', ' ')
                              : event.custom_fields.training_type}
                          </p>
                        </div>
                      )}

                      {event.custom_fields.instructor && (
                        <div>
                          <p className="text-theme-text-secondary text-sm font-medium">Instructor</p>
                          <p className="text-theme-text-primary text-sm">{event.custom_fields.instructor}</p>
                        </div>
                      )}

                      {event.custom_fields.issuing_agency && (
                        <div>
                          <p className="text-theme-text-secondary text-sm font-medium">Issuing Agency</p>
                          <p className="text-theme-text-primary text-sm">{event.custom_fields.issuing_agency}</p>
                        </div>
                      )}

                      {event.custom_fields.expiration_months && (
                        <div>
                          <p className="text-theme-text-secondary text-sm font-medium">Certification Valid For</p>
                          <p className="text-theme-text-primary text-sm">
                            {event.custom_fields.expiration_months} months
                          </p>
                        </div>
                      )}

                      {event.custom_fields.issues_certification && (
                        <div className="col-span-2">
                          <div className="flex items-center rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-500/30 dark:bg-green-500/10">
                            <svg
                              className="mr-2 h-5 w-5 text-green-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <span className="text-sm font-medium text-green-800 dark:text-green-400">
                              This training issues a certification upon completion
                            </span>
                          </div>
                        </div>
                      )}

                      {event.custom_fields.auto_create_records && (
                        <div className="col-span-2">
                          <div className="flex items-center rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
                            <svg
                              className="mr-2 h-5 w-5 text-blue-600"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13 10V3L4 14h7v7l9-11h-7z"
                              />
                            </svg>
                            <span className="text-sm font-medium text-blue-800 dark:text-blue-400">
                              Training records are automatically created when members check in
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Generic custom fields (excludes training-specific keys) */}
                  {Object.entries(event.custom_fields)
                    .filter(([key]) => !HIDDEN_CUSTOM_FIELD_KEYS.has(key))
                    .map(([key, value]) => (
                      <div key={key}>
                        <p className="text-theme-text-secondary text-sm font-medium">
                          {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                        </p>
                        <p className="text-theme-text-primary text-sm">{String(value)}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Requirement/program links for the attached training session.
                Renders nothing when the event has no training session. */}
            {event.event_type === EventTypeEnum.TRAINING && (
              <TrainingSessionLinkageCard eventId={event.id} canManage={canManage} canReopen={canReopenAttendance} />
            )}

            {/* Pipeline meeting stages can also link prospects to ordinary
                business events, so this is intentionally not type-gated. */}
            <EventProspectsCard eventId={event.id} createsProspects={event.guest_check_in_creates_prospect ?? false} />

            {/* Attachments */}
            {event.attachments && event.attachments.length > 0 && (
              <EventAttachmentsList
                attachments={event.attachments}
                eventId={event.id}
                getAttachmentDownloadUrl={(eid, aid) => eventService.getAttachmentDownloadUrl(eid, aid)}
              />
            )}

            {/* Linked Elections */}
            {linkedElections.length > 0 && (
              <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
                <h2 className="text-theme-text-primary mb-4 text-lg font-medium">Linked Elections</h2>
                <div className="space-y-3">
                  {linkedElections.map((election) => (
                    <Link
                      key={election.id}
                      to={`/elections/${election.id}`}
                      className="border-theme-surface-border hover:bg-theme-surface-hover flex items-center justify-between rounded-lg border p-3 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-theme-text-primary truncate text-sm font-medium">{election.title}</p>
                        <p className="text-theme-text-muted mt-0.5 text-xs">
                          {election.election_type.replace(/_/g, ' ')}
                          {election.positions && election.positions.length > 0
                            ? ` · ${election.positions.join(', ')}`
                            : ''}
                        </p>
                      </div>
                      <span
                        className={`ml-3 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusBadgeClass(election.status)}`}
                      >
                        {election.status}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* User's RSVP Status */}
            {event.user_rsvp_status && (
              <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
                <h2 className="text-theme-text-primary mb-4 text-lg font-medium">Your RSVP</h2>
                <div className="flex items-center space-x-4">
                  <RSVPStatusBadge status={event.user_rsvp_status} />
                  {canRSVP && (
                    <button
                      onClick={rsvpForm.openModal}
                      className="text-sm text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Change RSVP
                    </button>
                  )}
                </div>
                {event.user_rsvp_status === RSVPStatusEnum.WAITLISTED && (
                  <p className="mt-3 text-sm text-purple-600 dark:text-purple-400">
                    {/* The position is what the member actually wants to know.
                        It is 1-based over responded_at, the same order the
                        server promotes in, so "you're next" means it. */}
                    {event.user_waitlist_position != null
                      ? `You're #${event.user_waitlist_position} of ${event.waitlist_count ?? event.user_waitlist_position} on the waitlist. `
                      : "You're on the waitlist. "}
                    You&apos;ll be automatically moved to &quot;Going&quot; if a spot opens up.
                  </p>
                )}
                {rsvpCountdown && (
                  <div className={`mt-3 flex items-center gap-1.5 text-sm ${rsvpCountdown.color}`}>
                    <Clock className="h-4 w-4" />
                    <span>{rsvpCountdown.text}</span>
                  </div>
                )}
              </div>
            )}

            {/* RSVPs List & RSVP Activity (for managers) */}
            {canManage && (
              <EventRSVPSection
                rsvps={rsvps}
                rsvpHistory={rsvpHistory}
                timezone={tz}
                removeConfirmUserId={removeConfirmUserId}
                onSetRemoveConfirmUserId={setRemoveConfirmUserId}
                onCheckIn={(userId) => {
                  void handleCheckIn(userId);
                }}
                onOpenOverrideModal={override.openModal}
                onRemoveAttendee={(userId) => {
                  void handleRemoveAttendee(userId);
                }}
                onPrintRoster={printRoster}
                onExportCSV={exportAttendanceCSV}
                attendanceFinalized={isAttendanceFinalized}
              />
            )}
            {/* The member-facing counterpart. Managers are excluded rather
                than shown both: EventRSVPSection above is strictly richer, and
                two rosters on one page reads as a bug. The card is hidden
                entirely when the API returned nothing, which is also what a
                403 looks like — a member who may not see the list is not told
                there is a list. */}
            {!canManage && !attendeesFailed && attendees.length > 0 && (
              <EventAttendeesCard
                attendees={attendees}
                loading={attendeesLoading}
                goingCount={event.going_count ?? undefined}
              />
            )}
            {/* Notifications Panel (for managers) */}
            {canManage && !event.is_cancelled && !isAttendanceFinalized && (
              <EventNotificationPanel
                notificationType={notifications.notificationType}
                onNotificationTypeChange={notifications.setNotificationType}
                notificationTarget={notifications.notificationTarget}
                onNotificationTargetChange={notifications.setNotificationTarget}
                notificationMessage={notifications.notificationMessage}
                onNotificationMessageChange={notifications.setNotificationMessage}
                sendingNotification={notifications.sendingNotification}
                showNotifyConfirm={notifications.showNotifyConfirm}
                onShowNotifyConfirm={notifications.setShowNotifyConfirm}
                onSendNotification={() => void notifications.handleSendNotification()}
                lastNotification={notifications.lastNotification}
                timezone={tz}
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Stats */}
            {stats && (
              <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
                <h2 className="text-theme-text-primary mb-4 text-lg font-medium">Statistics</h2>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-theme-text-secondary text-sm">Total RSVPs</span>
                    <span className="text-theme-text-primary text-sm font-medium">{stats.total_rsvps}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-theme-text-secondary text-sm">Going</span>
                    <span className="text-sm font-medium text-green-600">{stats.going_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-theme-text-secondary text-sm">Not Going</span>
                    <span className="text-sm font-medium text-red-700 dark:text-red-400">{stats.not_going_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-theme-text-secondary text-sm">Maybe</span>
                    <span className="text-sm font-medium text-yellow-600">{stats.maybe_count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-theme-text-secondary text-sm">Checked In</span>
                    <span className="text-theme-text-primary text-sm font-medium">{stats.checked_in_count}</span>
                  </div>
                  {stats.capacity_percentage !== null && stats.capacity_percentage !== undefined && (
                    <div className="border-t pt-3">
                      <div className="mb-1 flex justify-between">
                        <span className="text-theme-text-secondary text-sm">Capacity</span>
                        <span className="text-theme-text-primary text-sm font-medium">
                          {stats.capacity_percentage.toFixed(0)}%
                        </span>
                      </div>
                      <div className="bg-theme-surface h-2 w-full rounded-full">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            stats.capacity_percentage >= 90
                              ? 'bg-red-800'
                              : stats.capacity_percentage >= 75
                                ? 'bg-amber-500'
                                : 'bg-green-500'
                          }`}
                          style={{ width: `${Math.min(stats.capacity_percentage, 100)}%` }}
                        ></div>
                      </div>
                      {event.max_attendees && (
                        <p className="text-theme-text-muted mt-1 text-xs">
                          {occupiedSeats} / {event.max_attendees} spots filled
                        </p>
                      )}
                      {event.max_attendees && occupiedSeats >= event.max_attendees && (
                        <span className="mt-2 inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                          Event Full
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Event Info */}
            <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
              <h2 className="text-theme-text-primary mb-4 text-lg font-medium">Event Information</h2>
              <div className="space-y-3">
                {event.requires_rsvp && (
                  <>
                    <div>
                      <p className="text-theme-text-secondary text-sm">RSVP Required</p>
                      <p className="text-theme-text-primary text-sm font-medium">Yes</p>
                    </div>
                    {event.rsvp_deadline && (
                      <div>
                        <p className="text-theme-text-secondary text-sm">RSVP Deadline</p>
                        <p className="text-theme-text-primary text-sm font-medium">
                          {formatShortDateTime(event.rsvp_deadline, tz)}
                        </p>
                      </div>
                    )}
                    {event.max_attendees &&
                      (() => {
                        // Seats, not members: max_attendees caps seats, so a
                        // bar drawn from the member count promises room the
                        // RSVP path will refuse.
                        const pct = Math.min(Math.round((occupiedSeats / event.max_attendees) * 100), 100);
                        const isFull = occupiedSeats >= event.max_attendees;
                        const barColor = pct >= 90 ? 'bg-red-800' : pct >= 75 ? 'bg-amber-500' : 'bg-green-500';
                        return (
                          <div>
                            <div className="mb-1 flex justify-between">
                              <p className="text-theme-text-secondary text-sm">Capacity</p>
                              <p className="text-theme-text-primary text-sm font-medium">
                                {occupiedSeats} / {event.max_attendees}
                              </p>
                            </div>
                            <div className="bg-theme-surface h-2 w-full rounded-full">
                              <div
                                className={`h-2 rounded-full transition-all ${barColor}`}
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                            <p className="text-theme-text-muted mt-1 text-xs">
                              {occupiedSeats} / {event.max_attendees} spots filled
                            </p>
                            {isFull && (
                              <span className="mt-2 inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                                Event Full
                              </span>
                            )}
                          </div>
                        );
                      })()}
                  </>
                )}
                {event.allow_guests && (
                  <div>
                    <p className="text-theme-text-secondary text-sm">Guests Allowed</p>
                    <p className="text-theme-text-primary text-sm font-medium">Yes</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {rsvpForm.showRSVPModal && (
          <EventRSVPModal
            event={event}
            rsvpStatus={rsvpForm.rsvpStatus}
            onRsvpStatusChange={rsvpForm.setRsvpStatus}
            guestCount={rsvpForm.guestCount}
            onGuestCountChange={rsvpForm.setGuestCount}
            rsvpNotes={rsvpForm.rsvpNotes}
            onRsvpNotesChange={rsvpForm.setRsvpNotes}
            rsvpDietaryRestrictions={rsvpForm.rsvpDietaryRestrictions}
            onRsvpDietaryRestrictionsChange={rsvpForm.setRsvpDietaryRestrictions}
            rsvpAccessibilityNeeds={rsvpForm.rsvpAccessibilityNeeds}
            onRsvpAccessibilityNeedsChange={rsvpForm.setRsvpAccessibilityNeeds}
            rsvpApplyToSeries={rsvpForm.rsvpApplyToSeries}
            onRsvpApplyToSeriesChange={rsvpForm.setRsvpApplyToSeries}
            submitting={rsvpForm.submitting}
            submitError={rsvpForm.submitError}
            onSubmit={(e) => {
              void rsvpForm.handleSubmit(e);
            }}
            onClose={rsvpForm.closeModal}
          />
        )}

        {showCancelModal && (
          <EventCancelModal
            submitting={submitting}
            submitError={submitError}
            onSubmit={(payload) => {
              void handleCancelEvent(payload);
            }}
            onClose={() => {
              setShowCancelModal(false);
              setSubmitError(null);
            }}
          />
        )}

        {showCancelSeriesModal && (
          <EventCancelSeriesModal
            submitting={submitting}
            submitError={submitError}
            onSubmit={(payload) => {
              void handleCancelSeries(payload);
            }}
            onClose={() => {
              setShowCancelSeriesModal(false);
              setSubmitError(null);
            }}
          />
        )}

        {showCheckInModal && (
          <EventCheckInModal
            eligibleMembers={eligibleMembers}
            rsvps={rsvps}
            memberSearch={memberSearch}
            onMemberSearchChange={setMemberSearch}
            bulkAddLoading={bulkAddLoading}
            onBulkAddAllEligible={() => {
              void handleBulkAddAllEligible();
            }}
            onCheckIn={(userId) => {
              void handleCheckIn(userId);
              void fetchEligibleMembers();
            }}
            onClose={() => setShowCheckInModal(false)}
            timezone={tz}
          />
        )}

        {showRecordTimesModal && (
          <EventRecordTimesModal
            actualStartTime={actualStartTime}
            onActualStartTimeChange={setActualStartTime}
            actualEndTime={actualEndTime}
            onActualEndTimeChange={setActualEndTime}
            currentActualStartTime={event?.actual_start_time}
            currentActualEndTime={event?.actual_end_time}
            submitting={submitting}
            submitError={submitError}
            onSubmit={(e) => {
              void handleRecordTimes(e);
            }}
            onClose={() => {
              setShowRecordTimesModal(false);
              setSubmitError(null);
            }}
            timezone={tz}
          />
        )}

        {override.showOverrideModal && override.editingRsvp && (
          <EventOverrideAttendanceModal
            editingRsvp={override.editingRsvp}
            overrideCheckIn={override.overrideCheckIn}
            onOverrideCheckInChange={override.setOverrideCheckIn}
            overrideCheckOut={override.overrideCheckOut}
            onOverrideCheckOutChange={override.setOverrideCheckOut}
            submitting={override.submitting}
            submitError={override.submitError}
            onSubmit={(e) => {
              void override.handleSubmit(e);
            }}
            onClose={override.closeModal}
          />
        )}

        {showEndEventConfirm && (
          <EventEndConfirmModal
            eventTitle={event.title}
            submitting={submitting}
            onConfirm={() => {
              void handleEndEvent();
            }}
            onClose={() => setShowEndEventConfirm(false)}
          />
        )}

        {showDeleteConfirm && (
          <EventDeleteConfirmModal
            eventTitle={event.title}
            isRecurring={!!(event.is_recurring || event.recurrence_parent_id)}
            submitting={submitting}
            onConfirm={(scope) => {
              void handleDeleteEvent(scope);
            }}
            onClose={() => setShowDeleteConfirm(false)}
          />
        )}

        {showTemplateModal && (
          <EventSaveTemplateModal
            templateName={templateName}
            onTemplateNameChange={setTemplateName}
            templateDescription={templateDescription}
            onTemplateDescriptionChange={setTemplateDescription}
            submitting={submitting}
            onSubmit={(e) => {
              e.preventDefault();
              const name = templateName.trim();
              if (!name || !event) return;
              void (async () => {
                try {
                  setSubmitting(true);
                  setSubmitError(null);
                  const templateData: import('../types/event').EventTemplateCreate = {
                    name,
                    event_type: event.event_type,
                    requires_rsvp: event.requires_rsvp,
                    is_mandatory: event.is_mandatory,
                    allow_guests: event.allow_guests,
                    require_checkout: event.require_checkout || false,
                    send_reminders: event.send_reminders,
                    reminder_target: event.reminder_target,
                    reminder_schedule: event.reminder_schedule,
                  };
                  const descTrimmed = templateDescription.trim();
                  if (descTrimmed) templateData.description = descTrimmed;
                  if (event.title) templateData.default_title = event.title;
                  if (event.description) templateData.default_description = event.description;
                  if (event.location_id) templateData.default_location_id = event.location_id;
                  if (event.location) templateData.default_location = event.location;
                  if (event.location_details) templateData.default_location_details = event.location_details;
                  if (event.max_attendees) templateData.max_attendees = event.max_attendees;
                  // Carried so a template made from a roster-published event
                  // does not quietly revert to the org default. Assigned
                  // unconditionally: null is the inherit state, not an absence.
                  templateData.attendee_visibility = event.attendee_visibility ?? null;
                  if (event.check_in_window_type) templateData.check_in_window_type = event.check_in_window_type;
                  if (event.check_in_minutes_before != null)
                    templateData.check_in_minutes_before = event.check_in_minutes_before;
                  if (event.check_in_minutes_after != null)
                    templateData.check_in_minutes_after = event.check_in_minutes_after;
                  await eventService.createTemplate(templateData);
                  setShowTemplateModal(false);
                  toast.success('Template saved successfully');
                } catch (err) {
                  toast.error(
                    (err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to save template'
                  );
                } finally {
                  setSubmitting(false);
                }
              })();
            }}
            onClose={() => setShowTemplateModal(false)}
          />
        )}

        <PromptDialog
          isOpen={showReopenPrompt}
          onClose={() => setShowReopenPrompt(false)}
          onSubmit={(reason) => void handleReopenAttendance(reason)}
          title="Reopen attendance?"
          message="Attendance becomes editable again and the event can be corrected, then finalized a second time. Re-finalizing updates the hours already credited rather than adding to them."
          label="Reason"
          placeholder="e.g. Two members were left off the roster"
          multiline
          minLength={4}
          hint="Recorded on the audit trail alongside your name."
          confirmLabel="Reopen for corrections"
          cancelLabel="Leave it closed"
          confirmVariant="warning"
          loading={reopeningAttendance}
        />
      </div>
    </div>
  );
};
