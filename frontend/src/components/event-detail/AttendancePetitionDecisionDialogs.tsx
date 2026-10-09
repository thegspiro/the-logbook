/**
 * The two decisions on an attendance request — confirm the times and approve,
 * or decline with a reason — shared by the event page's Attendance Requests
 * card and the cross-event Attendance Requests page, so both decide a request
 * the same way.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../Modal';
import { PromptDialog } from '../ux';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { eventService } from '../../services/api';
import type { AttendancePetition } from '../../types/event';
import { formatForDateTimeInput, localToUTC } from '../../utils/dateFormatting';
import { getErrorDetail } from '../../utils/errorHandling';

interface ApproveDialogProps {
  eventId: string;
  petition: AttendancePetition;
  /** Where the form starts when the member gave no times. */
  defaultCheckIn: string;
  defaultCheckOut: string;
  timezone: string;
  onClose: () => void;
  onApproved: (updated: AttendancePetition) => void;
}

/** Mount it per request (render it only while one is being approved), so the
 * form starts from that request's times rather than the previous one's. */
export const AttendancePetitionApproveDialog: React.FC<ApproveDialogProps> = ({
  eventId,
  petition,
  defaultCheckIn,
  defaultCheckOut,
  timezone,
  onClose,
  onApproved,
}) => {
  const [checkIn, setCheckIn] = useState(() =>
    formatForDateTimeInput(petition.requested_check_in_at || defaultCheckIn, timezone)
  );
  const [checkOut, setCheckOut] = useState(() =>
    formatForDateTimeInput(petition.requested_check_out_at || defaultCheckOut, timezone)
  );
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    const checkInAt = localToUTC(checkIn, timezone);
    const checkOutAt = localToUTC(checkOut, timezone);
    if (!checkInAt || !checkOutAt) {
      setFormError('Enter both a check-in and a check-out time.');
      return;
    }
    if (new Date(checkOutAt) <= new Date(checkInAt)) {
      setFormError('Check-out must be after check-in.');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const updated = await eventService.approveAttendancePetition(eventId, petition.id, {
        check_in_at: checkInAt,
        check_out_at: checkOutAt,
        review_note: note.trim() || undefined,
      });
      toast.success('Attendance confirmed');
      onApproved(updated);
    } catch (err) {
      setFormError(getErrorDetail(err) || 'Failed to approve the request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Confirm attendance"
      titleId="approve-petition-title"
      aria-describedby="approve-petition-description"
      onSubmit={(e) => void handleApprove(e)}
      footer={
        <>
          <button
            type="submit"
            disabled={busy}
            className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
          >
            {busy ? 'Saving...' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Cancel
          </button>
        </>
      }
    >
      <p id="approve-petition-description" className="text-theme-text-secondary mb-4 text-sm">
        Confirm when {petition.user_name || 'this member'} was present. These times decide the hours credited.
      </p>
      {formError && (
        <div className="alert-danger mb-4 text-sm" role="alert">
          {formError}
        </div>
      )}
      <div className="space-y-4">
        <div>
          <label htmlFor="petition-check-in" className="form-label">
            Check-in
          </label>
          <DateTimeQuarterHour
            id="petition-check-in"
            value={checkIn}
            onChange={setCheckIn}
            timezone={timezone}
            timeLabel="Check-in time"
            required
            className="form-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="petition-check-out" className="form-label">
            Check-out
          </label>
          <DateTimeQuarterHour
            id="petition-check-out"
            value={checkOut}
            onChange={setCheckOut}
            timezone={timezone}
            timeLabel="Check-out time"
            required
            className="form-input mt-1"
          />
        </div>
        <div>
          <label htmlFor="petition-note" className="form-label">
            Note to the member <span className="text-theme-text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="petition-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            className="form-input mt-1"
          />
        </div>
      </div>
    </Modal>
  );
};

interface DeclineDialogProps {
  eventId: string;
  /** The request being declined; null keeps the dialog closed. */
  petition: AttendancePetition | null;
  onClose: () => void;
  onDeclined: (updated: AttendancePetition) => void;
}

export const AttendancePetitionDeclineDialog: React.FC<DeclineDialogProps> = ({
  eventId,
  petition,
  onClose,
  onDeclined,
}) => {
  const [busy, setBusy] = useState(false);

  const handleDecline = async (reason: string) => {
    if (!petition) return;
    setBusy(true);
    try {
      const updated = await eventService.rejectAttendancePetition(eventId, petition.id, reason);
      toast.success('Request declined');
      onDeclined(updated);
    } catch (err) {
      toast.error(getErrorDetail(err) || 'Failed to decline the request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <PromptDialog
      isOpen={petition !== null}
      onClose={onClose}
      onSubmit={(value) => void handleDecline(value)}
      title="Decline attendance request"
      message={`${petition?.user_name || 'The member'} will be told the request was declined, with your reason. They cannot ask again for this event.`}
      label="Reason"
      multiline
      required
      confirmLabel="Decline request"
      confirmVariant="warning"
      loading={busy}
    />
  );
};
