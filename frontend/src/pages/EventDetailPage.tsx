/**
 * Event Detail Page
 *
 * Shows detailed information about an event including RSVPs and attendee management.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { eventService } from '../services/api';
import type { Event, RSVP, RSVPStatus, EventStats } from '../types/event';
import { useAuthStore } from '../stores/authStore';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EventTypeBadge } from '../components/EventTypeBadge';
import { RSVPStatusBadge } from '../components/RSVPStatusBadge';
import { getRSVPStatusLabel, getRSVPStatusColor } from '../utils/eventHelpers';
import { formatDateTime, formatTime, formatForDateTimeInput } from '../utils/dateFormatting';

export const EventDetailPage: React.FC = () => {
  const { eventId } = useParams<{ eventId: string }>();
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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [eligibleMembers, setEligibleMembers] = useState<Array<{ id: string; first_name: string; last_name: string; email: string }>>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [actualStartTime, setActualStartTime] = useState('');
  const [actualEndTime, setActualEndTime] = useState('');

  const { checkPermission, user: _user } = useAuthStore();
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
      console.error('Error fetching event:', err);
      setError((err as any).response?.data?.detail || 'Failed to load event');
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
      console.error('Error fetching RSVPs:', err);
    }
  };

  const fetchStats = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEventStats(eventId);
      setStats(data);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  const fetchEligibleMembers = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEligibleMembers(eventId);
      setEligibleMembers(data);
    } catch (err) {
      console.error('Error fetching eligible members:', err);
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
      await fetchEvent();
      if (canManage) {
        await fetchRSVPs();
        await fetchStats();
      }
    } catch (err) {
      console.error('Error submitting RSVP:', err);
      setSubmitError((err as any).response?.data?.detail || 'Failed to submit RSVP');
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
      });

      setShowCancelModal(false);
      setCancelReason('');
      await fetchEvent();
    } catch (err) {
      console.error('Error cancelling event:', err);
      setSubmitError((err as any).response?.data?.detail || 'Failed to cancel event');
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
      console.error('Error checking in attendee:', err);
      toast.error((err as any).response?.data?.detail || 'Failed to check in attendee');
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
      console.error('Error recording times:', err);
      setSubmitError((err as any).response?.data?.detail || 'Failed to record times');
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error || 'Event not found'}</p>
          <button
            onClick={() => navigate('/events')}
            className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link
          to="/events"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <svg className="mr-1 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Events
        </Link>

        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{event.title}</h1>
            <div className="mt-2 flex items-center space-x-2">
              <EventTypeBadge type={event.event_type} size="sm" />
              {event.is_cancelled && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
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
                className="inline-flex items-center px-4 py-2 border border-blue-300 rounded-md shadow-sm text-sm font-medium text-blue-700 bg-white hover:bg-blue-50"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                View QR Code
              </button>
              {canManage && (
                <>
                  <button
                    onClick={openCheckInModal}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    Check In Members
                  </button>
                  <button
                    onClick={openRecordTimesModal}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Record Times
                  </button>
                  <button
                    onClick={() => navigate(`/events/${eventId}/monitoring`)}
                    className="inline-flex items-center px-4 py-2 border border-green-300 rounded-md shadow-sm text-sm font-medium text-green-700 bg-white hover:bg-green-50"
                  >
                    <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Monitoring Dashboard
                  </button>
                  <button
                    onClick={() => setShowCancelModal(true)}
                    className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50"
                  >
                    Cancel Event
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Event Details</h2>

            {event.is_cancelled && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm font-medium text-red-800">This event has been cancelled</p>
                {event.cancellation_reason && (
                  <p className="text-sm text-red-700 mt-1">Reason: {event.cancellation_reason}</p>
                )}
              </div>
            )}

            {event.description && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-gray-700 mb-1">Description</h3>
                <p className="text-gray-600 whitespace-pre-wrap">{event.description}</p>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-start">
                <svg className="flex-shrink-0 mr-3 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-gray-700">Date & Time</p>
                  <p className="text-sm text-gray-600">
                    {formatDateTime(event.start_datetime)}
                  </p>
                  <p className="text-sm text-gray-600">
                    to {formatTime(event.end_datetime)}
                  </p>
                </div>
              </div>

              {event.location && (
                <div className="flex items-start">
                  <svg className="flex-shrink-0 mr-3 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Location</p>
                    <p className="text-sm text-gray-600">{event.location}</p>
                    {event.location_details && (
                      <p className="text-sm text-gray-500 mt-1">{event.location_details}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Training Session Details */}
          {event.event_type === 'training' && event.custom_fields && (
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-purple-600">
              <div className="flex items-center mb-4">
                <svg className="h-6 w-6 text-purple-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h2 className="text-lg font-medium text-gray-900">Training Session Details</h2>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {event.custom_fields.course_name && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Course Name</p>
                    <p className="text-sm text-gray-900">{event.custom_fields.course_name}</p>
                  </div>
                )}

                {event.custom_fields.course_code && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Course Code</p>
                    <p className="text-sm text-gray-900">{event.custom_fields.course_code}</p>
                  </div>
                )}

                {event.custom_fields.credit_hours && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Credit Hours</p>
                    <p className="text-sm text-gray-900">{event.custom_fields.credit_hours} hours</p>
                  </div>
                )}

                {event.custom_fields.training_type && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Training Type</p>
                    <p className="text-sm text-gray-900 capitalize">
                      {typeof event.custom_fields.training_type === 'string'
                        ? event.custom_fields.training_type.replace('_', ' ')
                        : event.custom_fields.training_type}
                    </p>
                  </div>
                )}

                {event.custom_fields.instructor && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Instructor</p>
                    <p className="text-sm text-gray-900">{event.custom_fields.instructor}</p>
                  </div>
                )}

                {event.custom_fields.issuing_agency && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Issuing Agency</p>
                    <p className="text-sm text-gray-900">{event.custom_fields.issuing_agency}</p>
                  </div>
                )}

                {event.custom_fields.expiration_months && (
                  <div>
                    <p className="text-sm font-medium text-gray-700">Certification Valid For</p>
                    <p className="text-sm text-gray-900">{event.custom_fields.expiration_months} months</p>
                  </div>
                )}

                {event.custom_fields.issues_certification && (
                  <div className="col-span-2">
                    <div className="flex items-center p-3 bg-green-50 border border-green-200 rounded-lg">
                      <svg className="h-5 w-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-sm font-medium text-green-800">This training issues a certification upon completion</span>
                    </div>
                  </div>
                )}

                {event.custom_fields.auto_create_records && (
                  <div className="col-span-2">
                    <div className="flex items-center p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <svg className="h-5 w-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Your RSVP</h2>
              <div className="flex items-center space-x-4">
                <RSVPStatusBadge status={event.user_rsvp_status} />
                {canRSVP && (
                  <button
                    onClick={() => setShowRSVPModal(true)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Change RSVP
                  </button>
                )}
              </div>
            </div>
          )}

          {/* RSVPs List (for managers) */}
          {canManage && rsvps.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">RSVPs</h2>
              <div className="space-y-3">
                {rsvps.map((rsvp) => (
                  <div key={rsvp.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{rsvp.user_name}</p>
                      <p className="text-xs text-gray-500">{rsvp.user_email}</p>
                      {rsvp.guest_count > 0 && (
                        <p className="text-xs text-gray-500 mt-1">+{rsvp.guest_count} guest{rsvp.guest_count > 1 ? 's' : ''}</p>
                      )}
                      {rsvp.notes && (
                        <p className="text-xs text-gray-600 mt-1">{rsvp.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRSVPStatusColor(rsvp.status)}`}>
                        {getRSVPStatusLabel(rsvp.status)}
                      </span>
                      {rsvp.status === 'going' && !rsvp.checked_in && (
                        <button
                          onClick={() => handleCheckIn(rsvp.user_id)}
                          className="text-sm text-red-600 hover:text-red-800"
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
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Statistics</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Total RSVPs</span>
                  <span className="text-sm font-medium text-gray-900">{stats.total_rsvps}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Going</span>
                  <span className="text-sm font-medium text-green-600">{stats.going_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Not Going</span>
                  <span className="text-sm font-medium text-red-600">{stats.not_going_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Maybe</span>
                  <span className="text-sm font-medium text-yellow-600">{stats.maybe_count}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Checked In</span>
                  <span className="text-sm font-medium text-gray-900">{stats.checked_in_count}</span>
                </div>
                {stats.capacity_percentage !== null && stats.capacity_percentage !== undefined && (
                  <div className="pt-3 border-t">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-gray-600">Capacity</span>
                      <span className="text-sm font-medium text-gray-900">{stats.capacity_percentage.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
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
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Event Information</h2>
            <div className="space-y-3">
              {event.requires_rsvp && (
                <>
                  <div>
                    <p className="text-sm text-gray-600">RSVP Required</p>
                    <p className="text-sm font-medium text-gray-900">Yes</p>
                  </div>
                  {event.rsvp_deadline && (
                    <div>
                      <p className="text-sm text-gray-600">RSVP Deadline</p>
                      <p className="text-sm font-medium text-gray-900">
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
                      <p className="text-sm text-gray-600">Max Attendees</p>
                      <p className="text-sm font-medium text-gray-900">{event.max_attendees}</p>
                    </div>
                  )}
                </>
              )}
              {event.allow_guests && (
                <div>
                  <p className="text-sm text-gray-600">Guests Allowed</p>
                  <p className="text-sm font-medium text-gray-900">Yes</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* RSVP Modal */}
      {showRSVPModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleRSVP}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">RSVP for {event.title}</h3>

                  {submitError && (
                    <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-sm text-red-800">{submitError}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Your Response
                      </label>
                      <div className="space-y-2">
                        {(event.allowed_rsvp_statuses || ['going', 'not_going']).map((status) => (
                          <label key={status} className="flex items-center">
                            <input
                              type="radio"
                              value={status}
                              checked={rsvpStatus === status}
                              onChange={(e) => setRsvpStatus(e.target.value as RSVPStatus)}
                              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300"
                            />
                            <span className="ml-2 text-sm text-gray-700">
                              {getRSVPStatusLabel(status as RSVPStatus)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {event.allow_guests && rsvpStatus === 'going' && (
                      <div>
                        <label htmlFor="guest_count" className="block text-sm font-medium text-gray-700">
                          Number of Guests
                        </label>
                        <input
                          type="number"
                          id="guest_count"
                          min="0"
                          max="10"
                          value={guestCount}
                          onChange={(e) => setGuestCount(parseInt(e.target.value))}
                          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                        />
                      </div>
                    )}

                    <div>
                      <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
                        Notes (optional)
                      </label>
                      <textarea
                        id="notes"
                        rows={3}
                        value={rsvpNotes}
                        onChange={(e) => setRsvpNotes(e.target.value)}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                        placeholder="Dietary restrictions, special accommodations, etc."
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
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
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleCancelEvent}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Cancel Event</h3>

                  <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-sm text-yellow-800">
                      This action will notify all attendees that the event has been cancelled.
                    </p>
                  </div>

                  {submitError && (
                    <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-sm text-red-800">{submitError}</p>
                    </div>
                  )}

                  <div>
                    <label htmlFor="cancel_reason" className="block text-sm font-medium text-gray-700">
                      Reason for Cancellation *
                    </label>
                    <textarea
                      id="cancel_reason"
                      rows={4}
                      required
                      minLength={10}
                      maxLength={500}
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      placeholder="Please provide a reason for cancelling this event..."
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {cancelReason.length}/500 characters (minimum 10)
                    </p>
                  </div>
                </div>

                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
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
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Check In Members</h3>
                  <button
                    type="button"
                    onClick={() => setShowCheckInModal(false)}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <p className="text-sm text-gray-600 mb-4">
                  Check in members as they arrive at the event. Their attendance will be recorded with a timestamp.
                </p>

                {/* Search */}
                <div className="mb-4">
                  <label htmlFor="member-search" className="block text-sm font-medium text-gray-700 mb-2">
                    Search Members
                  </label>
                  <input
                    type="text"
                    id="member-search"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search by name or email..."
                    className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                  />
                </div>

                {/* Member List */}
                <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-md">
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
                          className="flex items-center justify-between p-3 border-b border-gray-200 hover:bg-gray-50"
                        >
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {member.first_name} {member.last_name}
                            </p>
                            <p className="text-xs text-gray-500">{member.email}</p>
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
                    <div className="p-4 text-center text-gray-500">
                      {memberSearch ? 'No members found matching your search.' : 'No members available for check-in.'}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={() => setShowCheckInModal(false)}
                  className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
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
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleRecordTimes}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Record Official Event Times</h3>

                  <p className="text-sm text-gray-600 mb-4">
                    Record the actual start and end times of the event. All checked-in members will be credited for attendance based on these times.
                  </p>

                  {submitError && (
                    <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-sm text-red-800">{submitError}</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label htmlFor="actual_start_time" className="block text-sm font-medium text-gray-700">
                        Actual Start Time
                      </label>
                      <input
                        type="datetime-local"
                        id="actual_start_time"
                        value={actualStartTime}
                        onChange={(e) => setActualStartTime(e.target.value)}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      />
                      {event?.actual_start_time && (
                        <p className="mt-1 text-xs text-gray-500">
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
                      <label htmlFor="actual_end_time" className="block text-sm font-medium text-gray-700">
                        Actual End Time
                      </label>
                      <input
                        type="datetime-local"
                        id="actual_end_time"
                        value={actualEndTime}
                        onChange={(e) => setActualEndTime(e.target.value)}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      />
                      {event?.actual_end_time && (
                        <p className="mt-1 text-xs text-gray-500">
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

                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
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
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
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
  );
};
