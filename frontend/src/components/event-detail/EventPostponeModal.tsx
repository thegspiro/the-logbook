/**
 * Postpone an event to a new time (workflow review W80-11).
 *
 * Distinct from editing the schedule: a postponement says the event did not
 * happen at its old time, so the server clears the check-ins and corrected
 * times recorded so far and keeps the RSVPs. The dialog says so before the
 * officer commits, and names how many check-ins will go.
 */
import React, { useState } from 'react';
import { Modal } from '../Modal';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { formatForDateTimeInput, localToUTC } from '../../utils/dateFormatting';

export interface PostponeEventPayload {
  newStart: string;
  newEnd: string;
  reason: string;
  sendNotifications: boolean;
}

interface EventPostponeModalProps {
  /** The event's current times (UTC ISO), where the form starts. */
  currentStart: string;
  currentEnd: string;
  timezone: string;
  /** Members checked in so far, whose check-ins the postponement clears. */
  checkedInCount: number;
  submitting: boolean;
  submitError: string | null;
  onSubmit: (payload: PostponeEventPayload) => void;
  onClose: () => void;
}

const EventPostponeModal: React.FC<EventPostponeModalProps> = ({
  currentStart,
  currentEnd,
  timezone,
  checkedInCount,
  submitting,
  submitError,
  onSubmit,
  onClose,
}) => {
  const [start, setStart] = useState(() => formatForDateTimeInput(currentStart, timezone));
  const [end, setEnd] = useState(() => formatForDateTimeInput(currentEnd, timezone));
  const [reason, setReason] = useState('');
  const [sendNotifications, setSendNotifications] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newStart = localToUTC(start, timezone);
    const newEnd = localToUTC(end, timezone);
    if (!newStart || !newEnd) {
      setFormError('Enter the new start and end.');
      return;
    }
    if (new Date(newEnd) <= new Date(newStart)) {
      setFormError('The new end must be after the new start.');
      return;
    }
    if (new Date(newStart).getTime() === new Date(currentStart).getTime()) {
      setFormError('Choose a new time to postpone the event to.');
      return;
    }
    setFormError(null);
    onSubmit({ newStart, newEnd, reason: reason.trim(), sendNotifications });
  };

  const error = formError || submitError;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Postpone Event"
      titleId="postpone-event-modal-title"
      aria-describedby="postpone-event-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button
            type="submit"
            disabled={submitting || reason.trim().length < 10}
            className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
          >
            {submitting ? 'Postponing...' : 'Postpone Event'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs focus:ring-offset-2 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Keep Current Time
          </button>
        </>
      }
    >
      <div id="postpone-event-description" className="alert-warning mb-4 text-sm">
        <p>
          RSVPs are kept. Check-ins and corrected times recorded so far are cleared, so attendance starts afresh at the
          new time.
        </p>
        {checkedInCount > 0 && (
          <p className="mt-1 font-medium">
            {checkedInCount} {checkedInCount === 1 ? 'member is' : 'members are'} checked in now and will need to check
            in again.
          </p>
        )}
      </div>

      {error && (
        <div className="alert-danger mb-4 text-sm" role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label htmlFor="postpone-start" className="form-label">
            New start <span aria-hidden="true">*</span>
          </label>
          <DateTimeQuarterHour
            id="postpone-start"
            value={start}
            onChange={setStart}
            timezone={timezone}
            timeLabel="New start time"
            required
            className="form-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="postpone-end" className="form-label">
            New end <span aria-hidden="true">*</span>
          </label>
          <DateTimeQuarterHour
            id="postpone-end"
            value={end}
            onChange={setEnd}
            timezone={timezone}
            timeLabel="New end time"
            required
            className="form-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="postpone-reason" className="form-label">
            Reason <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="postpone-reason"
            rows={3}
            required
            aria-required="true"
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="form-input mt-1"
            placeholder="Why is this event being postponed?"
          />
          <p className="text-theme-text-muted mt-1 text-xs">{reason.length}/500 characters (minimum 10)</p>
        </div>
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={sendNotifications}
            onChange={(e) => setSendNotifications(e.target.checked)}
            className="form-checkbox"
          />
          <span className="text-theme-text-secondary ml-2 text-sm">
            Tell members who RSVP&apos;d Going or Maybe, with the old and new time
          </span>
        </label>
      </div>
    </Modal>
  );
};

export default EventPostponeModal;
