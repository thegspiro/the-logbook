/**
 * Members asking to be marked present, for the event's organizer to decide.
 *
 * Shown to the organizer and to holders of events.manage — the server enforces
 * the same pair and answers 403 to anyone else, which renders nothing here.
 * Approving writes the confirmed times onto the member's RSVP as a manager
 * correction, credited when attendance is finalized; so it is unavailable
 * while attendance is finalized, and the card says to reopen it first.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Hand } from 'lucide-react';
import { Modal } from '../Modal';
import { PromptDialog } from '../ux';
import DateTimeQuarterHour from '../ux/DateTimeQuarterHour';
import { eventService } from '../../services/api';
import { AttendancePetitionStatus } from '../../constants/enums';
import type { AttendancePetition } from '../../types/event';
import { formatDateTime, formatForDateTimeInput, localToUTC } from '../../utils/dateFormatting';
import { getErrorDetail } from '../../utils/errorHandling';

interface EventAttendancePetitionsCardProps {
  eventId: string;
  /** Where the confirm form starts when the member gave no times. */
  defaultCheckIn: string;
  defaultCheckOut: string;
  attendanceFinalized: boolean;
  timezone: string;
  /** Called after an approval, so the page can refresh its roster. */
  onApproved?: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  [AttendancePetitionStatus.APPROVED]: 'Approved',
  [AttendancePetitionStatus.REJECTED]: 'Declined',
};

export const EventAttendancePetitionsCard: React.FC<EventAttendancePetitionsCardProps> = ({
  eventId,
  defaultCheckIn,
  defaultCheckOut,
  attendanceFinalized,
  timezone,
  onApproved,
}) => {
  const [petitions, setPetitions] = useState<AttendancePetition[]>([]);
  const [approving, setApproving] = useState<AttendancePetition | null>(null);
  const [declining, setDeclining] = useState<AttendancePetition | null>(null);
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPetitions(await eventService.getAttendancePetitions(eventId));
    } catch {
      // A 403 (not the organizer, no events.manage) or a failed load both
      // leave the card out; the rest of the page stands on its own.
      setPetitions([]);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openApprove = (petition: AttendancePetition) => {
    setCheckIn(formatForDateTimeInput(petition.requested_check_in_at || defaultCheckIn, timezone));
    setCheckOut(formatForDateTimeInput(petition.requested_check_out_at || defaultCheckOut, timezone));
    setNote('');
    setFormError(null);
    setApproving(petition);
  };

  const replace = (updated: AttendancePetition) =>
    setPetitions((current) => current.map((p) => (p.id === updated.id ? updated : p)));

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approving) return;
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
      const updated = await eventService.approveAttendancePetition(eventId, approving.id, {
        check_in_at: checkInAt,
        check_out_at: checkOutAt,
        review_note: note.trim() || undefined,
      });
      replace(updated);
      setApproving(null);
      toast.success('Attendance confirmed');
      onApproved?.();
    } catch (err) {
      setFormError(getErrorDetail(err) || 'Failed to approve the request');
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async (reason: string) => {
    if (!declining) return;
    setBusy(true);
    try {
      replace(await eventService.rejectAttendancePetition(eventId, declining.id, reason));
      setDeclining(null);
      toast.success('Request declined');
    } catch (err) {
      toast.error(getErrorDetail(err) || 'Failed to decline the request');
    } finally {
      setBusy(false);
    }
  };

  if (petitions.length === 0) return null;

  const pending = petitions.filter((p) => p.status === AttendancePetitionStatus.PENDING);
  const decided = petitions.filter((p) => p.status !== AttendancePetitionStatus.PENDING);

  return (
    <div className="card p-6">
      <h2 className="text-theme-text-primary mb-1 flex items-center gap-2 text-lg font-medium">
        <Hand className="h-5 w-5" aria-hidden="true" />
        Attendance Requests
      </h2>
      <p className="text-theme-text-secondary mb-4 text-sm">
        Members with no check-in who say they were here. Approving records the times you confirm, credited when
        attendance is finalized.
      </p>

      {attendanceFinalized && pending.length > 0 && (
        <div className="alert-warning mb-4 text-sm" role="note">
          Attendance is finalized. Reopen attendance to approve a request; declining still works.
        </div>
      )}

      {pending.length > 0 && (
        <ul className="divide-theme-surface-border divide-y">
          {pending.map((petition) => (
            <li key={petition.id} className="py-3 first:pt-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-theme-text-primary text-sm font-medium">{petition.user_name || 'A member'}</p>
                  <p className="text-theme-text-secondary text-xs">
                    Asked {formatDateTime(petition.created_at, timezone)}
                  </p>
                  <p className="text-theme-text-primary mt-1 text-sm break-words whitespace-pre-line">
                    {petition.reason}
                  </p>
                  {(petition.requested_check_in_at || petition.requested_check_out_at) && (
                    <p className="text-theme-text-secondary mt-1 text-xs">
                      Says they were there
                      {petition.requested_check_in_at &&
                        ` from ${formatDateTime(petition.requested_check_in_at, timezone)}`}
                      {petition.requested_check_out_at &&
                        ` until ${formatDateTime(petition.requested_check_out_at, timezone)}`}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => openApprove(petition)}
                    disabled={attendanceFinalized || busy}
                    className="btn-primary text-sm font-medium disabled:opacity-50"
                    aria-label={`Approve ${petition.user_name || 'member'}'s request`}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclining(petition)}
                    disabled={busy}
                    className="btn-secondary text-sm font-medium disabled:opacity-50"
                    aria-label={`Decline ${petition.user_name || 'member'}'s request`}
                  >
                    Decline
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <ul className="text-theme-text-secondary mt-3 space-y-1 text-sm">
          {decided.map((petition) => (
            <li key={petition.id}>
              <span className="text-theme-text-primary font-medium">{petition.user_name || 'A member'}</span>
              {' — '}
              {STATUS_LABEL[petition.status] ?? petition.status}
              {petition.reviewed_by_name && ` by ${petition.reviewed_by_name}`}
              {petition.review_note && `: ${petition.review_note}`}
            </li>
          ))}
        </ul>
      )}

      {approving && (
        <Modal
          isOpen
          onClose={() => setApproving(null)}
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
                onClick={() => setApproving(null)}
                className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
              >
                Cancel
              </button>
            </>
          }
        >
          <p id="approve-petition-description" className="text-theme-text-secondary mb-4 text-sm">
            Confirm when {approving.user_name || 'this member'} was present. These times decide the hours credited.
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
      )}

      <PromptDialog
        isOpen={declining !== null}
        onClose={() => setDeclining(null)}
        onSubmit={(value) => void handleDecline(value)}
        title="Decline attendance request"
        message={`${declining?.user_name || 'The member'} will be told the request was declined, with your reason. They cannot ask again for this event.`}
        label="Reason"
        multiline
        required
        confirmLabel="Decline request"
        confirmVariant="warning"
        loading={busy}
      />
    </div>
  );
};

export default EventAttendancePetitionsCard;
