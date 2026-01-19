/**
 * Event Detail Page
 *
 * Shows detailed information about an event including RSVPs and attendee management.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { eventService } from '../services/api';
import type { Event, RSVP, RSVPStatus, EventStats } from '../types/event';
import { useAuthStore } from '../stores/authStore';

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
  const [rsvpStatus, setRsvpStatus] = useState<RSVPStatus>('going');
  const [guestCount, setGuestCount] = useState(0);
  const [rsvpNotes, setRsvpNotes] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { checkPermission, user } = useAuthStore();
  const canManage = checkPermission('events.manage');

  useEffect(() => {
    if (eventId) {
      fetchEvent();
      if (canManage) {
        fetchRSVPs();
        fetchStats();
      }
    }
  }, [eventId]);

  const fetchEvent = async () => {
    if (!eventId) return;

    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEvent(eventId);
      setEvent(data);
    } catch (err: any) {
      console.error('Error fetching event:', err);
      setError(err.response?.data?.detail || 'Failed to load event');
    } finally {
      setLoading(false);
    }
  };

  const fetchRSVPs = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEventRSVPs(eventId);
      setRsvps(data);
    } catch (err: any) {
      console.error('Error fetching RSVPs:', err);
    }
  };

  const fetchStats = async () => {
    if (!eventId) return;

    try {
      const data = await eventService.getEventStats(eventId);
      setStats(data);
    } catch (err: any) {
      console.error('Error fetching stats:', err);
    }
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
    } catch (err: any) {
      console.error('Error submitting RSVP:', err);
      setSubmitError(err.response?.data?.detail || 'Failed to submit RSVP');
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
    } catch (err: any) {
      console.error('Error cancelling event:', err);
      setSubmitError(err.response?.data?.detail || 'Failed to cancel event');
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
    } catch (err: any) {
      console.error('Error checking in attendee:', err);
      alert(err.response?.data?.detail || 'Failed to check in attendee');
    }
  };

  const getEventTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      business_meeting: 'Business Meeting',
      public_education: 'Public Education',
      training: 'Training',
      social: 'Social',
      fundraiser: 'Fundraiser',
      ceremony: 'Ceremony',
      other: 'Other',
    };
    return labels[type] || type;
  };

  const getStatusLabel = (status: RSVPStatus): string => {
    const labels: Record<RSVPStatus, string> = {
      going: 'Going',
      not_going: 'Not Going',
      maybe: 'Maybe',
    };
    return labels[status];
  };

  const getStatusColor = (status: RSVPStatus): string => {
    const colors: Record<RSVPStatus, string> = {
      going: 'bg-green-100 text-green-800',
      not_going: 'bg-red-100 text-red-800',
      maybe: 'bg-yellow-100 text-yellow-800',
    };
    return colors[status];
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
      </div>
    );
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
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                {getEventTypeLabel(event.event_type)}
              </span>
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
              {canManage && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="inline-flex items-center px-4 py-2 border border-red-300 rounded-md shadow-sm text-sm font-medium text-red-700 bg-white hover:bg-red-50"
                >
                  Cancel Event
                </button>
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
                    {new Date(event.start_datetime).toLocaleString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="text-sm text-gray-600">
                    to {new Date(event.end_datetime).toLocaleString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
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

          {/* User's RSVP Status */}
          {event.user_rsvp_status && (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Your RSVP</h2>
              <div className="flex items-center space-x-4">
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(event.user_rsvp_status)}`}>
                  {getStatusLabel(event.user_rsvp_status)}
                </span>
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
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(rsvp.status)}`}>
                        {getStatusLabel(rsvp.status)}
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
                              {getStatusLabel(status as RSVPStatus)}
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
    </div>
  );
};
