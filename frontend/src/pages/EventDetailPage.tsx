/**
 * Event Detail Page
 *
 * Shows detailed information about an event including RSVPs and attendee management.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AxiosError } from 'axios';
import { eventService } from '../services/api';
import type { Event, RSVP, RSVPStatus, EventStats } from '../types/event';
import { useAuthStore } from '../stores/authStore';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EventTypeBadge } from '../components/EventTypeBadge';
import { RSVPStatusBadge } from '../components/RSVPStatusBadge';
import { getRSVPStatusLabel, getRSVPStatusColor } from '../utils/eventHelpers';
import { formatDateTime, formatTime, formatForDateTimeInput } from '../utils/dateFormatting';

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
  const [rsvpStatus, setRsvpStatus] = useState<RSVPStatus>('going');
  const [guestCount, setGuestCount] = useState(0);
  const [rsvpNotes, setRsvpNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [sendCancelNotifications, setSendCancelNotifications] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [eligibleMembers, setEligibleMembers] = useState<Array<{ id: string; first_name: string; last_name: string; email: string }>>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [actualStartTime, setActualStartTime] = useState('');
  const [actualEndTime, setActualEndTime] = useState('');

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('events.manage');

  useEffect(() => {
    if (eventId) {
      fetchEvent();
      if (canManage) {
        fetchRSVPs();
        fetchStats();
      }
    }
  }, [eventId, canManage]);

  const fetchEvent = async () => {
    if (!eventId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEvent(eventId);
      setEvent(data);
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
    } catch (err) {
      // Error silently handled - RSVPs section will show empty
    }
  };

  const fetchStats = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEventStats(eventId);
      setStats(data);
    } catch (err) {
      // Error silently handled - stats section will show empty
    }
  };

  const fetchEligibleMembers = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEligibleMembers(eventId);
      setEligibleMembers(data);
    } catch (err) {
      // Error silently handled - eligible members list will show empty
    }
  };

  const openCheckInModal = () => {
    fetchEligibleMembers();
    setShowCheckInModal(true);
    setMemberSearch('');
  };

  const handleRSVP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventId) return;

    try {
      setSubmitting(true);
      setSubmitError(null);

      await eventService.createOrUpdateRSVP(eventId, {
        status: rsvpStatus,
        guest_count: guestCount,
        notes: rsvpNotes,
      });

      setShowRSVPModal(false);
      setRsvpStatus('going');
      setGuestCount(0);
      setRsvpNotes('');
      toast.success('RSVP submitted successfully');
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

  const handleDeleteEvent = async () => {
    if (!eventId) return;

    try {
      setSubmitting(true);
      await eventService.deleteEvent(eventId);
      toast.success('Event deleted successfully');
      navigate('/events');
    } catch (err) {
      toast.error((err as AxiosError<{ detail?: string }>).response?.data?.detail || 'Failed to delete event');
    } finally {
      setSubmitting(false);
      setShowDeleteConfirm(false);
    }
  };

  const openRecordTimesModal = () => {
    if (event) {
      // Pre-fill with existing actual times if they exist
      setActualStartTime(event.actual_start_time ? formatForDateTimeInput(event.actual_start_time) : '');
      setActualEndTime(event.actual_end_time ? formatForDateTimeInput(event.actual_end_time) : '');
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
        actual_start_time: actualStartTime ? new Date(actualStartTime).toISOString() : undefined,
        actual_end_time: actualEndTime ? new Date(actualEndTime).toISOString() : undefined,
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
  const canRSVP = event.requires_rsvp && !event.is_cancelled && !isPastEvent &&
    (!event.rsvp_deadline || new Date(event.rsvp_deadline) > new Date());

  return (
    <div className="min-h-screen">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/events"
          className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200 mb-4"
        >
          <svg className="mr-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Events
        </Link>

        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-white">{event.title}</h1>
            <div className="mt-2 flex items-center space-x-2">
              <EventTypeBadge type={event.event_type} size="sm" />
              {event.is_cancelled && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-300">
                  Cancelled
                </span>
              )}
              {event.is_mandatory && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                  Mandatory
                </span>
              )}
            </div>
          </div>

          {!event.is_cancelled && (
            <div className="flex space-x-3">
              {canRSVP && (
                <button
                  onClick={() => setShowRSVPModal(true)}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700"
                >
                  {event.user_rsvp_status ? 'Update RSVP' : 'RSVP Now'}
                </button>
              )}
              <button
                onClick={() => navigate(`/events/${eventId}/qr`)}
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-400 bg-white/10 hover:bg-blue-500/20"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                View QR Code
              </button>
              {canManage && (
                <>
                  <button
                    onClick={() => navigate(`/events/${eventId}/edit`)}
                    className="inline-flex items-center px-4 py-2 border border-white/30 rounded-md shadow-sm text-sm font-medium text-slate-200 bg-white/10 hover:bg-white/5"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Edit
                  </button>
                  <button
                    onClick={handleDuplicateEvent}
                    disabled={submitting}
                    className="inline-flex items-center px-4 py-2 border border-white/30 rounded-md shadow-sm text-sm font-medium text-slate-200 bg-white/10 hover:bg-white/5 disabled:opacity-50"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Duplicate
                  </button>
                  <button
                    onClick={openCheckInModal}
                    className="inline-flex items-center px-4 py-2 border border-white/30 rounded-md shadow-sm text-sm font-medium text-slate-200 bg-white/10 hover:bg-white/5"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    Check In Members
                  </button>
                  <button
                    onClick={openRecordTimesModal}
                    className="inline-flex items-center px-4 py-2 border border-white/30 rounded-md shadow-sm text-sm font-medium text-slate-200 bg-white/10 hover:bg-white/5"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Record Times
                  </button>
                  <button
                    onClick={() => navigate(`/events/${eventId}/monitoring`)}
                    className="inline-flex items-center px-4 py-2 border border-green-300 rounded-md shadow-sm text-sm font-medium text-green-400 bg-white/10 hover:bg-green-500/20"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Monitoring
                  </button>
                  <button
                    onClick={() => setShowCancelModal(true)}
                    className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-400 bg-white/10 hover:bg-red-500/20"
                  >
                    Cancel Event
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-400 bg-white/10 hover:bg-red-500/20"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Event Details */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-white mb-4">Event Details</h2>

            {event.is_cancelled && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <p className="text-sm font-medium text-red-300">This event has been cancelled</p>
                {event.cancellation_reason && (
                  <p className="text-sm text-red-400 mt-1">Reason: {event.cancellation_reason}</p>
                )}
              </div>
            )}

            {event.description && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-slate-200 mb-1">Description</h3>
                <p className="text-slate-300 whitespace-pre-wrap">{event.description}</p>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-start">
                <svg className="flex-shrink-0 mr-3 h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-slate-200">Date & Time</p>
                  <p className="text-sm text-slate-300">
                    {formatDateTime(event.start_datetime)}
                  </p>
                  <p className="text-sm text-slate-300">
                    to {formatTime(event.end_datetime)}
                  </p>
                </div>
              </div>

              {(event.location_name || event.location) && (
                <div className="flex items-start">
                  <svg className="flex-shrink-0 mr-3 h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-slate-200">Location</p>
                    <p className="text-sm text-slate-300">{event.location_name || event.location}</p>
                    {event.location_details && (
                      <p className="text-sm text-slate-400 mt-1">{event.location_details}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Training Session Details */}
          {event.event_type === 'training' && event.custom_fields && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow p-6 border-l-4 border-purple-600">
              <div className="flex items-center mb-4">
                <svg className="h-6 w-6 text-purple-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h2 className="text-lg font-medium text-white">Training Session Details</h2>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {event.custom_fields.course_name && (
                  <div>
                    <p className="text-sm font-medium text-slate-200">Course Name</p>
                    <p className="text-sm text-white">{event.custom_fields.course_name}</p>
                  </div>
                )}

                {event.custom_fields.course_code && (
                  <div>
                    <p className="text-sm font-medium text-slate-200">Course Code</p>
                    <p className="text-sm text-white">{event.custom_fields.course_code}</p>
                  </div>
                )}

                {event.custom_fields.credit_hours && (
                  <div>
                    <p className="text-sm font-medium text-slate-200">Credit Hours</p>
                    <p className="text-sm text-white">{event.custom_fields.credit_hours} hours</p>
                  </div>
                )}

                {event.custom_fields.training_type && (
                  <div>
                    <p className="text-sm font-medium text-slate-200">Training Type</p>
                    <p className="text-sm text-white capitalize">
                      {typeof event.custom_fields.training_type === 'string'
                        ? event.custom_fields.training_type.replace('_', ' ')
                        : event.custom_fields.training_type}
                    </p>
                  </div>
                )}

                {event.custom_fields.instructor && (
                  <div>
                    <p className="text-sm font-medium text-slate-200">Instructor</p>
                    <p className="text-sm text-white">{event.custom_fields.instructor}</p>
                  </div>
                )}

                {event.custom_fields.issuing_agency && (
                  <div>
                    <p className="text-sm font-medium text-slate-200">Issuing Agency</p>
                    <p className="text-sm text-white">{event.custom_fields.issuing_agency}</p>
                  </div>
                )}

                {event.custom_fields.expiration_months && (
                  <div>
                    <p className="text-sm font-medium text-slate-200">Certification Valid For</p>
                    <p className="text-sm text-white">{event.custom_fields.expiration_months} months</p>
                  </div>
                )}

                {event.custom_fields.issues_certification && (
                  <div className="col-span-2">
                    <div className="flex items-center p-3 bg-green-50 border border-green-200 rounded-lg">
                      <svg className="h-5 w-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm font-medium text-green-800">This training issues a certification upon completion</span>
                    </div>
                  </div>
                )}

                {event.custom_fields.auto_create_records && (
                  <div className="col-span-2">
                    <div className="flex items-center p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <svg className="h-5 w-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="text-sm font-medium text-blue-800">Training records are automatically created when members check in</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* User's RSVP Status */}
          {event.user_rsvp_status && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-white mb-4">Your RSVP</h2>
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
            </div>
          )}

          {/* RSVPs List (for managers) */}
          {canManage && rsvps.length > 0 && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-white mb-4">RSVPs</h2>
              <div className="space-y-3">
                {rsvps.map((rsvp) => (
                  <div key={rsvp.id} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{rsvp.user_name}</p>
                      <p className="text-xs text-slate-400">{rsvp.user_email}</p>
                      {rsvp.guest_count > 0 && (
                        <p className="text-xs text-slate-400 mt-1">+{rsvp.guest_count} guest{rsvp.guest_count > 1 ? 's' : ''}</p>
                      )}
                      {rsvp.notes && (
                        <p className="text-xs text-slate-300 mt-1">{rsvp.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRSVPStatusColor(rsvp.status)}`}>
                        {getRSVPStatusLabel(rsvp.status)}
                      </span>
                      {rsvp.status === 'going' && !rsvp.checked_in && (
                        <button
                          onClick={() => handleCheckIn(rsvp.user_id)}
                          className="text-sm text-red-400 hover:text-red-300"
                        >
                          Check In
                        </button>
                      )}
                      {rsvp.checked_in && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Checked In
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Stats */}
          {stats && (
            <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-white mb-4">Statistics</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-300">Total RSVPs</span>
                  <span className="text-sm font-medium text-white">{stats.total_rsvps}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-300">Going</span>
                  <span className="text-sm font-medium text-green-600">{stats.going_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-300">Not Going</span>
                  <span className="text-sm font-medium text-red-400">{stats.not_going_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-300">Maybe</span>
                  <span className="text-sm font-medium text-yellow-600">{stats.maybe_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-300">Checked In</span>
                  <span className="text-sm font-medium text-white">{stats.checked_in_count}</span>
                </div>
                {stats.capacity_percentage !== null && stats.capacity_percentage !== undefined && (
                  <div className="pt-3 border-t">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-slate-300">Capacity</span>
                      <span className="text-sm font-medium text-white">{stats.capacity_percentage.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-white/20 rounded-full h-2">
                      <div
                        className="bg-red-600 h-2 rounded-full"
                        style={{ width: `${Math.min(stats.capacity_percentage, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Event Info */}
          <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-white mb-4">Event Information</h2>
            <div className="space-y-3">
              {event.requires_rsvp && (
                <>
                  <div>
                    <p className="text-sm text-slate-300">RSVP Required</p>
                    <p className="text-sm font-medium text-white">Yes</p>
                  </div>
                  {event.rsvp_deadline && (
                    <div>
                      <p className="text-sm text-slate-300">RSVP Deadline</p>
                      <p className="text-sm font-medium text-white">
                        {new Date(event.rsvp_deadline).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  )}
                  {event.max_attendees && (
                    <div>
                      <p className="text-sm text-slate-300">Max Attendees</p>
                      <p className="text-sm font-medium text-white">{event.max_attendees}</p>
                    </div>
                  )}
                </>
              )}
              {event.allow_guests && (
                <div>
                  <p className="text-sm text-slate-300">Guests Allowed</p>
                  <p className="text-sm font-medium text-white">Yes</p>
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
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-slate-900/500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-slate-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleRSVP}>
                <div className="bg-slate-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 id="rsvp-modal-title" className="text-lg font-medium text-white mb-4">RSVP for {event.title}</h3>

                  {submitError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-300">{submitError}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <fieldset>
                      <legend className="block text-sm font-medium text-slate-200 mb-2">
                        Your Response
                      </legend>
                      <div className="space-y-2">
                        {(event.allowed_rsvp_statuses || ['going', 'not_going']).map((status) => (
                          <label key={status} className="flex items-center">
                            <input
                              type="radio"
                              name="rsvp-response"
                              value={status}
                              checked={rsvpStatus === status}
                              onChange={(e) => setRsvpStatus(e.target.value as RSVPStatus)}
                              className="h-4 w-4 text-red-600 focus:ring-red-500 border-slate-600"
                            />
                            <span className="ml-2 text-sm text-slate-200">
                              {getRSVPStatusLabel(status as RSVPStatus)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {event.allow_guests && rsvpStatus === 'going' && (
                      <div>
                        <label htmlFor="guest_count" className="block text-sm font-medium text-slate-200">
                          Number of Guests
                        </label>
                        <input
                          type="number"
                          id="guest_count"
                          min="0"
                          max="10"
                          value={guestCount}
                          onChange={(e) => setGuestCount(parseInt(e.target.value))}
                          className="mt-1 block w-full bg-slate-900/50 text-white border-slate-600 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                        />
                      </div>
                    )}

                    <div>
                      <label htmlFor="notes" className="block text-sm font-medium text-slate-200">
                        Notes (optional)
                      </label>
                      <textarea
                        id="notes"
                        rows={3}
                        value={rsvpNotes}
                        onChange={(e) => setRsvpNotes(e.target.value)}
                        className="mt-1 block w-full bg-slate-900/50 text-white border-slate-600 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                        placeholder="Dietary restrictions, special accommodations, etc."
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Submit RSVP'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRSVPModal(false);
                      setSubmitError(null);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-white/30 shadow-sm px-4 py-2 bg-white/10 text-base font-medium text-slate-200 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-slate-900/500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-slate-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleCancelEvent}>
                <div className="bg-slate-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 id="cancel-event-modal-title" className="text-lg font-medium text-white mb-4">Cancel Event</h3>

                  <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-sm text-yellow-800">
                      This action cannot be undone. The event will be marked as cancelled.
                    </p>
                  </div>

                  {submitError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-300">{submitError}</p>
                    </div>
                  )}

                  <div>
                    <label htmlFor="cancel_reason" className="block text-sm font-medium text-slate-200">
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
                      className="mt-1 block w-full bg-slate-900/50 text-white border-slate-600 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      placeholder="Please provide a reason for cancelling this event..."
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      {cancelReason.length}/500 characters (minimum 10)
                    </p>
                  </div>

                  <div className="mt-4">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={sendCancelNotifications}
                        onChange={(e) => setSendCancelNotifications(e.target.checked)}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-slate-600 rounded"
                      />
                      <span className="ml-2 text-sm text-slate-200">
                        Send cancellation notifications to all RSVPs
                      </span>
                    </label>
                  </div>
                </div>

                <div className="bg-slate-900/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting || cancelReason.length < 10}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
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
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-white/30 shadow-sm px-4 py-2 bg-white/10 text-base font-medium text-slate-200 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-slate-900/500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-slate-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
              <div className="bg-slate-800 px-4 pt-5 pb-4 sm:p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 id="checkin-modal-title" className="text-lg font-medium text-white">Check In Members</h3>
                  <button
                    type="button"
                    onClick={() => setShowCheckInModal(false)}
                    className="text-slate-500 hover:text-slate-400"
                    aria-label="Close dialog"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <p className="text-sm text-slate-300 mb-4">
                  Check in members as they arrive at the event. Their attendance will be recorded with a timestamp.
                </p>

                {/* Search */}
                <div className="mb-4">
                  <label htmlFor="member-search" className="block text-sm font-medium text-slate-200 mb-2">
                    Search Members
                  </label>
                  <input
                    type="text"
                    id="member-search"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search by name or email..."
                    className="block w-full bg-slate-900/50 text-white border-slate-600 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>

                {/* Member List */}
                <div className="max-h-96 overflow-y-auto border border-white/20 rounded-md">
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
                          className="flex items-center justify-between p-3 border-b border-white/20 hover:bg-white/5"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">
                              {member.first_name} {member.last_name}
                            </p>
                            <p className="text-xs text-slate-400">{member.email}</p>
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
                                      new Date(rsvp.checked_in_at).toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                      })}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div>
                            {isCheckedIn ? (
                              <span className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium bg-green-100 text-green-800">
                                Checked In
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  handleCheckIn(member.id);
                                  fetchEligibleMembers();
                                }}
                                className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700"
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
                    <div className="p-4 text-center text-slate-400">
                      {memberSearch ? 'No members found matching your search.' : 'No members available for check-in.'}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-900/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => setShowCheckInModal(false)}
                  className="w-full inline-flex justify-center rounded-md border border-white/30 shadow-sm px-4 py-2 bg-white/10 text-base font-medium text-slate-200 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
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
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-slate-900/500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-slate-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleRecordTimes}>
                <div className="bg-slate-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 id="record-times-modal-title" className="text-lg font-medium text-white mb-4">Record Official Event Times</h3>

                  <p className="text-sm text-slate-300 mb-4">
                    Record the actual start and end times of the event. All checked-in members will be credited for attendance based on these times.
                  </p>

                  {submitError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-300">{submitError}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="actual_start_time" className="block text-sm font-medium text-slate-200">
                        Actual Start Time
                      </label>
                      <input
                        type="datetime-local"
                        id="actual_start_time"
                        value={actualStartTime}
                        onChange={(e) => setActualStartTime(e.target.value)}
                        className="mt-1 block w-full bg-slate-900/50 text-white border-slate-600 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      />
                      {event?.actual_start_time && (
                        <p className="mt-1 text-xs text-slate-400">
                          Currently: {new Date(event.actual_start_time).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="actual_end_time" className="block text-sm font-medium text-slate-200">
                        Actual End Time
                      </label>
                      <input
                        type="datetime-local"
                        id="actual_end_time"
                        value={actualEndTime}
                        onChange={(e) => setActualEndTime(e.target.value)}
                        className="mt-1 block w-full bg-slate-900/50 text-white border-slate-600 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      />
                      {event?.actual_end_time && (
                        <p className="mt-1 text-xs text-slate-400">
                          Currently: {new Date(event.actual_end_time).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </p>
                      )}
                    </div>

                    {actualStartTime && actualEndTime && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-sm text-blue-800">
                          <strong>Duration:</strong>{' '}
                          {Math.round((new Date(actualEndTime).getTime() - new Date(actualStartTime).getTime()) / 60000)} minutes
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-slate-900/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                  >
                    {submitting ? 'Saving...' : 'Save Times'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRecordTimesModal(false);
                      setSubmitError(null);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-white/30 shadow-sm px-4 py-2 bg-white/10 text-base font-medium text-slate-200 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-event-modal-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setShowDeleteConfirm(false); }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-slate-900/500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-slate-800 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-slate-800 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 id="delete-event-modal-title" className="text-lg leading-6 font-medium text-white">
                      Delete Event
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-slate-400">
                        Are you sure you want to permanently delete &ldquo;{event.title}&rdquo;? This will remove all RSVPs and attendance records. This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleDeleteEvent}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  {submitting ? 'Deleting...' : 'Delete Permanently'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-white/30 shadow-sm px-4 py-2 bg-white/10 text-base font-medium text-slate-200 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
};
