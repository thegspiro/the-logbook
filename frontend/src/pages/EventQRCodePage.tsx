import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { eventService } from '../services/api';
import type { QRCheckInData } from '../types/event';
import { getErrorMessage } from '../utils/errorHandling';

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
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrData, setQrData] = useState<QRCheckInData | null>(null);

  useEffect(() => {
    if (!eventId) return;
    fetchQRData();

    // Refresh QR data every 30 seconds to update validity status
    const interval = setInterval(fetchQRData, 30000);
    return () => clearInterval(interval);
  }, [eventId]);

  const fetchQRData = async () => {
    if (!eventId) return;

    try {
      setError(null);
      const data = await eventService.getQRCheckInData(eventId);
      setQrData(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load QR code'));
    } finally {
      setLoading(false);
    }
  };

  const getCheckInUrl = () => {
    if (!eventId) return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}/events/${eventId}/check-in`;
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-300">Loading QR code...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
          <p className="text-red-300">{error}</p>
        </div>
        <button
          onClick={() => navigate(`/events/${eventId}`)}
          className="text-blue-600 hover:text-blue-300"
        >
          ← Back to Event
        </button>
      </div>
    );
  }

  if (!qrData) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
          <p className="text-yellow-300">No QR code data available</p>
        </div>
        <button
          onClick={() => navigate(`/events/${eventId}`)}
          className="text-blue-600 hover:text-blue-300"
        >
          ← Back to Event
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen max-w-4xl mx-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <Link
          to={`/events/${eventId}`}
          className="text-blue-600 hover:text-blue-300 mb-4 inline-block"
        >
          ← Back to Event
        </Link>
        <h1 className="text-3xl font-bold text-white">Event Check-In QR Code</h1>
      </div>

      {/* Event Info */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-2xl font-semibold text-white mb-2">{qrData.event_name}</h2>

        <div className="space-y-2 text-slate-200">
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
            <span className="font-medium">Scheduled:</span>{' '}
            {formatDateTime(qrData.start_datetime)} - {formatDateTime(qrData.end_datetime)}
          </p>

          <p>
            <span className="font-medium">Check-in Available:</span>{' '}
            {formatDateTime(qrData.check_in_start)} - {formatDateTime(qrData.check_in_end)}
          </p>
        </div>
      </div>

      {/* QR Code Section */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg shadow-md p-8">
        {qrData.is_valid ? (
          <div className="text-center">
            <div className="mb-6">
              <div className="inline-flex items-center px-4 py-2 bg-green-100 text-green-800 rounded-full">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Check-in is Active
              </div>
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">
              Scan to Check In
            </h3>

            <p className="text-slate-300 mb-6">
              Members can scan this QR code to check themselves in to the event
            </p>

            {/* QR Code */}
            <div className="flex justify-center mb-6">
              <div className="bg-white p-8 rounded-lg border-4 border-white/20">
                <QRCodeSVG
                  value={getCheckInUrl()}
                  size={300}
                  level="H"
                  includeMargin={true}
                />
              </div>
            </div>

            {/* Instructions */}
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 text-left">
              <h4 className="font-semibold text-blue-300 mb-2">Instructions:</h4>
              <ol className="list-decimal list-inside space-y-1 text-blue-300">
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
              <div className="inline-flex items-center px-4 py-2 bg-red-100 text-red-800 rounded-full">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                Check-in Not Available
              </div>
            </div>

            <h3 className="text-xl font-semibold text-white mb-4">
              QR Code Check-In Window
            </h3>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <p className="text-yellow-300 mb-2">
                Check-in is only available during the following time window:
              </p>
              <p className="font-semibold text-yellow-300">
                {formatDateTime(qrData.check_in_start)} - {formatDateTime(qrData.check_in_end)}
              </p>
              {qrData.actual_end_time && (
                <p className="text-sm text-yellow-300 mt-2">
                  Note: Event was ended early by event manager
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Print Button */}
      {qrData.is_valid && (
        <div className="mt-6 text-center">
          <button
            onClick={() => window.print()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
          >
            Print QR Code
          </button>
        </div>
      )}
    </div>
  );
};

export default EventQRCodePage;
