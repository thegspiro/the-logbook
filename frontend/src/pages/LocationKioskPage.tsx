import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { MapPin, Wifi, WifiOff } from 'lucide-react';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateCustom } from '../utils/dateFormatting';

/**
 * Location Kiosk Page (Public — No Authentication Required)
 *
 * Designed to run on a tablet left in a room. Shows the current event's
 * QR code for check-in and automatically cycles to the next event.
 *
 * - Polls the public display API every 30 seconds
 * - No login required — uses a non-guessable display code in the URL
 * - Full-screen optimized: no sidebar, no navigation
 * - Shows idle screen when no events are active
 */

interface KioskEvent {
  event_id: string;
  event_name: string;
  event_type?: string;
  start_datetime: string;
  end_datetime: string;
  actual_end_time?: string;
  check_in_start: string;
  check_in_end: string;
  is_valid: boolean;
  location?: string;
  location_id?: string;
  location_name?: string;
  require_checkout?: boolean;
}

interface DisplayData {
  location_id: string;
  location_name: string;
  current_events: KioskEvent[];
  has_overlap: boolean;
  /** Department IANA timezone, supplied because this page is unauthenticated. */
  timezone?: string | undefined;
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

const LocationKioskPage: React.FC = () => {
  // This page runs with no session, so useTimezone() can only fall back to the
  // tablet's own zone — commonly UTC on a wall-mounted device. Prefer the
  // department timezone the API reports, per the project rule that times are
  // shown in the organization's configured timezone.
  const fallbackTz = useTimezone();
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<DisplayData | null>(null);
  const tz = data?.timezone || fallbackTz;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  const fetchDisplay = useCallback(
    async (isRefresh = false) => {
      if (!code) return;
      try {
        const response = await fetch(`/api/public/v1/display/${code}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError('Display not found. Check the URL.');
          } else {
            throw new Error(`HTTP ${response.status}`);
          }
          return;
        }
        const result = (await response.json()) as DisplayData;
        setData(result);
        setError(null);
        setConnected(true);
      } catch {
        setConnected(false);
        if (!isRefresh) {
          setError('Unable to connect. Retrying...');
        }
      } finally {
        setLoading(false);
      }
    },
    [code]
  );

  // Initial fetch + polling
  useEffect(() => {
    void fetchDisplay(false);
    const interval = setInterval(() => {
      void fetchDisplay(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchDisplay]);

  // Clock update every minute
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Cycle through overlapping events every 10 seconds
  useEffect(() => {
    if (!data || data.current_events.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentEventIndex((prev) => (prev + 1) % data.current_events.length);
    }, 10_000);
    return () => clearInterval(interval);
  }, [data]);

  const getCheckInUrl = (eventId: string) => {
    return `${window.location.origin}/events/${eventId}/check-in`;
  };

  const formatTime = (isoString: string) => {
    return formatDateCustom(isoString, { hour: 'numeric', minute: '2-digit' }, tz);
  };

  const formatDate = (isoString: string) => {
    return formatDateCustom(isoString, { weekday: 'short', month: 'short', day: 'numeric' }, tz);
  };

  // Loading state
  if (loading) {
    return (
      <div className="from-theme-nav-bg via-theme-surface to-theme-nav-bg flex min-h-screen items-center justify-center bg-linear-to-br">
        <div className="text-center">
          <div className="mb-6 inline-block h-16 w-16 animate-spin rounded-full border-t-4 border-b-4 border-red-500" />
          <p className="text-xl text-white">Loading display...</p>
        </div>
      </div>
    );
  }

  // Error state (permanent — bad code)
  if (error && !data) {
    return (
      <div className="from-theme-nav-bg via-theme-surface to-theme-nav-bg flex min-h-screen items-center justify-center bg-linear-to-br p-8">
        <div className="max-w-md text-center">
          <MapPin className="text-theme-text-muted mx-auto mb-6 h-16 w-16" />
          <h1 className="mb-4 text-2xl font-bold text-white">Display Unavailable</h1>
          <p className="text-theme-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const events = data.current_events;
  const hasEvents = events.length > 0;
  const currentEvent = hasEvents ? events[currentEventIndex % events.length] : null;

  return (
    <div className="from-theme-nav-bg via-theme-surface to-theme-nav-bg flex min-h-screen flex-col bg-linear-to-br">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-black/30 px-8 py-4">
        <div className="flex items-center gap-3">
          <MapPin className="h-6 w-6 text-red-500" />
          <h1 className="text-2xl font-bold text-white">{data.location_name}</h1>
        </div>
        <div className="flex items-center gap-4">
          {connected ? (
            <Wifi className="h-5 w-5 text-green-700 dark:text-green-400" />
          ) : (
            <WifiOff className="h-5 w-5 animate-pulse text-red-700 dark:text-red-400" />
          )}
          <span className="text-theme-text-primary font-mono text-lg">
            {formatDateCustom(currentTime, { hour: 'numeric', minute: '2-digit' }, tz)}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 items-center justify-center p-8">
        {hasEvents && currentEvent ? (
          <div className="w-full max-w-2xl text-center">
            {/* Event info */}
            <div className="mb-8">
              {events.length > 1 && (
                <div className="mb-4 flex justify-center gap-2">
                  {events.map((_, idx) => (
                    <div
                      key={idx}
                      className={`h-3 w-3 rounded-full transition-all ${
                        idx === currentEventIndex % events.length ? 'scale-110 bg-red-500' : 'bg-theme-surface-hover'
                      }`}
                    />
                  ))}
                </div>
              )}
              <div className="mb-4 inline-flex items-center rounded-full border border-green-500/40 bg-green-500/20 px-4 py-2 text-sm font-medium text-green-700 dark:text-green-400">
                <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-green-400" />
                Check-In Active
              </div>
              <h2 className="mb-3 text-4xl font-bold text-white">{currentEvent.event_name}</h2>
              {currentEvent.event_type && (
                <p className="text-theme-text-secondary mb-2 text-lg capitalize">
                  {currentEvent.event_type.replace('_', ' ')}
                </p>
              )}
              <p className="text-theme-text-primary text-xl">
                {formatDate(currentEvent.start_datetime)} &middot; {formatTime(currentEvent.start_datetime)} &ndash;{' '}
                {formatTime(currentEvent.end_datetime)}
              </p>
            </div>

            {/* QR Code */}
            <div className="mb-8 flex justify-center">
              <div className="rounded-2xl bg-white p-8 shadow-2xl shadow-black/50">
                <QRCodeSVG value={getCheckInUrl(currentEvent.event_id)} size={280} level="H" includeMargin={true} />
              </div>
            </div>

            {/* Instructions */}
            <p className="text-theme-text-primary text-xl font-medium">Scan with your phone to check in</p>
            <p className="text-theme-text-muted mt-2 text-sm">You will be prompted to log in if needed</p>
          </div>
        ) : (
          /* Idle state — no active events */
          <div className="max-w-lg text-center">
            <div className="bg-theme-surface mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full">
              <MapPin className="text-theme-text-muted h-12 w-12" />
            </div>
            <h2 className="text-theme-text-primary mb-4 text-3xl font-bold">No Active Events</h2>
            <p className="text-theme-text-secondary text-lg">
              QR codes will appear here automatically when an event is scheduled in this room.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-black/20 px-8 py-3 text-center">
        <p className="text-theme-text-muted text-xs">Display refreshes automatically &middot; {data.location_name}</p>
      </div>
    </div>
  );
};

export default LocationKioskPage;
