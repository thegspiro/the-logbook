import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { eventService } from '../services/api';
import type { QRCheckInData } from '../types/event';
import { getErrorMessage } from '../utils/errorHandling';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime } from '../utils/dateFormatting';

/**
 * Event QR Code Page
 *
 * Displays a QR code for event check-in. The QR code is only valid
 * within a specific time window (1 hour before event start until event end).
 *
 * Any member can access this page to display the QR code at the event venue.
 */
const EventQRCodePage: React.FC = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const userTz = useTimezone();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrData, setQrData] = useState<QRCheckInData | null>(null);

  // Prefer the organization timezone from the API response so times display
  // correctly even when viewed on a kiosk/shared device whose system clock
  // or user profile may be set to a different timezone.
  const tz = qrData?.timezone || userTz;
  const hasDataRef = React.useRef(false);

  const fetchQRData = useCallback(
    async (isRefresh = false) => {
      if (!eventId) return;

      try {
        if (!isRefresh) setError(null);
        const data = await eventService.getQRCheckInData(eventId);
        setQrData(data);
        hasDataRef.current = true;
        setError(null);
      } catch (err: unknown) {
        // On refresh, keep existing data and only update error
        // On initial load, set the error
        if (!isRefresh || !hasDataRef.current) {
          setError(getErrorMessage(err, 'Failed to load QR code'));
        }
      } finally {
        setLoading(false);
      }
    },
    [eventId]
  );

  useEffect(() => {
    if (!eventId) return;
    void fetchQRData(false);

    // Refresh QR data every 30 seconds to update validity status
    const interval = setInterval(() => {
      void fetchQRData(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [eventId, fetchQRData]);

  const getCheckInUrl = () => {
    if (!eventId) return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}/events/${eventId}/check-in`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-theme-text-secondary">Loading QR code...</div>
      </div>
    );
  }

  if (error && !qrData) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-red-700 dark:text-red-400">{error}</p>
        </div>
        <Link
          to={eventId ? `/events/${eventId}` : '/events'}
          className="text-blue-700 hover:text-blue-500 dark:text-blue-400"
        >
          &larr; {eventId ? 'Back to Event' : 'Back to Events'}
        </Link>
      </div>
    );
  }

  if (!qrData) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-yellow-700 dark:text-yellow-300">No QR code data available</p>
        </div>
        <Link
          to={eventId ? `/events/${eventId}` : '/events'}
          className="text-blue-700 hover:text-blue-500 dark:text-blue-400"
        >
          &larr; {eventId ? 'Back to Event' : 'Back to Events'}
        </Link>
      </div>
    );
  }

  const checkInUrl = getCheckInUrl();

  return (
    <div className="mx-auto min-h-screen max-w-4xl p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to={`/events/${eventId}`}
          className="mb-4 inline-block text-blue-700 hover:text-blue-500 dark:text-blue-400"
        >
          &larr; Back to Event
        </Link>
        <h1 className="text-theme-text-primary text-3xl font-bold">Event Check-In QR Code</h1>
      </div>

      {/* Event Info */}
      <div className="bg-theme-surface mb-6 rounded-lg p-6 shadow-md backdrop-blur-xs">
        <h2 className="text-theme-text-primary mb-2 text-2xl font-semibold">{qrData.event_name}</h2>

        <div className="text-theme-text-secondary space-y-2">
          {qrData.event_type && (
            <p className="capitalize">
              <span className="font-medium">Type:</span> {qrData.event_type.replace('_', ' ')}
            </p>
          )}

          {qrData.location && (
            <p>
              <span className="font-medium">Location:</span> {qrData.location}
            </p>
          )}

          <p>
            <span className="font-medium">Scheduled:</span> {formatShortDateTime(qrData.start_datetime, tz)} -{' '}
            {formatShortDateTime(qrData.end_datetime, tz)}
          </p>

          <p>
            <span className="font-medium">Check-in Available:</span> {formatShortDateTime(qrData.check_in_start, tz)} -{' '}
            {formatShortDateTime(qrData.check_in_end, tz)}
          </p>
        </div>
      </div>

      {/* QR Code Section */}
      <div className="bg-theme-surface rounded-lg p-8 shadow-md backdrop-blur-xs">
        {qrData.is_valid ? (
          <div className="text-center">
            <div className="mb-6">
              <div className="inline-flex items-center rounded-full bg-green-100 px-4 py-2 text-green-800 dark:bg-green-500/20 dark:text-green-400">
                <svg className="mr-2 h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                Check-in is Active
              </div>
            </div>

            <h3 className="text-theme-text-primary mb-4 text-xl font-semibold">Scan to Check In</h3>

            <p className="text-theme-text-secondary mb-6">
              Members can scan this QR code to check themselves in to the event
            </p>

            {/* QR Code */}
            {checkInUrl && (
              <div className="mb-6 flex justify-center">
                <div className="qr-container">
                  <QRCodeSVG value={checkInUrl} size={300} level="H" includeMargin={true} />
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="alert-info text-left">
              <h4 className="text-theme-alert-info-title mb-2 font-semibold">Instructions:</h4>
              <ol className="text-theme-alert-info-text list-inside list-decimal space-y-1">
                <li>Display this QR code at the event venue</li>
                <li>Members scan the code with their phone camera</li>
                <li>Members will be prompted to log in if not already logged in</li>
                <li>After scanning, members will be checked in automatically</li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="mb-6">
              <div className="inline-flex items-center rounded-full bg-red-100 px-4 py-2 text-red-800 dark:bg-red-500/20 dark:text-red-400">
                <svg className="mr-2 h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                Check-in Not Available
              </div>
            </div>

            <h3 className="text-theme-text-primary mb-4 text-xl font-semibold">QR Code Check-In Window</h3>

            <div className="alert-warning mb-6">
              <p className="text-theme-alert-warning-text mb-2">
                Check-in is only available during the following time window:
              </p>
              <p className="text-theme-alert-warning-title font-semibold">
                {formatShortDateTime(qrData.check_in_start, tz)} - {formatShortDateTime(qrData.check_in_end, tz)}
              </p>
              {qrData.actual_end_time && (
                <p className="text-theme-alert-warning-text mt-2 text-sm">
                  Note: Event was ended early by event manager
                </p>
              )}
            </div>

            {/* Still show the QR code (greyed out) so the page is ready when the window opens */}
            {checkInUrl && (
              <div className="mb-4 flex justify-center">
                <div className="qr-container opacity-40">
                  <QRCodeSVG value={checkInUrl} size={250} level="H" includeMargin={true} />
                </div>
              </div>
            )}
            <p className="text-theme-text-muted text-sm">
              The QR code will become active when the check-in window opens. This page refreshes automatically.
            </p>
          </div>
        )}
      </div>

      {/* Print Button */}
      {qrData.is_valid && (
        <div className="mt-6 text-center">
          <button onClick={() => window.print()} className="btn-info px-6 transition">
            Print QR Code
          </button>
        </div>
      )}
    </div>
  );
};

export default EventQRCodePage;
