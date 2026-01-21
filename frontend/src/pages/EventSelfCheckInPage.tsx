import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { eventService } from '../services/api';
import type { QRCheckInData, RSVP } from '../types/event';

/**
 * Event Self Check-In Page
 *
 * Landing page when a member scans the QR code. This page:
 * 1. Shows event details
 * 2. Allows the authenticated user to check themselves in
 * 3. Displays success confirmation or error messages
 * 4. Validates the time window before allowing check-in
 */
const EventSelfCheckInPage: React.FC = () => {
  const { id: eventId } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrData, setQrData] = useState<QRCheckInData | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInData, setCheckInData] = useState<RSVP | null>(null);

  useEffect(() => {
    if (!eventId) return;
    fetchEventData();
  }, [eventId]);

  const fetchEventData = async () => {
    if (!eventId) return;

    try {
      setError(null);
      const data = await eventService.getQRCheckInData(eventId);
      setQrData(data);
    } catch (err: any) {
      console.error('Error fetching event data:', err);
      setError(err.response?.data?.detail || 'Failed to load event information');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async () => {
    if (!eventId) return;

    try {
      setCheckingIn(true);
      setError(null);
      const rsvp = await eventService.selfCheckIn(eventId);
      setCheckInData(rsvp);
      setCheckedIn(true);
    } catch (err: any) {
      console.error('Error checking in:', err);
      setError(err.response?.data?.detail || 'Failed to check in');
    } finally {
      setCheckingIn(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-600">Loading event...</div>
      </div>
    );
  }

  if (error && !qrData) {
    return (
      <div className="max-w-2xl mx-auto p-6 min-h-screen bg-gray-50">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Unable to Load Event</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <Link
              to="/events"
              className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              View All Events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (checkedIn && checkInData) {
    return (
      <div className="max-w-2xl mx-auto p-6 min-h-screen bg-gray-50">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center">
            {/* Success Icon */}
            <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
              <svg className="w-12 h-12 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-3xl font-bold text-gray-900 mb-2">Successfully Checked In!</h2>
            <p className="text-xl text-gray-600 mb-8">You've been checked in to:</p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 text-left mb-8">
              <h3 className="text-2xl font-semibold text-blue-900 mb-4">{qrData?.event_name}</h3>

              <div className="space-y-2 text-blue-800">
                {qrData?.location && (
                  <p>
                    <span className="font-medium">Location:</span> {qrData.location}
                  </p>
                )}

                {qrData?.start_datetime && (
                  <p>
                    <span className="font-medium">Event Time:</span>{' '}
                    {formatTime(qrData.start_datetime)} - {formatTime(qrData.end_datetime)}
                  </p>
                )}

                {checkInData.checked_in_at && (
                  <p>
                    <span className="font-medium">Checked In At:</span>{' '}
                    {formatTime(checkInData.checked_in_at)}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <Link
                to={`/events/${eventId}`}
                className="block w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
              >
                View Event Details
              </Link>
              <Link
                to="/events"
                className="block w-full px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-medium"
              >
                View All Events
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 min-h-screen bg-gray-50">
      <div className="bg-white rounded-lg shadow-md p-8">
        {/* Event Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">Event Check-In</h2>
        </div>

        {/* Event Details */}
        <div className="bg-gray-50 rounded-lg p-6 mb-8">
          <h3 className="text-2xl font-semibold text-gray-900 mb-4">{qrData?.event_name}</h3>

          <div className="space-y-3 text-gray-700">
            {qrData?.event_type && (
              <p className="flex items-start">
                <span className="font-medium w-24">Type:</span>
                <span className="flex-1 capitalize">{qrData.event_type.replace('_', ' ')}</span>
              </p>
            )}

            {qrData?.location && (
              <p className="flex items-start">
                <span className="font-medium w-24">Location:</span>
                <span className="flex-1">{qrData.location}</span>
              </p>
            )}

            {qrData?.start_datetime && (
              <p className="flex items-start">
                <span className="font-medium w-24">When:</span>
                <span className="flex-1">{formatDateTime(qrData.start_datetime)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Check-In Status */}
        {qrData?.is_valid ? (
          <div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <svg className="w-5 h-5 text-red-600 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-red-800">{error}</p>
                </div>
              </div>
            )}

            <button
              onClick={handleCheckIn}
              disabled={checkingIn}
              className="w-full px-8 py-4 bg-green-600 text-white text-lg font-semibold rounded-lg hover:bg-green-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {checkingIn ? 'Checking In...' : 'Check In to This Event'}
            </button>

            <p className="text-sm text-gray-500 text-center mt-4">
              By checking in, you confirm your attendance at this event
            </p>
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <div className="flex items-start">
              <svg className="w-6 h-6 text-yellow-600 mr-3 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h4 className="font-semibold text-yellow-900 mb-2">Check-In Not Available</h4>
                <p className="text-yellow-800 mb-2">
                  Check-in is only available during the following time window:
                </p>
                <p className="font-medium text-yellow-900">
                  {qrData && formatDateTime(qrData.check_in_start)} to {qrData && formatTime(qrData.check_in_end)}
                </p>
                {qrData?.actual_end_time && (
                  <p className="text-sm text-yellow-700 mt-2">
                    Note: This event was ended early by the event manager
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Footer Links */}
        <div className="mt-8 text-center">
          <Link
            to={`/events/${eventId}`}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            View Event Details
          </Link>
          <span className="text-gray-400 mx-3">|</span>
          <Link
            to="/events"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            View All Events
          </Link>
        </div>
      </div>
    </div>
  );
};

export default EventSelfCheckInPage;
