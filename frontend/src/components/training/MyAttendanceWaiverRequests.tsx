/**
 * A member's own requests to be excused from training sessions, on My Training.
 *
 * Renders nothing until the member has made one: a department that does not
 * take requests, and a member who never asked, should not see an empty card.
 * The caller supplies the card around the list (`wrap`), so this sits in My
 * Training's collapsible sections like every other list there.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { attendanceWaiverService } from '../../services/attendanceWaiverService';
import { ATTENDANCE_WAIVER_STATUS_COLORS, ATTENDANCE_WAIVER_STATUS_LABELS } from '../../constants/enums';
import type { AttendanceWaiverRequest } from '../../types/attendanceWaiver';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { closesUndecidedText } from '../../utils/attendanceWaivers';

interface MyAttendanceWaiverRequestsProps {
  wrap: (list: React.ReactNode) => React.ReactNode;
}

export const MyAttendanceWaiverRequests: React.FC<MyAttendanceWaiverRequestsProps> = ({ wrap }) => {
  const tz = useTimezone();
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
                {closesUndecidedText(request, tz) && (
                  <span className="text-theme-text-muted block text-xs">{closesUndecidedText(request, tz)}</span>
                )}
              </span>
              <span className={`badge border ${ATTENDANCE_WAIVER_STATUS_COLORS[request.status] ?? ''}`}>
                {ATTENDANCE_WAIVER_STATUS_LABELS[request.status] ?? request.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

export default MyAttendanceWaiverRequests;
