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
import { Hand } from 'lucide-react';
import { eventService } from '../../services/api';
import { AttendancePetitionStatus } from '../../constants/enums';
import type { AttendancePetition } from '../../types/event';
import { formatDateTime } from '../../utils/dateFormatting';
import { AttendancePetitionApproveDialog, AttendancePetitionDeclineDialog } from './AttendancePetitionDecisionDialogs';

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

  const replace = (updated: AttendancePetition) =>
    setPetitions((current) => current.map((p) => (p.id === updated.id ? updated : p)));

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
                    onClick={() => setApproving(petition)}
                    disabled={attendanceFinalized}
                    className="btn-primary text-sm font-medium disabled:opacity-50"
                    aria-label={`Approve ${petition.user_name || 'member'}'s request`}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclining(petition)}
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
        <AttendancePetitionApproveDialog
          eventId={eventId}
          petition={approving}
          defaultCheckIn={defaultCheckIn}
          defaultCheckOut={defaultCheckOut}
          timezone={timezone}
          onClose={() => setApproving(null)}
          onApproved={(updated) => {
            replace(updated);
            setApproving(null);
            onApproved?.();
          }}
        />
      )}

      <AttendancePetitionDeclineDialog
        eventId={eventId}
        petition={declining}
        onClose={() => setDeclining(null)}
        onDeclined={(updated) => {
          replace(updated);
          setDeclining(null);
        }}
      />
    </div>
  );
};

export default EventAttendancePetitionsCard;
