/**
 * Record one member as present after the event's check-in has closed.
 *
 * Workflow review W80-8 (owner decision 2026-11-08): once the window closed,
 * an officer's only ways to put a named member on a past drill were adding the
 * whole roster as Going and trimming it, or waiting for the member's own "I
 * was there" request. This adds the member and records when they were there,
 * the same two writes the Edit Times dialog makes for someone never checked in
 * (add as Going, then the time correction), so the result appears on the
 * attendance list and the approval page like any other correction.
 */
import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { eventService } from '../../services/api';
import { formatForDateTimeInput, formatTime, localToUTC } from '../../utils/dateFormatting';
import { getErrorDetail } from '../../utils/errorHandling';
import { formatMemberName } from '../../utils/memberName';

interface LateAttendeeMember {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name?: string | null | undefined;
}

interface EventLateAttendeeFormProps {
  eventId: string;
  members: LateAttendeeMember[];
  /** The event's span (actual, else scheduled), UTC ISO: where the times start. */
  eventStart: string;
  eventEnd: string;
  timezone: string;
  /** After a member is recorded, so the page can reload its attendance. */
  onRecorded: () => void;
}

const EventLateAttendeeForm: React.FC<EventLateAttendeeFormProps> = ({
  eventId,
  members,
  eventStart,
  eventEnd,
  timezone,
  onRecorded,
}) => {
  const [userId, setUserId] = useState('');
  const [arrived, setArrived] = useState(() => formatForDateTimeInput(eventStart, timezone));
  const [left, setLeft] = useState(() => formatForDateTimeInput(eventEnd, timezone));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = useMemo(
    () => [...members].sort((a, b) => formatMemberName(a).localeCompare(formatMemberName(b))),
    [members]
  );

  const arrivedAt = localToUTC(arrived, timezone);
  const leftAt = localToUTC(left, timezone);
  // As on the attendance-request dialog: the member is credited for every
  // minute entered, so a span outside the event is pointed out, not refused.
  const outsideEvent =
    !!arrivedAt && !!leftAt && (new Date(arrivedAt) < new Date(eventStart) || new Date(leftAt) > new Date(eventEnd));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) {
      setError('Choose the member who was there.');
      return;
    }
    if (!arrivedAt || !leftAt) {
      setError('Enter when they arrived and when they left.');
      return;
    }
    if (new Date(leftAt) <= new Date(arrivedAt)) {
      setError('They must leave after they arrive.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await eventService.addAttendee(eventId, { user_id: userId, status: 'going', checked_in: false });
      await eventService.overrideAttendance(eventId, userId, {
        override_check_in_at: arrivedAt,
        override_check_out_at: leftAt,
      });
      const name = members.find((m) => m.id === userId);
      toast.success(`${name ? formatMemberName(name) : 'Member'} recorded as present`);
      setUserId('');
      onRecorded();
    } catch (err) {
      setError(getErrorDetail(err) || 'Failed to record the member');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="border-theme-surface-border mb-4 rounded-md border p-3"
      aria-labelledby="late-attendee-heading"
    >
      <h3 id="late-attendee-heading" className="text-theme-text-primary text-sm font-semibold">
        Add a member
      </h3>
      <p className="text-theme-text-muted mt-1 mb-3 text-xs">
        Check-in has closed. Record someone who was there and when, and they are credited for that time when attendance
        is finalized.
      </p>
      {error && (
        <div className="alert-danger mb-3 text-sm" role="alert">
          {error}
        </div>
      )}
      {outsideEvent && (
        <div className="alert-warning mb-3 text-sm" role="status">
          These times run outside the event, which ran {formatTime(eventStart, timezone)} to{' '}
          {formatTime(eventEnd, timezone)}. The member is credited for every minute you enter.
        </div>
      )}
      <div className="space-y-3">
        <div>
          <label htmlFor="late-attendee-member" className="form-label">
            Member
          </label>
          <select
            id="late-attendee-member"
            className="form-input mt-1"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">Choose a member…</option>
            {sorted.map((m) => (
              <option key={m.id} value={m.id}>
                {formatMemberName(m)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="late-attendee-arrived" className="form-label">
            Arrived
          </label>
          <DateTimeQuarterHour
            id="late-attendee-arrived"
            value={arrived}
            onChange={setArrived}
            timezone={timezone}
            timeLabel="Arrival time"
            required
            className="form-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="late-attendee-left" className="form-label">
            Left
          </label>
          <DateTimeQuarterHour
            id="late-attendee-left"
            value={left}
            onChange={setLeft}
            timezone={timezone}
            timeLabel="Departure time"
            required
            className="form-input mt-1"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary btn-md">
          {busy ? 'Recording…' : 'Record attendance'}
        </button>
      </div>
    </form>
  );
};

export default EventLateAttendeeForm;
