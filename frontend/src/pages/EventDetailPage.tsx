/**
 * Event Detail Page
 *
 * Shows detailed information about an event including RSVPs and attendee management.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import { eventService, meetingsService } from '../services/api';
import { electionService } from '../services/electionService';
import type { ElectionListItem } from '../types/election';
import { getStatusBadgeClass } from '../utils/electionHelpers';
import type { Event, EventListItem, RSVP, RSVPStatus, EventStats, RSVPHistory } from '../types/event';
import { useAuthStore } from '../stores/authStore';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EventTypeBadge } from '../components/EventTypeBadge';
import { RSVPStatusBadge } from '../components/RSVPStatusBadge';
import { downloadICSFile } from '../utils/eventHelpers';
import { formatDateTime, formatShortDateTime, formatTime, formatForDateTimeInput, localToUTC } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { EventType as EventTypeEnum, RSVPStatus as RSVPStatusEnum } from '../constants/enums';
import { Bell, Repeat, CalendarPlus, Clock, ChevronDown, MapPin, StopCircle } from 'lucide-react';
import { SimpleMarkdown } from '../utils/simpleMarkdown';
import { EventAttachmentsList } from '../components/event-detail/EventAttachmentsList';
import { EventRecurrenceInfo } from '../components/event-detail/EventRecurrenceInfo';
import { EventNotificationPanel } from '../components/event-detail/EventNotificationPanel';
import { EventRSVPSection } from '../components/event-detail/EventRSVPSection';
import type { NotificationType, NotificationTarget } from '../components/event-detail/EventNotificationPanel';
import EventRSVPModal from '../components/event-detail/EventRSVPModal';
import EventCancelModal from '../components/event-detail/EventCancelModal';
import EventCancelSeriesModal from '../components/event-detail/EventCancelSeriesModal';
import EventCheckInModal from '../components/event-detail/EventCheckInModal';
import EventRecordTimesModal from '../components/event-detail/EventRecordTimesModal';
import EventOverrideAttendanceModal from '../components/event-detail/EventOverrideAttendanceModal';
import EventEndConfirmModal from '../components/event-detail/EventEndConfirmModal';
import EventDeleteConfirmModal from '../components/event-detail/EventDeleteConfirmModal';
import EventSaveTemplateModal from '../components/event-detail/EventSaveTemplateModal';

export const EventDetailPage: React.FC = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [rsvps, setRsvps] = useState<RSVP[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRSVPModal, setShowRSVPModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showRecordTimesModal, setShowRecordTimesModal] = useState(false);
  const [rsvpStatus, setRsvpStatus] = useState<RSVPStatus>(RSVPStatusEnum.GOING);
  const [guestCount, setGuestCount] = useState(0);
  const [rsvpNotes, setRsvpNotes] = useState('');
  const [rsvpDietaryRestrictions, setRsvpDietaryRestrictions] = useState('');
  const [rsvpAccessibilityNeeds, setRsvpAccessibilityNeeds] = useState('');
  const [showCancelSeriesModal, setShowCancelSeriesModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEndEventConfirm, setShowEndEventConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [eligibleMembers, setEligibleMembers] = useState<Array<{ id: string; first_name: string; last_name: string; email: string }>>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [actualStartTime, setActualStartTime] = useState('');
  const [actualEndTime, setActualEndTime] = useState('');
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [editingRsvp, setEditingRsvp] = useState<RSVP | null>(null);
  const [overrideCheckIn, setOverrideCheckIn] = useState('');
  const [overrideCheckOut, setOverrideCheckOut] = useState('');
  const [removeConfirmUserId, setRemoveConfirmUserId] = useState<string | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [rsvpApplyToSeries, setRsvpApplyToSeries] = useState(false);
  const [seriesEvents, setSeriesEvents] = useState<EventListItem[]>([]);
  const [showAllOccurrences, setShowAllOccurrences] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [bulkAddLoading, setBulkAddLoading] = useState(false);
  const [rsvpHistory, setRsvpHistory] = useState<RSVPHistory[]>([]);
  const [showReminderMenu, setShowReminderMenu] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  // Notification panel state
  const [notificationType, setNotificationType] = useState<NotificationType>('announcement');
  const [notificationTarget, setNotificationTarget] = useState<NotificationTarget>('all');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [sendingNotification, setSendingNotification] = useState(false);
  const [showNotifyConfirm, setShowNotifyConfirm] = useState(false);
  const [lastNotification, setLastNotification] = useState<{ type: string; target: string; recipients: number; sentAt: string } | null>(null);
  const [linkedElections, setLinkedElections] = useState<ElectionListItem[]>([]);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const reminderMenuRef = useRef<HTMLDivElement>(null);

  const { checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('events.manage');

  // Close actions menu and reminder menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setShowActionsMenu(false);
      }
      if (reminderMenuRef.current && !reminderMenuRef.current.contains(e.target as Node)) {
        setShowReminderMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (eventId) {
      void fetchEvent();
      void fetchLinkedElections();
      if (canManage) {
        void fetchRSVPs();
        void fetchStats();
        void fetchRSVPHistory();
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
        .filter(e => e.recurrence_parent_id === parentId || e.id === parentId)
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

    const rows = rsvps.map(r => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd">${r.user_name ?? ''}</td>
        <td style="padding:8px;border:1px solid #ddd">${r.status}</td>
        <td style="padding:8px;border:1px solid #ddd">${r.checked_in ? 'Yes' : 'No'}</td>
        <td style="padding:8px;border:1px solid #ddd">${r.guest_count ?? 0}</td>
        <td style="padding:8px;border:1px solid #ddd"></td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html><head><title>Attendance Roster - ${event.title}</title></head>
      <body style="font-family:Arial,sans-serif;padding:20px">
        <h1 style="font-size:24px;margin-bottom:4px">${event.title}</h1>
        <p style="color:#666;margin-bottom:16px">${formatDateTime(event.start_datetime, tz)}</p>
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
    const notRsvpd = eligibleMembers.filter(
      (m) => !rsvps.find((r) => r.user_id === m.id)
    );

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

  const handleRSVP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      const rsvpPayload = {
        status: rsvpStatus,
        guest_count: guestCount,
        notes: rsvpNotes || undefined,
        dietary_restrictions: rsvpDietaryRestrictions || undefined,
        accessibility_needs: rsvpAccessibilityNeeds || undefined,
      };

      if (rsvpApplyToSeries && event && (event.is_recurring || event.recurrence_parent_id)) {
        const result = await eventService.rsvpToSeries(eventId, rsvpPayload);
        toast.success(`RSVP applied to ${result.rsvp_count} events in the series`);
      } else {
        await eventService.createOrUpdateRSVP(eventId, rsvpPayload);
        toast.success('RSVP submitted successfully');
      }

      setShowRSVPModal(false);
      setRsvpStatus(RSVPStatusEnum.GOING);
      setGuestCount(0);
      setRsvpNotes('');
      setRsvpDietaryRestrictions('');
      setRsvpAccessibilityNeeds('');
      setRsvpApplyToSeries(false);
      await fetchEvent();
      if (canManage) {
        await fetchRSVPs();
        await fetchStats();
      }
    } catch (err) {
      setSubmitError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to submit RSVP');
    } finally {
      setSubmitting(false);
    }
  };

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

  const handleCancelSeries = async (payload: { cancellationReason: string; sendNotifications: boolean; futureOnly: boolean }) => {
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
        payload.futureOnly,
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
      navigate(`/events/${newEvent.id}/edit`);
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to duplicate event');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendReminders = async (reminderType: 'non_respondents' | 'all') => {
    if (!eventId) return;

    try {
      setSendingReminders(true);
      setShowReminderMenu(false);
      const result = await eventService.sendReminders(eventId, reminderType);
      toast.success(`${result.sent_count} reminder(s) queued`);
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast.error(axiosErr.response?.data?.detail || 'Failed to send reminders');
    } finally {
      setSendingReminders(false);
    }
  };

  const handleSendNotification = async () => {
    if (!eventId) return;

    try {
      setSendingNotification(true);
      setShowNotifyConfirm(false);
      const result = await eventService.sendEventNotification(eventId, {
        notification_type: notificationType,
        message: notificationMessage.trim() || undefined,
        target: notificationTarget,
      });
      toast.success(result.message);
      setLastNotification({
        type: notificationType,
        target: notificationTarget,
        recipients: result.recipients_count,
        sentAt: new Date().toISOString(),
      });
      setNotificationMessage('');
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>;
      toast.error(axiosErr.response?.data?.detail || 'Failed to send notification');
    } finally {
      setSendingNotification(false);
    }
  };

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
      navigate('/events');
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to delete event');
    } finally {
      setSubmitting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleFinalizeAttendance = async () => {
    if (!eventId) return;

    try {
      setSubmitting(true);
      const result = await eventService.finalizeAttendance(eventId);
      if (result.updated_count > 0) {
        toast.success(`Attendance finalized for ${result.updated_count} member${result.updated_count !== 1 ? 's' : ''}`);
        await fetchRSVPs();
        await fetchStats();
      } else {
        toast.success('All attendance records are already up to date');
      }
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to finalize attendance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndEvent = async () => {
    if (!eventId) return;

    try {
      setSubmitting(true);
      const result = await eventService.endEvent(eventId);
      const count = result.checked_out_count;
      toast.success(
        count > 0
          ? `Event ended — ${count} member${count !== 1 ? 's' : ''} checked out`
          : 'Event ended'
      );
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
      // Pre-fill with existing actual times if they exist
      setActualStartTime(event.actual_start_time ? formatForDateTimeInput(event.actual_start_time, tz) : '');
      setActualEndTime(event.actual_end_time ? formatForDateTimeInput(event.actual_end_time, tz) : '');
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

  const openOverrideModal = (rsvp: RSVP) => {
    setEditingRsvp(rsvp);
    setOverrideCheckIn(
      rsvp.override_check_in_at
        ? formatForDateTimeInput(rsvp.override_check_in_at, tz)
        : rsvp.checked_in_at
          ? formatForDateTimeInput(rsvp.checked_in_at, tz)
          : ''
    );
    setOverrideCheckOut(
      rsvp.override_check_out_at
        ? formatForDateTimeInput(rsvp.override_check_out_at, tz)
        : rsvp.checked_out_at
          ? formatForDateTimeInput(rsvp.checked_out_at, tz)
          : ''
    );
    setShowOverrideModal(true);
    setSubmitError(null);
  };

  const handleOverrideAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId || !editingRsvp) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      const data: import('../types/event').RSVPOverride = {};
      if (overrideCheckIn) data.override_check_in_at = localToUTC(overrideCheckIn, tz);
      if (overrideCheckOut) data.override_check_out_at = localToUTC(overrideCheckOut, tz);

      await eventService.overrideAttendance(eventId, editingRsvp.user_id, data);
      setShowOverrideModal(false);
      setEditingRsvp(null);
      await fetchRSVPs();
      await fetchStats();
      toast.success('Attendance times updated');
    } catch (err) {
      setSubmitError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to update attendance');
    } finally {
      setSubmitting(false);
    }
  };

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error || 'Event not found'}</p>
          <button
            onClick={() => navigate('/events')}
            className="mt-2 text-sm text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 underline"
          >
            Back to Events
          </button>
        </div>
      </div>
    );
  }

  const isPastEvent = new Date(event.end_datetime) < new Date();
  const hasStarted = new Date(event.start_datetime) <= new Date();
  const isOngoing = hasStarted && !isPastEvent && !event.is_cancelled && !event.actual_end_time;
  const canRSVP = event.requires_rsvp && !event.is_cancelled && !isPastEvent &&
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
      return { text: `RSVP deadline: ${formatShortDateTime(event.rsvp_deadline, tz)}`, color: 'text-theme-text-secondary' };
    }
  })();

  const exportAttendanceCSV = () => {
    if (!rsvps || !event) return;
    const headers = ['Name', 'Email', 'RSVP Status', 'Guest Count', 'Checked In', 'Check-In Time', 'Notes'];
    const rows = rsvps.map(r => [
      r.user_name || '',
      r.user_email || '',
      r.status,
      String(r.guest_count ?? 0),
      r.checked_in ? 'Yes' : 'No',
      r.checked_in_at ? formatDateTime(r.checked_in_at, tz) : '',
      (r.notes || '').replace(/"/g, '""'),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}_attendance.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Compute series navigation (prev/next occurrence)
  const currentSeriesIndex = seriesEvents.findIndex(e => e.id === eventId);
  const prevOccurrence = currentSeriesIndex > 0 ? seriesEvents[currentSeriesIndex - 1] ?? null : null;
  const nextOccurrence = currentSeriesIndex >= 0 && currentSeriesIndex < seriesEvents.length - 1
    ? seriesEvents[currentSeriesIndex + 1] ?? null
    : null;
  const seriesPosition = currentSeriesIndex >= 0 ? currentSeriesIndex + 1 : null;
  const seriesTotal = seriesEvents.length > 0 ? seriesEvents.length : null;

  return (
    <div className="min-h-screen">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/events"
          className="inline-flex items-center text-sm text-theme-text-muted hover:text-theme-text-primary mb-4"
        >
          <svg className="mr-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Events
        </Link>

        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-theme-text-primary wrap-break-word">{event.title}</h1>
            <div className="mt-2 flex items-center space-x-2">
              <EventTypeBadge type={event.event_type} size="sm" />
              {event.is_draft && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300">
                  Draft
                </span>
              )}
              {event.is_cancelled && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
                  Cancelled
                </span>
              )}
              {event.is_mandatory && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                  Mandatory
                </span>
              )}
              {(event.is_recurring || event.recurrence_parent_id) && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
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
                        toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to publish event');
                      } finally {
                        setSubmitting(false);
                      }
                    })();
                  }}
                  disabled={submitting}
                  className="btn-primary font-medium inline-flex items-center rounded-md text-sm"
                >
                  Publish
                </button>
              )}
              {canRSVP && (
                <button
                  onClick={() => setShowRSVPModal(true)}
                  className="btn-primary font-medium inline-flex items-center rounded-md text-sm"
                >
                  {event.user_rsvp_status ? 'Update RSVP' : 'RSVP Now'}
                </button>
              )}
              {rsvpCountdown && !event.user_rsvp_status && (
                <span className={`inline-flex items-center gap-1.5 text-sm ${rsvpCountdown.color}`}>
                  <Clock className="h-4 w-4" />
                  {rsvpCountdown.text}
                </span>
              )}
              <button
                onClick={() => navigate(`/events/${eventId}/qr-code`)}
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-xs text-sm font-medium text-blue-700 dark:text-blue-400 bg-theme-surface hover:bg-blue-500/20"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                View QR Code
              </button>
              <button
                onClick={() => downloadICSFile(event)}
                className="inline-flex items-center gap-1.5 rounded-md border border-theme-surface-border px-3 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
              >
                <CalendarPlus className="h-4 w-4" />
                Add to Calendar
              </button>
              {canManage && (
                <>
                  <button
                    onClick={() => navigate(`/events/${eventId}/edit`)}
                    className="inline-flex items-center px-4 py-2 border border-theme-surface-border rounded-md shadow-xs text-sm font-medium text-theme-text-secondary bg-theme-surface hover:bg-theme-surface-hover"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>
                  <button
                    onClick={openCheckInModal}
                    className="inline-flex items-center px-4 py-2 border border-theme-surface-border rounded-md shadow-xs text-sm font-medium text-theme-text-secondary bg-theme-surface hover:bg-theme-surface-hover"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    Check In
                  </button>

                  {/* Send Reminders dropdown */}
                  {!event.is_cancelled && (
                    <div className="relative" ref={reminderMenuRef}>
                      <button
                        onClick={() => setShowReminderMenu(!showReminderMenu)}
                        disabled={sendingReminders}
                        className="inline-flex items-center px-4 py-2 border border-theme-surface-border rounded-md shadow-xs text-sm font-medium text-theme-text-secondary bg-theme-surface hover:bg-theme-surface-hover disabled:opacity-50"
                      >
                        <Bell className="mr-2 h-4 w-4" />
                        {sendingReminders ? 'Sending...' : 'Send Reminders'}
                        <ChevronDown className="ml-1 h-4 w-4" />
                      </button>
                      {showReminderMenu && (
                        <div className="absolute right-0 mt-2 w-56 rounded-lg bg-theme-surface-modal border border-theme-surface-border shadow-lg z-20">
                          <div className="py-1">
                            <button
                              onClick={() => void handleSendReminders('non_respondents')}
                              className="w-full text-left px-4 py-2.5 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
                            >
                              Non-respondents only
                            </button>
                            <button
                              onClick={() => void handleSendReminders('all')}
                              className="w-full text-left px-4 py-2.5 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
                            >
                              All members
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* End Event button — visible when event is in progress */}
                  {isOngoing && (
                    <button
                      onClick={() => setShowEndEventConfirm(true)}
                      disabled={submitting}
                      className="inline-flex items-center px-4 py-2 border border-red-300 dark:border-red-700 rounded-md shadow-xs text-sm font-medium text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50"
                    >
                      <StopCircle className="mr-2 h-4 w-4" />
                      End Event
                    </button>
                  )}

                  {/* "More" dropdown for secondary actions */}
                  <div className="relative" ref={actionsMenuRef}>
                    <button
                      onClick={() => setShowActionsMenu(!showActionsMenu)}
                      className="inline-flex items-center px-4 py-2 border border-theme-surface-border rounded-md shadow-xs text-sm font-medium text-theme-text-secondary bg-theme-surface hover:bg-theme-surface-hover"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                      </svg>
                      <span className="ml-1">More</span>
                    </button>
                    {showActionsMenu && (
                      <div className="absolute right-0 mt-2 w-56 rounded-lg bg-theme-surface-modal border border-theme-surface-border shadow-lg z-20">
                        <div className="py-1">
                          <button
                            onClick={() => { setShowActionsMenu(false); void handleDuplicateEvent(); }}
                            disabled={submitting}
                            className="w-full text-left px-4 py-2.5 text-sm text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
                          >
                            Duplicate Event
                          </button>
                          <button
                            onClick={() => { setShowActionsMenu(false); openRecordTimesModal(); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
                          >
                            Record Times
                          </button>
                          {isPastEvent && (
                            <button
                              onClick={() => { setShowActionsMenu(false); void handleFinalizeAttendance(); }}
                              disabled={submitting}
                              className="w-full text-left px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-400 hover:bg-theme-surface-hover disabled:opacity-50"
                            >
                              Finalize Attendance
                            </button>
                          )}
                          <button
                            onClick={() => { setShowActionsMenu(false); navigate(`/events/${eventId}/monitoring`); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
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
                                  navigate(`/minutes`);
                                } catch (err) {
                                  const axiosErr = err as AxiosError<{ detail?: string }>;
                                  toast.error(axiosErr.response?.data?.detail || 'Failed to create meeting');
                                }
                              })();
                            }}
                            disabled={submitting}
                            className="w-full text-left px-4 py-2.5 text-sm text-theme-text-secondary hover:bg-theme-surface-hover disabled:opacity-50"
                          >
                            Create Meeting
                          </button>
                          <button
                            onClick={() => { setShowActionsMenu(false); setTemplateName(event.title); setTemplateDescription(''); setShowTemplateModal(true); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
                          >
                            Save as Template
                          </button>
                          <div className="border-t border-theme-surface-border my-1" />
                          <button
                            onClick={() => { setShowActionsMenu(false); setShowCancelModal(true); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-theme-surface-hover"
                          >
                            Cancel Event
                          </button>
                          {(event.is_recurring || event.recurrence_parent_id) && (
                            <button
                              onClick={() => { setShowActionsMenu(false); setShowCancelSeriesModal(true); }}
                              className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-theme-surface-hover"
                            >
                              Cancel Entire Series
                            </button>
                          )}
                          <button
                            onClick={() => { setShowActionsMenu(false); setShowDeleteConfirm(true); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-theme-surface-hover"
                          >
                            Delete Event
                          </button>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Event Details */}
          <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-medium text-theme-text-primary mb-4">Event Details</h2>

            {event.is_cancelled && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">This event has been cancelled</p>
                {event.cancellation_reason && (
                  <p className="text-sm text-red-600 dark:text-red-400 mt-1">Reason: {event.cancellation_reason}</p>
                )}
              </div>
            )}

            {event.description && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-theme-text-secondary mb-1">Description</h3>
                <SimpleMarkdown
                  text={event.description}
                  className="text-theme-text-secondary prose-sm"
                />
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-start">
                <svg className="shrink-0 mr-3 h-5 w-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-theme-text-secondary">Date & Time</p>
                  <p className="text-sm text-theme-text-secondary">
                    {formatDateTime(event.start_datetime, tz)}
                  </p>
                  <p className="text-sm text-theme-text-secondary">
                    to {formatTime(event.end_datetime, tz)}
                  </p>
                </div>
              </div>

              {(event.location_name || event.location) && (
                <div className="flex items-start">
                  <svg className="shrink-0 mr-3 h-5 w-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-theme-text-secondary">Location</p>
                    <p className="text-sm text-theme-text-secondary">{event.location_name || event.location}</p>
                    {event.location_details && (
                      <p className="text-sm text-theme-text-muted mt-1">{event.location_details}</p>
                    )}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location_name || event.location || '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 inline-flex items-center gap-1 mt-1"
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      Get Directions
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Custom Fields / Training Session Details */}
          {event.custom_fields && Object.keys(event.custom_fields).length > 0 && (
            <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6 border-l-4 border-purple-600">
              <div className="flex items-center mb-4">
                <svg className="h-6 w-6 text-purple-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h2 className="text-lg font-medium text-theme-text-primary">
                  {event.event_type === EventTypeEnum.TRAINING ? 'Training Session Details' : 'Event Details'}
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {event.event_type === EventTypeEnum.TRAINING && (
                  <>
                    {event.custom_fields.course_name && (
                      <div>
                        <p className="text-sm font-medium text-theme-text-secondary">Course Name</p>
                        <p className="text-sm text-theme-text-primary">{event.custom_fields.course_name}</p>
                      </div>
                    )}

                    {event.custom_fields.course_code && (
                      <div>
                        <p className="text-sm font-medium text-theme-text-secondary">Course Code</p>
                        <p className="text-sm text-theme-text-primary">{event.custom_fields.course_code}</p>
                      </div>
                    )}

                    {event.custom_fields.credit_hours && (
                      <div>
                        <p className="text-sm font-medium text-theme-text-secondary">Credit Hours</p>
                        <p className="text-sm text-theme-text-primary">{event.custom_fields.credit_hours} hours</p>
                      </div>
                    )}

                    {event.custom_fields.training_type && (
                      <div>
                        <p className="text-sm font-medium text-theme-text-secondary">Training Type</p>
                        <p className="text-sm text-theme-text-primary capitalize">
                          {typeof event.custom_fields.training_type === 'string'
                            ? event.custom_fields.training_type.replace('_', ' ')
                            : event.custom_fields.training_type}
                        </p>
                      </div>
                    )}

                    {event.custom_fields.instructor && (
                      <div>
                        <p className="text-sm font-medium text-theme-text-secondary">Instructor</p>
                        <p className="text-sm text-theme-text-primary">{event.custom_fields.instructor}</p>
                      </div>
                    )}

                    {event.custom_fields.issuing_agency && (
                      <div>
                        <p className="text-sm font-medium text-theme-text-secondary">Issuing Agency</p>
                        <p className="text-sm text-theme-text-primary">{event.custom_fields.issuing_agency}</p>
                      </div>
                    )}

                    {event.custom_fields.expiration_months && (
                      <div>
                        <p className="text-sm font-medium text-theme-text-secondary">Certification Valid For</p>
                        <p className="text-sm text-theme-text-primary">{event.custom_fields.expiration_months} months</p>
                      </div>
                    )}

                    {event.custom_fields.issues_certification && (
                      <div className="col-span-2">
                        <div className="flex items-center p-3 bg-green-50 border border-green-200 dark:bg-green-500/10 dark:border-green-500/30 rounded-lg">
                          <svg className="h-5 w-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-sm font-medium text-green-800 dark:text-green-400">This training issues a certification upon completion</span>
                        </div>
                      </div>
                    )}

                    {event.custom_fields.auto_create_records && (
                      <div className="col-span-2">
                        <div className="flex items-center p-3 bg-blue-50 border border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/30 rounded-lg">
                          <svg className="h-5 w-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span className="text-sm font-medium text-blue-800 dark:text-blue-400">Training records are automatically created when members check in</span>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Generic custom fields (excludes training-specific keys) */}
                {Object.entries(event.custom_fields).filter(([key]) =>
                  !['course_name', 'course_code', 'credit_hours', 'training_type', 'instructor',
                    'issuing_agency', 'certification_name', 'certification_expiry_months',
                    'issues_certification', 'auto_create_records', 'expiration_months'].includes(key)
                ).map(([key, value]) => (
                  <div key={key}>
                    <p className="text-sm font-medium text-theme-text-secondary">{key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                    <p className="text-sm text-theme-text-primary">{String(value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

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
            <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-medium text-theme-text-primary mb-4">Linked Elections</h2>
              <div className="space-y-3">
                {linkedElections.map((election) => (
                  <Link
                    key={election.id}
                    to={`/elections/${election.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border hover:bg-theme-surface-hover transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-theme-text-primary truncate">{election.title}</p>
                      <p className="text-xs text-theme-text-muted mt-0.5">
                        {election.election_type.replace(/_/g, ' ')}
                        {election.positions && election.positions.length > 0
                          ? ` · ${election.positions.join(', ')}`
                          : ''}
                      </p>
                    </div>
                    <span className={`ml-3 shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClass(election.status)}`}>
                      {election.status}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* User's RSVP Status */}
          {event.user_rsvp_status && (
            <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-medium text-theme-text-primary mb-4">Your RSVP</h2>
              <div className="flex items-center space-x-4">
                <RSVPStatusBadge status={event.user_rsvp_status} />
                {canRSVP && (
                  <button
                    onClick={() => setShowRSVPModal(true)}
                    className="text-sm text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                  >
                    Change RSVP
                  </button>
                )}
              </div>
              {event.user_rsvp_status === RSVPStatusEnum.WAITLISTED && (
                <p className="mt-3 text-sm text-purple-600 dark:text-purple-400">
                  You&apos;re on the waitlist. You&apos;ll be automatically moved to &quot;Going&quot; if a spot opens up.
                </p>
              )}
              {rsvpCountdown && (
                <div className={`flex items-center gap-1.5 mt-3 text-sm ${rsvpCountdown.color}`}>
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
              onCheckIn={(userId) => { void handleCheckIn(userId); }}
              onOpenOverrideModal={openOverrideModal}
              onRemoveAttendee={(userId) => { void handleRemoveAttendee(userId); }}
              onPrintRoster={printRoster}
              onExportCSV={exportAttendanceCSV}
            />
          )}
          {/* Notifications Panel (for managers) */}
          {canManage && !event.is_cancelled && (
            <EventNotificationPanel
              notificationType={notificationType}
              onNotificationTypeChange={setNotificationType}
              notificationTarget={notificationTarget}
              onNotificationTargetChange={setNotificationTarget}
              notificationMessage={notificationMessage}
              onNotificationMessageChange={setNotificationMessage}
              sendingNotification={sendingNotification}
              showNotifyConfirm={showNotifyConfirm}
              onShowNotifyConfirm={setShowNotifyConfirm}
              onSendNotification={() => void handleSendNotification()}
              lastNotification={lastNotification}
              timezone={tz}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Stats */}
          {stats && (
            <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-medium text-theme-text-primary mb-4">Statistics</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-theme-text-secondary">Total RSVPs</span>
                  <span className="text-sm font-medium text-theme-text-primary">{stats.total_rsvps}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-theme-text-secondary">Going</span>
                  <span className="text-sm font-medium text-green-600">{stats.going_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-theme-text-secondary">Not Going</span>
                  <span className="text-sm font-medium text-red-700 dark:text-red-400">{stats.not_going_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-theme-text-secondary">Maybe</span>
                  <span className="text-sm font-medium text-yellow-600">{stats.maybe_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-theme-text-secondary">Checked In</span>
                  <span className="text-sm font-medium text-theme-text-primary">{stats.checked_in_count}</span>
                </div>
                {stats.capacity_percentage !== null && stats.capacity_percentage !== undefined && (
                  <div className="pt-3 border-t">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-theme-text-secondary">Capacity</span>
                      <span className="text-sm font-medium text-theme-text-primary">{stats.capacity_percentage.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-theme-surface rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          stats.capacity_percentage >= 90
                            ? 'bg-red-600'
                            : stats.capacity_percentage >= 75
                              ? 'bg-amber-500'
                              : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(stats.capacity_percentage, 100)}%` }}
                      ></div>
                    </div>
                    {event.max_attendees && (
                      <p className="text-xs text-theme-text-muted mt-1">
                        {event.going_count ?? 0} / {event.max_attendees} spots filled
                      </p>
                    )}
                    {event.max_attendees && (event.going_count ?? 0) >= event.max_attendees && (
                      <span className="inline-flex items-center mt-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
                        Event Full
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Event Info */}
          <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
            <h2 className="text-lg font-medium text-theme-text-primary mb-4">Event Information</h2>
            <div className="space-y-3">
              {event.requires_rsvp && (
                <>
                  <div>
                    <p className="text-sm text-theme-text-secondary">RSVP Required</p>
                    <p className="text-sm font-medium text-theme-text-primary">Yes</p>
                  </div>
                  {event.rsvp_deadline && (
                    <div>
                      <p className="text-sm text-theme-text-secondary">RSVP Deadline</p>
                      <p className="text-sm font-medium text-theme-text-primary">
                        {formatShortDateTime(event.rsvp_deadline, tz)}
                      </p>
                    </div>
                  )}
                  {event.max_attendees && (() => {
                    const goingCount = event.going_count ?? 0;
                    const pct = Math.min(Math.round((goingCount / event.max_attendees) * 100), 100);
                    const isFull = goingCount >= event.max_attendees;
                    const barColor = pct >= 90
                      ? 'bg-red-600'
                      : pct >= 75
                        ? 'bg-amber-500'
                        : 'bg-green-500';
                    return (
                      <div>
                        <div className="flex justify-between mb-1">
                          <p className="text-sm text-theme-text-secondary">Capacity</p>
                          <p className="text-sm font-medium text-theme-text-primary">
                            {goingCount} / {event.max_attendees}
                          </p>
                        </div>
                        <div className="w-full bg-theme-surface rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${barColor}`}
                            style={{ width: `${pct}%` }}
                          ></div>
                        </div>
                        <p className="text-xs text-theme-text-muted mt-1">
                          {goingCount} / {event.max_attendees} spots filled
                        </p>
                        {isFull && (
                          <span className="inline-flex items-center mt-2 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
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
                  <p className="text-sm text-theme-text-secondary">Guests Allowed</p>
                  <p className="text-sm font-medium text-theme-text-primary">Yes</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showRSVPModal && (
        <EventRSVPModal
          event={event}
          rsvpStatus={rsvpStatus}
          onRsvpStatusChange={setRsvpStatus}
          guestCount={guestCount}
          onGuestCountChange={setGuestCount}
          rsvpNotes={rsvpNotes}
          onRsvpNotesChange={setRsvpNotes}
          rsvpDietaryRestrictions={rsvpDietaryRestrictions}
          onRsvpDietaryRestrictionsChange={setRsvpDietaryRestrictions}
          rsvpAccessibilityNeeds={rsvpAccessibilityNeeds}
          onRsvpAccessibilityNeedsChange={setRsvpAccessibilityNeeds}
          rsvpApplyToSeries={rsvpApplyToSeries}
          onRsvpApplyToSeriesChange={setRsvpApplyToSeries}
          submitting={submitting}
          submitError={submitError}
          onSubmit={(e) => { void handleRSVP(e); }}
          onClose={() => { setShowRSVPModal(false); setSubmitError(null); }}
        />
      )}

      {showCancelModal && (
        <EventCancelModal
          submitting={submitting}
          submitError={submitError}
          onSubmit={(payload) => { void handleCancelEvent(payload); }}
          onClose={() => { setShowCancelModal(false); setSubmitError(null); }}
        />
      )}

      {showCancelSeriesModal && (
        <EventCancelSeriesModal
          submitting={submitting}
          submitError={submitError}
          onSubmit={(payload) => { void handleCancelSeries(payload); }}
          onClose={() => { setShowCancelSeriesModal(false); setSubmitError(null); }}
        />
      )}

      {showCheckInModal && (
        <EventCheckInModal
          eligibleMembers={eligibleMembers}
          rsvps={rsvps}
          memberSearch={memberSearch}
          onMemberSearchChange={setMemberSearch}
          bulkAddLoading={bulkAddLoading}
          onBulkAddAllEligible={() => { void handleBulkAddAllEligible(); }}
          onCheckIn={(userId) => { void handleCheckIn(userId); void fetchEligibleMembers(); }}
          onFetchEligibleMembers={fetchEligibleMembers}
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
          onSubmit={(e) => { void handleRecordTimes(e); }}
          onClose={() => { setShowRecordTimesModal(false); setSubmitError(null); }}
          timezone={tz}
        />
      )}

      {showOverrideModal && editingRsvp && (
        <EventOverrideAttendanceModal
          editingRsvp={editingRsvp}
          overrideCheckIn={overrideCheckIn}
          onOverrideCheckInChange={setOverrideCheckIn}
          overrideCheckOut={overrideCheckOut}
          onOverrideCheckOutChange={setOverrideCheckOut}
          submitting={submitting}
          submitError={submitError}
          onSubmit={(e) => { void handleOverrideAttendance(e); }}
          onClose={() => { setShowOverrideModal(false); setEditingRsvp(null); setSubmitError(null); }}
        />
      )}

      {showEndEventConfirm && (
        <EventEndConfirmModal
          eventTitle={event.title}
          submitting={submitting}
          onConfirm={() => { void handleEndEvent(); }}
          onClose={() => setShowEndEventConfirm(false)}
        />
      )}

      {showDeleteConfirm && (
        <EventDeleteConfirmModal
          eventTitle={event.title}
          isRecurring={!!(event.is_recurring || event.recurrence_parent_id)}
          submitting={submitting}
          onConfirm={(scope) => { void handleDeleteEvent(scope); }}
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
                if (event.check_in_window_type) templateData.check_in_window_type = event.check_in_window_type;
                if (event.check_in_minutes_before != null) templateData.check_in_minutes_before = event.check_in_minutes_before;
                if (event.check_in_minutes_after != null) templateData.check_in_minutes_after = event.check_in_minutes_after;
                await eventService.createTemplate(templateData);
                setShowTemplateModal(false);
                toast.success('Template saved successfully');
              } catch (err) {
                toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to save template');
              } finally {
                setSubmitting(false);
              }
            })();
          }}
          onClose={() => setShowTemplateModal(false)}
        />
      )}
    </div>
    </div>
  );
};
