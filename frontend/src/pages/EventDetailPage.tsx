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
import type { Event, EventListItem, RSVP, RSVPStatus, EventStats, RSVPHistory } from '../types/event';
import { useAuthStore } from '../stores/authStore';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EventTypeBadge } from '../components/EventTypeBadge';
import { RSVPStatusBadge } from '../components/RSVPStatusBadge';
import { getRSVPStatusLabel, getRSVPStatusColor, downloadICSFile } from '../utils/eventHelpers';
import { formatDateTime, formatShortDateTime, formatTime, formatForDateTimeInput, localToUTC } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { EventType as EventTypeEnum, RSVPStatus as RSVPStatusEnum } from '../constants/enums';
import DateTimeQuarterHour from '../components/ux/DateTimeQuarterHour';
import { Bell, Repeat, CalendarPlus, Clock, ChevronDown, MapPin, StopCircle } from 'lucide-react';
import { renderSimpleMarkdown } from '../utils/simpleMarkdown';
import { EventAttachmentsList } from '../components/event-detail/EventAttachmentsList';
import { EventRecurrenceInfo } from '../components/event-detail/EventRecurrenceInfo';
import { EventNotificationPanel } from '../components/event-detail/EventNotificationPanel';
import { EventRSVPSection } from '../components/event-detail/EventRSVPSection';
import type { NotificationType, NotificationTarget } from '../components/event-detail/EventNotificationPanel';

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
  const [cancelReason, setCancelReason] = useState('');
  const [sendCancelNotifications, setSendCancelNotifications] = useState(false);
  const [showCancelSeriesModal, setShowCancelSeriesModal] = useState(false);
  const [cancelSeriesFutureOnly, setCancelSeriesFutureOnly] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteScope, setDeleteScope] = useState<'single' | 'series'>('single');
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

  const handleCancelEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      await eventService.cancelEvent(eventId, {
        cancellation_reason: cancelReason,
        send_notifications: sendCancelNotifications,
      });

      setShowCancelModal(false);
      setCancelReason('');
      setSendCancelNotifications(false);
      toast.success('Event cancelled successfully');
      await fetchEvent();
    } catch (err) {
      setSubmitError((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to cancel event');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event) return;

    const parentId = event.recurrence_parent_id || event.id;
    try {
      setSubmitting(true);
      setSubmitError(null);

      const result = await eventService.cancelEventSeries(
        parentId,
        {
          cancellation_reason: cancelReason,
          send_notifications: sendCancelNotifications,
        },
        cancelSeriesFutureOnly,
      );

      setShowCancelSeriesModal(false);
      setCancelReason('');
      setSendCancelNotifications(false);
      setCancelSeriesFutureOnly(false);
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

  const handleDeleteEvent = async () => {
    if (!eventId || !event) return;

    try {
      setSubmitting(true);
      if (deleteScope === 'series' && (event.is_recurring || event.recurrence_parent_id)) {
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
      setDeleteScope('single');
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
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-300">{error || 'Event not found'}</p>
          <button
            onClick={() => navigate('/events')}
            className="mt-2 text-sm text-red-400 hover:text-red-300 underline"
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
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-xs text-sm font-medium text-blue-400 bg-theme-surface hover:bg-blue-500/20"
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
                            onClick={() => { setShowActionsMenu(false); setDeleteScope('single'); setShowDeleteConfirm(true); }}
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
                <div
                  className="text-theme-text-secondary prose-sm"
                  dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(event.description) }}
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

          {/* User's RSVP Status */}
          {event.user_rsvp_status && (
            <div className="bg-theme-surface backdrop-blur-xs rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-medium text-theme-text-primary mb-4">Your RSVP</h2>
              <div className="flex items-center space-x-4">
                <RSVPStatusBadge status={event.user_rsvp_status} />
                {canRSVP && (
                  <button
                    onClick={() => setShowRSVPModal(true)}
                    className="text-sm text-red-400 hover:text-red-300"
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
                  <span className="text-sm font-medium text-red-400">{stats.not_going_count}</span>
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

      {/* RSVP Modal */}
      {showRSVPModal && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rsvp-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowRSVPModal(false); setSubmitError(null); } }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => { setShowRSVPModal(false); setSubmitError(null); }}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <form onSubmit={(e) => { void handleRSVP(e); }}>
                <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 id="rsvp-modal-title" className="text-lg font-medium text-theme-text-primary mb-4">RSVP for {event.title}</h3>

                  {submitError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-300">{submitError}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <fieldset>
                      <legend className="block text-sm font-medium text-theme-text-secondary mb-2">
                        Your Response
                      </legend>
                      <div className="space-y-2">
                        {(event.allowed_rsvp_statuses || [RSVPStatusEnum.GOING, RSVPStatusEnum.NOT_GOING]).map((status) => (
                          <label key={status} className="flex items-center">
                            <input
                              type="radio"
                              name="rsvp-response"
                              value={status}
                              checked={rsvpStatus === status}
                              onChange={(e) => setRsvpStatus(e.target.value as RSVPStatus)}
                              className="h-4 w-4 text-blue-600 focus:ring-theme-focus-ring border-theme-surface-border"
                            />
                            <span className="ml-2 text-sm text-theme-text-secondary">
                              {getRSVPStatusLabel(status)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {event.allow_guests && rsvpStatus === RSVPStatusEnum.GOING && (
                      <div>
                        <label htmlFor="guest_count" className="block text-sm font-medium text-theme-text-secondary">
                          Number of Guests
                        </label>
                        <input
                          type="number"
                          id="guest_count"
                          min="0"
                          max="10"
                          value={guestCount}
                          onChange={(e) => setGuestCount(parseInt(e.target.value))}
                          className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                        />
                      </div>
                    )}

                    <div>
                      <label htmlFor="notes" className="block text-sm font-medium text-theme-text-secondary">
                        Notes (optional)
                      </label>
                      <textarea
                        id="notes"
                        rows={3}
                        value={rsvpNotes}
                        onChange={(e) => setRsvpNotes(e.target.value)}
                        className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                        placeholder="Any special requests or comments"
                      />
                    </div>

                    <div>
                      <label htmlFor="dietary_restrictions" className="block text-sm font-medium text-theme-text-secondary">
                        Dietary Restrictions (optional)
                      </label>
                      <input
                        type="text"
                        id="dietary_restrictions"
                        value={rsvpDietaryRestrictions}
                        onChange={(e) => setRsvpDietaryRestrictions(e.target.value)}
                        className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                        placeholder="e.g., Vegetarian, Nut allergy"
                        maxLength={500}
                      />
                    </div>

                    <div>
                      <label htmlFor="accessibility_needs" className="block text-sm font-medium text-theme-text-secondary">
                        Accessibility Needs (optional)
                      </label>
                      <input
                        type="text"
                        id="accessibility_needs"
                        value={rsvpAccessibilityNeeds}
                        onChange={(e) => setRsvpAccessibilityNeeds(e.target.value)}
                        className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                        placeholder="e.g., Wheelchair access"
                        maxLength={500}
                      />
                    </div>

                    {event && (event.is_recurring || event.recurrence_parent_id) && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rsvpApplyToSeries}
                          onChange={(e) => setRsvpApplyToSeries(e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-theme-focus-ring border-theme-surface-border rounded"
                        />
                        <span className="text-sm text-theme-text-secondary">
                          Apply to all future events in this series
                        </span>
                      </label>
                    )}
                  </div>
                </div>

                <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
                  >
                    {submitting ? 'Submitting...' : 'Submit RSVP'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRSVPModal(false);
                      setSubmitError(null);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Event Modal */}
      {showCancelModal && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-event-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowCancelModal(false); setSubmitError(null); setCancelReason(''); } }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => { setShowCancelModal(false); setSubmitError(null); setCancelReason(''); }}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <form onSubmit={(e) => { void handleCancelEvent(e); }}>
                <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 id="cancel-event-modal-title" className="text-lg font-medium text-theme-text-primary mb-4">Cancel Event</h3>

                  <div className="mb-4 bg-yellow-50 border border-yellow-200 dark:bg-yellow-500/10 dark:border-yellow-500/30 rounded-lg p-3">
                    <p className="text-sm text-yellow-800 dark:text-yellow-400">
                      This action cannot be undone. The event will be marked as cancelled.
                    </p>
                  </div>

                  {submitError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-300">{submitError}</p>
                    </div>
                  )}

                  <div>
                    <label htmlFor="cancel_reason" className="block text-sm font-medium text-theme-text-secondary">
                      Reason for Cancellation <span aria-hidden="true">*</span>
                    </label>
                    <textarea
                      id="cancel_reason"
                      rows={4}
                      required
                      aria-required="true"
                      minLength={10}
                      maxLength={500}
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                      placeholder="Please provide a reason for cancelling this event..."
                    />
                    <p className="mt-1 text-xs text-theme-text-muted">
                      {cancelReason.length}/500 characters (minimum 10)
                    </p>
                  </div>

                  <div className="mt-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={sendCancelNotifications}
                        onChange={(e) => setSendCancelNotifications(e.target.checked)}
                        className="form-checkbox border-theme-surface-border"
                      />
                      <span className="ml-2 text-sm text-theme-text-secondary">
                        Send cancellation notifications to all RSVPs
                      </span>
                    </label>
                  </div>
                </div>

                <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting || cancelReason.length < 10}
                    className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
                  >
                    {submitting ? 'Cancelling...' : 'Cancel Event'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCancelModal(false);
                      setSubmitError(null);
                      setCancelReason('');
                      setSendCancelNotifications(false);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Go Back
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Series Modal */}
      {showCancelSeriesModal && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-series-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowCancelSeriesModal(false); setSubmitError(null); setCancelReason(''); } }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => { setShowCancelSeriesModal(false); setSubmitError(null); setCancelReason(''); }}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <form onSubmit={(e) => { void handleCancelSeries(e); }}>
                <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 id="cancel-series-modal-title" className="text-lg font-medium text-theme-text-primary mb-4">Cancel Recurring Series</h3>

                  <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 dark:bg-red-500/10 dark:border-red-500/30">
                    <p className="text-sm text-red-800 dark:text-red-300">
                      This will cancel multiple events in this recurring series. This action cannot be undone.
                    </p>
                  </div>

                  {submitError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-300">{submitError}</p>
                    </div>
                  )}

                  <div className="mb-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={cancelSeriesFutureOnly}
                        onChange={(e) => setCancelSeriesFutureOnly(e.target.checked)}
                        className="form-checkbox border-theme-surface-border"
                      />
                      <span className="ml-2 text-sm text-theme-text-secondary">
                        Only cancel future events (keep past events)
                      </span>
                    </label>
                  </div>

                  <div>
                    <label htmlFor="cancel_series_reason" className="block text-sm font-medium text-theme-text-secondary">
                      Reason for Cancellation <span aria-hidden="true">*</span>
                    </label>
                    <textarea
                      id="cancel_series_reason"
                      rows={4}
                      required
                      aria-required="true"
                      minLength={10}
                      maxLength={500}
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                      placeholder="Please provide a reason for cancelling this series..."
                    />
                    <p className="mt-1 text-xs text-theme-text-muted">
                      {cancelReason.length}/500 characters (minimum 10)
                    </p>
                  </div>

                  <div className="mt-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={sendCancelNotifications}
                        onChange={(e) => setSendCancelNotifications(e.target.checked)}
                        className="form-checkbox border-theme-surface-border"
                      />
                      <span className="ml-2 text-sm text-theme-text-secondary">
                        Send cancellation notifications to all RSVPs
                      </span>
                    </label>
                  </div>
                </div>

                <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting || cancelReason.length < 10}
                    className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
                  >
                    {submitting ? 'Cancelling...' : 'Cancel Series'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCancelSeriesModal(false);
                      setSubmitError(null);
                      setCancelReason('');
                      setSendCancelNotifications(false);
                      setCancelSeriesFutureOnly(false);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Go Back
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Check In Modal */}
      {showCheckInModal && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="checkin-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowCheckInModal(false); }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowCheckInModal(false)}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full relative z-10">
              <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 id="checkin-modal-title" className="text-lg font-medium text-theme-text-primary">Check In Members</h3>
                  <button
                    type="button"
                    onClick={() => setShowCheckInModal(false)}
                    className="text-theme-text-muted hover:text-theme-text-primary"
                    aria-label="Close dialog"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <p className="text-sm text-theme-text-secondary mb-4">
                  Check in members as they arrive at the event. Their attendance will be recorded with a timestamp.
                </p>

                {/* Bulk Add All Eligible */}
                <div className="mb-4">
                  <button
                    onClick={() => { void handleBulkAddAllEligible(); }}
                    disabled={bulkAddLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {bulkAddLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        Adding...
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Add All Eligible as Going
                      </>
                    )}
                  </button>
                </div>

                {/* Search */}
                <div className="mb-4">
                  <label htmlFor="member-search" className="block text-sm font-medium text-theme-text-secondary mb-2">
                    Search Members
                  </label>
                  <input
                    type="text"
                    id="member-search"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    aria-label="Search by name or email..." placeholder="Search by name or email..."
                    className="block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                  />
                </div>

                {/* Member List */}
                <div className="max-h-96 overflow-y-auto border border-theme-surface-border rounded-md">
                  {eligibleMembers
                    .filter(
                      (member) =>
                        memberSearch === '' ||
                        `${member.first_name} ${member.last_name}`
                          .toLowerCase()
                          .includes(memberSearch.toLowerCase()) ||
                        member.email.toLowerCase().includes(memberSearch.toLowerCase())
                    )
                    .map((member) => {
                      const rsvp = rsvps.find((r) => r.user_id === member.id);
                      const isCheckedIn = rsvp?.checked_in || false;

                      return (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-3 border-b border-theme-surface-border hover:bg-theme-surface-hover"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium text-theme-text-primary">
                              {member.first_name} {member.last_name}
                            </p>
                            <p className="text-xs text-theme-text-muted">{member.email}</p>
                            {rsvp && (
                              <div className="flex items-center mt-1 space-x-2">
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getRSVPStatusColor(
                                    rsvp.status
                                  )}`}
                                >
                                  {getRSVPStatusLabel(rsvp.status)}
                                </span>
                                {isCheckedIn && (
                                  <span className="text-xs text-green-600">
                                    ✓ Checked in at{' '}
                                    {rsvp.checked_in_at &&
                                      formatTime(rsvp.checked_in_at, tz)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div>
                            {isCheckedIn ? (
                              <span className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400">
                                Checked In
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  void handleCheckIn(member.id);
                                  void fetchEligibleMembers();
                                }}
                                className="btn-primary font-medium inline-flex items-center px-3 py-1.5 rounded-md text-sm"
                              >
                                Check In
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  {eligibleMembers.filter(
                    (member) =>
                      memberSearch === '' ||
                      `${member.first_name} ${member.last_name}`
                        .toLowerCase()
                        .includes(memberSearch.toLowerCase()) ||
                      member.email.toLowerCase().includes(memberSearch.toLowerCase())
                  ).length === 0 && (
                    <div className="p-4 text-center text-theme-text-muted">
                      {memberSearch ? 'No members found matching your search.' : 'No members available for check-in.'}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => setShowCheckInModal(false)}
                  className="w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record Times Modal */}
      {showRecordTimesModal && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-times-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowRecordTimesModal(false); setSubmitError(null); } }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => { setShowRecordTimesModal(false); setSubmitError(null); }}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <form onSubmit={(e) => { void handleRecordTimes(e); }}>
                <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 id="record-times-modal-title" className="text-lg font-medium text-theme-text-primary mb-4">Record Official Event Times</h3>

                  <p className="text-sm text-theme-text-secondary mb-4">
                    Record the actual start and end times of the event. All checked-in members will be credited for attendance based on these times.
                  </p>

                  {submitError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-300">{submitError}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="actual_start_time" className="block text-sm font-medium text-theme-text-secondary">
                        Actual Start Time
                      </label>
                      <DateTimeQuarterHour
                        id="actual_start_time"
                        value={actualStartTime}
                        onChange={(val) => setActualStartTime(val)}
                        className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                      />
                      {event?.actual_start_time && (
                        <p className="mt-1 text-xs text-theme-text-muted">
                          Currently: {formatShortDateTime(event.actual_start_time, tz)}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="actual_end_time" className="block text-sm font-medium text-theme-text-secondary">
                        Actual End Time
                      </label>
                      <DateTimeQuarterHour
                        id="actual_end_time"
                        value={actualEndTime}
                        onChange={(val) => setActualEndTime(val)}
                        className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                      />
                      {event?.actual_end_time && (
                        <p className="mt-1 text-xs text-theme-text-muted">
                          Currently: {formatShortDateTime(event.actual_end_time, tz)}
                        </p>
                      )}
                    </div>

                    {actualStartTime && actualEndTime && (
                      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                        <p className="text-sm text-blue-800 dark:text-blue-300">
                          <strong>Duration:</strong>{' '}
                          {Math.round((new Date(actualEndTime).getTime() - new Date(actualStartTime).getTime()) / 60000)} minutes
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
                  >
                    {submitting ? 'Saving...' : 'Save Times'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRecordTimesModal(false);
                      setSubmitError(null);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Override Attendance Modal */}
      {showOverrideModal && editingRsvp && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="override-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowOverrideModal(false); setSubmitError(null); } }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => { setShowOverrideModal(false); setSubmitError(null); }}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <form onSubmit={(e) => { void handleOverrideAttendance(e); }}>
                <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 id="override-modal-title" className="text-lg font-medium text-theme-text-primary mb-1">
                    Edit Attendance Times
                  </h3>
                  <p className="text-sm text-theme-text-muted mb-4">{editingRsvp.user_name}</p>

                  {submitError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-300">{submitError}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="override_check_in" className="block text-sm font-medium text-theme-text-secondary">
                        Check-in Time
                      </label>
                      <DateTimeQuarterHour
                        id="override_check_in"
                        value={overrideCheckIn}
                        onChange={(val) => setOverrideCheckIn(val)}
                        className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                      />
                    </div>

                    <div>
                      <label htmlFor="override_check_out" className="block text-sm font-medium text-theme-text-secondary">
                        Check-out Time
                      </label>
                      <DateTimeQuarterHour
                        id="override_check_out"
                        value={overrideCheckOut}
                        onChange={(val) => setOverrideCheckOut(val)}
                        className="mt-1 block w-full bg-theme-input-bg text-theme-text-primary border-theme-input-border rounded-md shadow-xs focus:ring-theme-focus-ring focus:border-theme-focus-ring sm:text-sm"
                      />
                    </div>

                    {overrideCheckIn && overrideCheckOut && (
                      <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-lg p-3">
                        <p className="text-sm text-blue-800 dark:text-blue-300">
                          <strong>Duration:</strong>{' '}
                          {Math.round((new Date(overrideCheckOut).getTime() - new Date(overrideCheckIn).getTime()) / 60000)} minutes
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
                  >
                    {submitting ? 'Saving...' : 'Save Times'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverrideModal(false);
                      setEditingRsvp(null);
                      setSubmitError(null);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {/* End Event Confirmation Modal */}
      {showEndEventConfirm && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-event-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowEndEventConfirm(false); }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowEndEventConfirm(false)}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-500/20 sm:mx-0 sm:h-10 sm:w-10">
                    <StopCircle className="h-6 w-6 text-red-600" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 id="end-event-modal-title" className="text-lg leading-6 font-medium text-theme-text-primary">
                      End Event Early
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-theme-text-muted">
                        This will end &ldquo;{event.title}&rdquo; now and check out all currently checked-in members. Attendance durations will be calculated based on the current time.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { void handleEndEvent(); }}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-xs px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  {submitting ? 'Ending...' : 'End Event Now'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEndEventConfirm(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-event-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowDeleteConfirm(false); }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowDeleteConfirm(false)}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 dark:bg-red-500/20 sm:mx-0 sm:h-10 sm:w-10">
                    <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 id="delete-event-modal-title" className="text-lg leading-6 font-medium text-theme-text-primary">
                      Delete Event
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-theme-text-muted">
                        Are you sure you want to permanently delete &ldquo;{event.title}&rdquo;? This will remove all RSVPs and attendance records. This action cannot be undone.
                      </p>
                      {(event.is_recurring || event.recurrence_parent_id) && (
                        <div className="mt-4 space-y-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="deleteScope"
                              value="single"
                              checked={deleteScope === 'single'}
                              onChange={() => setDeleteScope('single')}
                              className="text-theme-primary focus:ring-theme-focus-ring"
                            />
                            <span className="text-sm text-theme-text-primary">Delete only this event</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="deleteScope"
                              value="series"
                              checked={deleteScope === 'series'}
                              onChange={() => setDeleteScope('series')}
                              className="text-theme-primary focus:ring-theme-focus-ring"
                            />
                            <span className="text-sm text-theme-text-primary">Delete all events in this series</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { void handleDeleteEvent(); }}
                  className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full"
                >
                  {submitting ? 'Deleting...' : deleteScope === 'series' ? 'Delete Entire Series' : 'Delete Permanently'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save as Template Modal */}
      {showTemplateModal && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-template-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowTemplateModal(false); }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true" onClick={() => setShowTemplateModal(false)}>
              <div className="absolute inset-0 bg-black/75"></div>
            </div>

            <div className="inline-block align-bottom bg-theme-surface-modal rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <form onSubmit={(e) => {
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
              }}>
                <div className="bg-theme-surface-modal px-4 pt-5 pb-4 sm:p-6">
                  <h3 id="save-template-modal-title" className="text-lg leading-6 font-medium text-theme-text-primary mb-4">
                    Save as Template
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                        Template Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                        placeholder="e.g., Weekly Business Meeting"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                        Description (optional)
                      </label>
                      <textarea
                        value={templateDescription}
                        onChange={(e) => setTemplateDescription(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                        placeholder="Brief description of this template..."
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-theme-surface-secondary px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting || !templateName.trim()}
                    className="btn-primary font-medium inline-flex justify-center rounded-md sm:ml-3 sm:text-sm sm:w-auto text-base w-full disabled:opacity-50"
                  >
                    {submitting ? 'Saving...' : 'Save Template'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTemplateModal(false)}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-theme-surface-border shadow-xs px-4 py-2 bg-theme-surface text-base font-medium text-theme-text-secondary hover:bg-theme-surface-hover focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
};
