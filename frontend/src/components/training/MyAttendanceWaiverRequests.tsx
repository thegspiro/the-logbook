/**
 * A member's own requests to be excused from training sessions, on My Training.
 *
 * Renders nothing until the member has made one: a department that does not
 * take requests, and a member who never asked, should not see an empty card.
 * The caller supplies the card around the list (`wrap`), so this sits in My
 * Training's collapsible sections like every other list there.
 *
 * A request whose session moved waits on the member (`can_confirm`): it asks
 * whether the new date still needs a waiver, with Confirm and Withdraw.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { attendanceWaiverService } from '../../services/attendanceWaiverService';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { ATTENDANCE_WAIVER_STATUS_COLORS, ATTENDANCE_WAIVER_STATUS_LABELS } from '../../constants/enums';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';
import { formatCalendarDate, formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface MyAttendanceWaiverRequestsProps {
  wrap: (list: React.ReactNode) => React.ReactNode;
}

export const MyAttendanceWaiverRequests: React.FC<MyAttendanceWaiverRequestsProps> = ({ wrap }) => {
  const [requests, setRequests] = useState<AttendanceWaiverRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    attendanceWaiverService
      .listMine()
      .then((mine) => {
        if (!cancelled) setRequests(mine);
      })
      .catch(() => {
        // Secondary to the page: the rest of My Training still loads.
        if (!cancelled) setRequests([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm } = useConfirm();
  const tz = useTimezone();

  const replace = (updated: AttendanceWaiverRequest) =>
    setRequests((current) => current.map((r) => (r.id === updated.id ? updated : r)));

  // After a refusal the request may have moved on (expired, or the session
  // was cancelled); the server's list replaces ours.
  const refresh = async () => {
    try {
      setRequests(await attendanceWaiverService.listMine());
    } catch {
      // Keep what is on screen; the refusal is already shown.
    }
  };

  const handleConfirm = async (request: AttendanceWaiverRequest) => {
    setBusyId(request.id);
    try {
      replace(await attendanceWaiverService.confirm(request.id));
      toast.success('Confirmed; your request is back with the officers');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Your request could not be confirmed'));
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleWithdrawMoved = async (request: AttendanceWaiverRequest) => {
    const confirmed = await confirm({
      title: 'Withdraw your request?',
      message: `You will no longer be asking to be excused from ${request.event_title}, and it will count toward your attendance requirement.`,
      confirmLabel: 'Withdraw request',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!confirmed) return;
    setBusyId(request.id);
    try {
      replace(await attendanceWaiverService.withdraw(request.id));
      toast.success('Request withdrawn');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Your request could not be withdrawn'));
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0) return null;

  return (
    <>
      {wrap(
        <ul className="divide-theme-surface-border divide-y">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <span className="min-w-0 flex-1">
                {request.event_id ? (
                  <Link
                    to={`/events/${request.event_id}`}
                    className="text-theme-text-primary font-medium underline-offset-2 hover:underline"
                  >
                    {request.event_title}
                  </Link>
                ) : (
                  <span className="text-theme-text-primary font-medium">{request.event_title}</span>
                )}
                <span className="text-theme-text-secondary block text-sm">
                  {formatCalendarDate(request.session_date, { month: 'short', day: 'numeric', year: 'numeric' })}
                  {request.category ? ` · ${request.category}` : ''}
                  {request.decided_by_name ? ` · decided by ${request.decided_by_name}` : ''}
                  {request.chief_override ? ' (Chief override)' : ''}
                </span>
              </span>
              <span className={`badge border ${ATTENDANCE_WAIVER_STATUS_COLORS[request.status] ?? ''}`}>
                {ATTENDANCE_WAIVER_STATUS_LABELS[request.status] ?? request.status}
              </span>
              {request.can_confirm && (
                <div className="alert-warning split-row basis-full gap-3 rounded-lg p-3 text-sm sm:items-center">
                  <span className="split-row-main">
                    This session moved to {formatDateTime(request.event_start, tz)}. Do you still need to be excused?
                  </span>
                  <span className="split-row-aside flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleConfirm(request)}
                      disabled={busyId === request.id}
                      className="btn-primary text-sm font-medium disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    {request.can_withdraw && (
                      <button
                        type="button"
                        onClick={() => void handleWithdrawMoved(request)}
                        disabled={busyId === request.id}
                        className="btn-secondary text-sm font-medium disabled:opacity-50"
                      >
                        Withdraw
                      </button>
                    )}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default MyAttendanceWaiverRequests;
