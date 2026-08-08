import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router';
import { eventService } from '../services/api';
import type { QRCheckInData, RSVP } from '../types/event';
import { toAppError, getPhaseGateWarning } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTime, formatTime } from '../utils/dateFormatting';
import { EventType as EventTypeEnum } from '../constants/enums';

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
  const userTz = useTimezone();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrData, setQrData] = useState<QRCheckInData | null>(null);

  // Prefer the organization timezone from the API so times display correctly
  const tz = qrData?.timezone || userTz;
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInData, setCheckInData] = useState<RSVP | null>(null);
  const [showCheckOutPrompt, setShowCheckOutPrompt] = useState(false);
  // Non-blocking notice shown after an early check-in (window not yet open).
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;
    void fetchEventData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const fetchEventData = async () => {
    if (!eventId) return;

    try {
      setError(null);
      const data = await eventService.getQRCheckInData(eventId);
      setQrData(data);
    } catch (err: unknown) {
      const appError = toAppError(err);
      setError(appError.status ? appError.message : 'Failed to load event information');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async () => {
    if (!eventId) return;

    try {
      setCheckingIn(true);
      setError(null);

      let rsvp: RSVP;
      try {
        rsvp = await eventService.selfCheckIn(eventId);
      } catch (err: unknown) {
        // Soft pipeline phase gate — confirm, then retry with override.
        const warning = getPhaseGateWarning(err);
        if (!warning) throw err;
        if (!window.confirm(`${warning}\n\nCheck in anyway?`)) {
          setCheckingIn(false);
          return;
        }
        rsvp = await eventService.selfCheckIn(eventId, false, true);
      }
      setCheckInData(rsvp);
      setNotice(rsvp.notice ?? null);
      setCheckedIn(true);
      setShowCheckOutPrompt(false);
    } catch (err: unknown) {
      const appError = toAppError(err);
      setError(appError.status ? appError.message : 'Failed to check in');
    } finally {
      setCheckingIn(false);
    }
  };

  const handleCheckOut = async () => {
    if (!eventId) return;

    try {
      setCheckingIn(true);
      setError(null);

      const rsvp = await eventService.selfCheckIn(eventId, true);
      setCheckInData(rsvp);
      setCheckedIn(true);
      setShowCheckOutPrompt(false);
    } catch (err: unknown) {
      const appError = toAppError(err);
      setError(appError.status ? appError.message : 'Failed to check out');
    } finally {
      setCheckingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-theme-surface-secondary flex min-h-screen items-center justify-center">
        <div className="text-theme-text-secondary">Loading event...</div>
      </div>
    );
  }

  if (error && !qrData) {
    return (
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 shadow-md">
          <div className="mb-6 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/20">
              <svg
                className="h-8 w-8 text-red-600 dark:text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-theme-text-primary mb-2 text-2xl font-bold">Unable to Load Event</h2>
            <p className="text-theme-text-secondary mb-6">{error}</p>
            <Link to="/events" className="btn-info inline-block px-6 transition">
              View All Events
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Show check-out prompt if already checked in
  if (showCheckOutPrompt && checkInData && !checkedIn) {
    return (
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 shadow-md">
          <div className="text-center">
            {/* Info Icon */}
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/20">
              <svg
                className="h-12 w-12 text-blue-600 dark:text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>

            <h2 className="text-theme-text-primary mb-2 text-3xl font-bold">Already Checked In</h2>
            <p className="text-theme-text-secondary mb-8 text-xl">You're already checked in to this event</p>

            <div className="alert-info mb-8 p-6 text-left">
              <h3 className="text-theme-alert-info-title mb-4 text-2xl font-semibold">{qrData?.event_name}</h3>

              <div className="text-theme-alert-info-text space-y-2">
                <p>
                  <span className="font-medium">Checked In At:</span>{' '}
                  {checkInData.checked_in_at && formatTime(checkInData.checked_in_at, tz)}
                </p>

                {qrData?.location && (
                  <p>
                    <span className="font-medium">Location:</span> {qrData.location}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
                <p className="text-red-800 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => {
                  void handleCheckOut();
                }}
                disabled={checkingIn}
                className="btn-primary w-full px-8 py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkingIn ? 'Checking Out...' : 'Check Out of This Event'}
              </button>

              <p className="text-theme-text-muted text-center text-sm">
                By checking out, you confirm you are leaving this event
              </p>

              <Link
                to={`/events/${eventId}`}
                className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover block w-full rounded-lg px-6 py-3 text-center font-medium transition"
              >
                View Event Details
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (checkedIn && checkInData) {
    const isCheckOut = checkInData.checked_out_at !== null && checkInData.checked_out_at !== undefined;

    return (
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 shadow-md">
          <div className="text-center">
            {/* Success Icon */}
            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/20">
              <svg
                className="h-12 w-12 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h2 className="text-theme-text-primary mb-2 text-3xl font-bold">
              {isCheckOut ? 'Successfully Checked Out!' : 'Successfully Checked In!'}
            </h2>
            <p className="text-theme-text-secondary mb-8 text-xl">
              {isCheckOut ? "You've been checked out of:" : "You've been checked in to:"}
            </p>

            {notice && !isCheckOut && (
              <div className="alert-warning mb-6 p-4 text-left" role="status">
                <p className="text-sm font-medium">{notice}</p>
              </div>
            )}

            <div className="alert-info mb-8 p-6 text-left">
              <h3 className="text-theme-alert-info-title mb-4 text-2xl font-semibold">{qrData?.event_name}</h3>

              <div className="text-theme-alert-info-text space-y-2">
                {qrData?.event_type === EventTypeEnum.TRAINING && (
                  <div className="mb-3 flex items-center">
                    <svg className="mr-2 h-5 w-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                    <span className="font-semibold text-purple-900 dark:text-purple-300">Training Session</span>
                  </div>
                )}

                {qrData?.location && (
                  <p>
                    <span className="font-medium">Location:</span> {qrData.location}
                  </p>
                )}

                {qrData?.start_datetime && (
                  <p>
                    <span className="font-medium">Event Time:</span> {formatTime(qrData.start_datetime, tz)} -{' '}
                    {formatTime(qrData.end_datetime, tz)}
                  </p>
                )}

                {checkInData.checked_in_at && (
                  <p>
                    <span className="font-medium">Checked In At:</span> {formatTime(checkInData.checked_in_at, tz)}
                  </p>
                )}

                {isCheckOut && checkInData.checked_out_at && (
                  <p>
                    <span className="font-medium">Checked Out At:</span> {formatTime(checkInData.checked_out_at, tz)}
                  </p>
                )}

                {isCheckOut && checkInData.attendance_duration_minutes && (
                  <p>
                    <span className="font-medium">Duration:</span>{' '}
                    {Math.floor(checkInData.attendance_duration_minutes / 60)}h{' '}
                    {checkInData.attendance_duration_minutes % 60}m
                  </p>
                )}
              </div>
            </div>

            {qrData?.event_type === EventTypeEnum.TRAINING && (
              <div className="mb-8 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-500/30 dark:bg-green-500/10">
                <div className="flex items-start">
                  <svg
                    className="mt-0.5 mr-2 h-5 w-5 shrink-0 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="text-left">
                    <p className="mb-1 text-sm font-medium text-green-900 dark:text-green-300">
                      Training Record Created
                    </p>
                    <p className="text-sm text-green-800 dark:text-green-400">
                      Your attendance has been logged and a training record will be created for this session.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <Link to={`/events/${eventId}`} className="btn-info block w-full px-6 py-3 font-medium transition">
                View Event Details
              </Link>
              <Link
                to="/events"
                className="bg-theme-surface-secondary text-theme-text-secondary hover:bg-theme-surface-hover block w-full rounded-lg px-6 py-3 font-medium transition"
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
    <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-2xl p-6">
      <div className="bg-theme-surface rounded-lg p-8 shadow-md">
        {/* Event Header */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-500/20">
            <svg
              className="h-8 w-8 text-blue-600 dark:text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-theme-text-primary mb-2 text-3xl font-bold">Event Check-In</h2>
        </div>

        {/* Event Details */}
        <div className="bg-theme-surface-secondary mb-8 rounded-lg p-6">
          <h3 className="text-theme-text-primary mb-4 text-2xl font-semibold">{qrData?.event_name}</h3>

          <div className="text-theme-text-secondary space-y-3">
            {qrData?.event_type && (
              <p className="flex items-start">
                <span className="w-24 font-medium">Type:</span>
                <span className="flex-1 capitalize">{qrData.event_type.replace('_', ' ')}</span>
              </p>
            )}

            {qrData?.location && (
              <p className="flex items-start">
                <span className="w-24 font-medium">Location:</span>
                <span className="flex-1">{qrData.location}</span>
              </p>
            )}

            {qrData?.start_datetime && (
              <p className="flex items-start">
                <span className="w-24 font-medium">When:</span>
                <span className="flex-1">{formatDateTime(qrData.start_datetime, tz)}</span>
              </p>
            )}
          </div>
        </div>

        {/* Check-In Status */}
        {qrData?.is_valid ? (
          <div>
            {error && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
                <div className="flex items-start">
                  <svg
                    className="mt-0.5 mr-2 h-5 w-5 shrink-0 text-red-600 dark:text-red-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <p className="text-red-800 dark:text-red-400">{error}</p>
                </div>
              </div>
            )}

            <button
              onClick={() => {
                void handleCheckIn();
              }}
              disabled={checkingIn}
              className="btn-success w-full px-8 py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checkingIn ? 'Checking In...' : 'Check In to This Event'}
            </button>

            <p className="text-theme-text-muted mt-4 text-center text-sm">
              By checking in, you confirm your attendance at this event
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 dark:border-yellow-500/30 dark:bg-yellow-500/10">
            <div className="flex items-start">
              <svg className="mt-0.5 mr-3 h-6 w-6 shrink-0 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <h4 className="mb-2 font-semibold text-yellow-900 dark:text-yellow-300">Check-in Not Available</h4>
                <p className="mb-2 text-yellow-800 dark:text-yellow-400">
                  Check-in is only available during the following time window:
                </p>
                <p className="font-medium text-yellow-900 dark:text-yellow-300">
                  {qrData && formatDateTime(qrData.check_in_start, tz)} to{' '}
                  {qrData && formatTime(qrData.check_in_end, tz)}
                </p>
                {qrData?.actual_end_time && (
                  <p className="mt-2 text-sm text-yellow-700 dark:text-yellow-400">
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
            className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            View Event Details
          </Link>
          <span className="text-theme-text-muted mx-3">|</span>
          <Link
            to="/events"
            className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            View All Events
          </Link>
        </div>
      </div>
    </div>
  );
};

export default EventSelfCheckInPage;
