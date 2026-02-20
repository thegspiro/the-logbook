import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { MapPin, Wifi, WifiOff } from 'lucide-react';

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
}

const POLL_INTERVAL_MS = 30_000; // 30 seconds

const LocationKioskPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const [data, setData] = useState<DisplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const [currentEventIndex, setCurrentEventIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());

  const fetchDisplay = useCallback(async (isRefresh = false) => {
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
      const result = await response.json();
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
  }, [code]);

  // Initial fetch + polling
  useEffect(() => {
    fetchDisplay(false);
    const interval = setInterval(() => fetchDisplay(true), POLL_INTERVAL_MS);
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
      setCurrentEventIndex(prev => (prev + 1) % data.current_events.length);
    }, 10_000);
    return () => clearInterval(interval);
  }, [data]);

  const getCheckInUrl = (eventId: string) => {
    return `${window.location.origin}/events/${eventId}/check-in`;
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-red-500 mb-6" />
          <p className="text-xl text-white">Loading display...</p>
        </div>
      </div>
    );
  }

  // Error state (permanent — bad code)
  if (error && !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <MapPin className="w-16 h-16 text-slate-500 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-white mb-4">Display Unavailable</h1>
          <p className="text-slate-200">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const events = data.current_events;
  const hasEvents = events.length > 0;
  const currentEvent = hasEvents ? events[currentEventIndex % events.length] : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-8 py-4 bg-black/30">
        <div className="flex items-center gap-3">
          <MapPin className="w-6 h-6 text-red-500" />
          <h1 className="text-2xl font-bold text-white">{data.location_name}</h1>
        </div>
        <div className="flex items-center gap-4">
          {connected ? (
            <Wifi className="w-5 h-5 text-green-400" />
          ) : (
            <WifiOff className="w-5 h-5 text-red-400 animate-pulse" />
          )}
          <span className="text-lg text-slate-100 font-mono">
            {currentTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-8">
        {hasEvents && currentEvent ? (
          <div className="text-center max-w-2xl w-full">
            {/* Event info */}
            <div className="mb-8">
              {events.length > 1 && (
                <div className="flex justify-center gap-2 mb-4">
                  {events.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-3 h-3 rounded-full transition-all ${
                        idx === currentEventIndex % events.length
                          ? 'bg-red-500 scale-110'
                          : 'bg-slate-600'
                      }`}
                    />
                  ))}
                </div>
              )}
              <div className="inline-flex items-center px-4 py-2 bg-green-500/20 border border-green-500/40 text-green-400 rounded-full text-sm font-medium mb-4">
                <span className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse" />
                Check-In Active
              </div>
              <h2 className="text-4xl font-bold text-white mb-3">{currentEvent.event_name}</h2>
              {currentEvent.event_type && (
                <p className="text-lg text-slate-200 capitalize mb-2">
                  {currentEvent.event_type.replace('_', ' ')}
                </p>
              )}
              <p className="text-xl text-slate-100">
                {formatDate(currentEvent.start_datetime)} &middot;{' '}
                {formatTime(currentEvent.start_datetime)} &ndash; {formatTime(currentEvent.end_datetime)}
              </p>
            </div>

            {/* QR Code */}
            <div className="flex justify-center mb-8">
              <div className="bg-white p-8 rounded-2xl shadow-2xl shadow-black/50">
                <QRCodeSVG
                  value={getCheckInUrl(currentEvent.event_id)}
                  size={280}
                  level="H"
                  includeMargin={true}
                />
              </div>
            </div>

            {/* Instructions */}
            <p className="text-xl text-slate-100 font-medium">
              Scan with your phone to check in
            </p>
            <p className="text-sm text-slate-400 mt-2">
              You will be prompted to log in if needed
            </p>
          </div>
        ) : (
          /* Idle state — no active events */
          <div className="text-center max-w-lg">
            <div className="w-24 h-24 mx-auto mb-8 rounded-full bg-slate-800 flex items-center justify-center">
              <MapPin className="w-12 h-12 text-slate-600" />
            </div>
            <h2 className="text-3xl font-bold text-slate-200 mb-4">No Active Events</h2>
            <p className="text-lg text-slate-300">
              QR codes will appear here automatically when an event is scheduled in this room.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-8 py-3 bg-black/20 text-center">
        <p className="text-xs text-slate-500">
          Display refreshes automatically &middot; {data.location_name}
        </p>
      </div>
    </div>
  );
};

export default LocationKioskPage;
