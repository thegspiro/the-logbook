/**
 * Room Check-In Landing Page
 *
 * Where a room's NFC tag sends a member's phone. The tag names the room, not
 * an event, so one sticker by the door serves every event held there — the
 * room counterpart of the apparatus-keyed shift tag.
 *
 * The page answers "what is checking in here right now?" and hands the member
 * to that event's own self check-in page, which records the attendance and
 * enforces every rule about it. This page decides nothing about eligibility.
 *
 * - One event open: go straight to it.
 * - Several open: ask. Guessing would put attendance on the wrong event, and a
 *   member standing in the room knows which one they came for.
 * - None open: say so, rather than leaving the member on a blank screen.
 *
 * URL: /locations/:locationId/check-in
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CalendarClock, ChevronRight, DoorOpen, Loader2, MapPinOff, RefreshCw } from 'lucide-react';
import { locationsService } from '../services/api';
import type { LocationCheckInInfo } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatTime } from '../utils/dateFormatting';
import { getErrorMessage, toAppError } from '../utils/errorHandling';

const RoomCheckInPage: React.FC = () => {
  const { locationId = '' } = useParams<{ locationId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();
  const [info, setInfo] = useState<LocationCheckInInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) {
      setError('This link does not name a room.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await locationsService.getCurrentCheckIns(locationId);
      const only = data.current_events.length === 1 ? data.current_events[0] : undefined;
      if (only) {
        // replace: the back button should return to wherever the member was
        // before tapping, not bounce them through this redirect again.
        void navigate(`/events/${only.event_id}/check-in`, { replace: true });
        return;
      }
      setInfo(data);
    } catch (err: unknown) {
      setError(
        toAppError(err).status === 404
          ? 'This tag points at a room that no longer exists. Let an officer know so it can be rewritten.'
          : getErrorMessage(err, 'Could not load this room. Check your connection and try again.')
      );
    } finally {
      setLoading(false);
    }
  }, [locationId, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
        <span className="sr-only">Finding what is checking in here…</span>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <MapPinOff className="text-theme-text-muted mx-auto mb-3 h-12 w-12" aria-hidden="true" />
        <h1 className="text-theme-text-primary mb-1 text-xl font-bold">Room unavailable</h1>
        <p className="text-theme-text-secondary mb-6 text-sm">{error ?? 'Could not load this room.'}</p>
        <Link to="/events" className="btn-primary inline-flex items-center justify-center gap-2">
          Go to Events
        </Link>
      </div>
    );
  }

  if (info.current_events.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 text-center">
        <CalendarClock className="mx-auto mb-3 h-12 w-12 text-amber-500" aria-hidden="true" />
        <h1 className="text-theme-text-primary mb-1 text-xl font-bold">Nothing to check in to</h1>
        <p className="text-theme-text-secondary mb-6 text-sm">
          No event in <strong>{info.location_name}</strong> is open for check-in right now. Try again closer to the
          start time.
        </p>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => void load()}
            className="btn-secondary inline-flex items-center justify-center gap-2"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Check again
          </button>
          <Link to="/events" className="btn-primary inline-flex items-center justify-center gap-2">
            Go to Events
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="mb-6 text-center">
        <DoorOpen className="text-theme-text-muted mx-auto mb-3 h-12 w-12" aria-hidden="true" />
        <h1 className="text-theme-text-primary mb-1 text-xl font-bold">Which event are you here for?</h1>
        <p className="text-theme-text-secondary text-sm">
          More than one event in <strong>{info.location_name}</strong> is open for check-in.
        </p>
      </div>
      <ul className="space-y-3">
        {info.current_events.map((event) => (
          <li key={event.event_id}>
            <Link
              to={`/events/${event.event_id}/check-in`}
              className="card hover:bg-theme-surface-hover flex min-h-11 items-center justify-between gap-3 transition-colors"
            >
              <span className="min-w-0">
                <span className="text-theme-text-primary block font-semibold break-words">{event.event_name}</span>
                <span className="text-theme-text-secondary block text-sm">
                  {formatTime(event.start_datetime, tz)} – {formatTime(event.end_datetime, tz)}
                </span>
              </span>
              <ChevronRight className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default RoomCheckInPage;
