/**
 * Attendance Requests — every "I was there" request waiting on the viewer,
 * across events, oldest first.
 *
 * Each event's page already has an Attendance Requests card, but an organizer
 * running several events had to open each one to find out whether anybody was
 * waiting. Reachable by any member: the default list is the events they
 * organize or are alternate for, which is empty for most members. An
 * events.manage holder can widen it to the whole department. The server
 * decides who sees what; the toggle is only offered where it would answer.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Hand } from 'lucide-react';
import { eventService } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { Breadcrumbs, EmptyState } from '../components/ux';
import {
  AttendancePetitionApproveDialog,
  AttendancePetitionDeclineDialog,
} from '../components/event-detail/AttendancePetitionDecisionDialogs';
import type { PendingAttendancePetition } from '../types/event';
import { formatDate, formatDateTime } from '../utils/dateFormatting';
import { getErrorDetail } from '../utils/errorHandling';

type Scope = 'mine' | 'all';

export const AttendanceRequestsPage: React.FC = () => {
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canSeeAll = checkPermission('events.manage');
  const tz = useTimezone();

  const [scope, setScope] = useState<Scope>('mine');
  const [requests, setRequests] = useState<PendingAttendancePetition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<PendingAttendancePetition | null>(null);
  const [declining, setDeclining] = useState<PendingAttendancePetition | null>(null);

  const load = useCallback(async (which: Scope) => {
    setLoading(true);
    setError(null);
    try {
      setRequests(await eventService.getPendingAttendancePetitions(which));
    } catch (err) {
      setError(getErrorDetail(err) || 'Failed to load attendance requests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
  }, [load, scope]);

  // A decided request is no longer pending, so it leaves the list.
  const remove = (id: string) => setRequests((current) => current.filter((r) => r.id !== id));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <Breadcrumbs />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary flex items-center gap-3 text-2xl font-bold sm:text-3xl">
            <Hand className="h-7 w-7" aria-hidden="true" />
            Attendance Requests
          </h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Members with no check-in who asked to be marked present, oldest first. Approving records the times you
            confirm, credited when the event&apos;s attendance is finalized.
          </p>
        </div>
        {canSeeAll && (
          <div className="flex shrink-0 gap-2" role="group" aria-label="Which events">
            <button
              type="button"
              aria-pressed={scope === 'mine'}
              onClick={() => setScope('mine')}
              className={scope === 'mine' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
            >
              My events
            </button>
            <button
              type="button"
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
              className={scope === 'all' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
            >
              All events
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-4" aria-busy="true">
          {[1, 2].map((i) => (
            <div key={i} className="card p-6">
              <div className="bg-theme-surface-hover mb-3 h-5 w-48 animate-pulse rounded-sm" />
              <div className="bg-theme-surface-hover h-4 w-72 animate-pulse rounded-sm" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="alert-danger text-sm" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => void load(scope)} className="mt-2 underline">
            Try again
          </button>
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={Hand}
          title="No attendance requests waiting"
          description={
            scope === 'all'
              ? 'Nobody in the department is waiting to be marked present.'
              : 'Nobody is waiting on an event you organize or are alternate for.'
          }
        />
      ) : (
        <ul className="space-y-4">
          {requests.map((request) => (
            <li key={request.id} className="card p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link
                    to={`/events/${request.event_id}`}
                    className="text-theme-text-primary text-base font-semibold hover:underline"
                  >
                    {request.event_title}
                  </Link>
                  <p className="text-theme-text-secondary text-xs">{formatDate(request.event_start_datetime, tz)}</p>
                  <p className="text-theme-text-primary mt-2 text-sm font-medium">
                    {request.user_name || 'A member'}
                    <span className="text-theme-text-secondary font-normal">
                      {' '}
                      · asked {formatDateTime(request.created_at, tz)}
                    </span>
                  </p>
                  <p className="text-theme-text-primary mt-1 text-sm break-words whitespace-pre-line">
                    {request.reason}
                  </p>
                  {(request.requested_check_in_at || request.requested_check_out_at) && (
                    <p className="text-theme-text-secondary mt-1 text-xs">
                      Says they were there
                      {request.requested_check_in_at && ` from ${formatDateTime(request.requested_check_in_at, tz)}`}
                      {request.requested_check_out_at && ` until ${formatDateTime(request.requested_check_out_at, tz)}`}
                    </p>
                  )}
                  {request.attendance_finalized && (
                    <p className="text-theme-text-secondary mt-2 text-xs">
                      Attendance for this event is finalized. Reopen it on the event page to approve; declining still
                      works.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => setApproving(request)}
                    disabled={request.attendance_finalized}
                    className="btn-primary text-sm font-medium disabled:opacity-50"
                    aria-label={`Approve ${request.user_name || 'member'}'s request for ${request.event_title}`}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclining(request)}
                    className="btn-secondary text-sm font-medium"
                    aria-label={`Decline ${request.user_name || 'member'}'s request for ${request.event_title}`}
                  >
                    Decline
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {approving && (
        <AttendancePetitionApproveDialog
          eventId={approving.event_id}
          petition={approving}
          defaultCheckIn={approving.event_actual_start_time ?? approving.event_start_datetime}
          defaultCheckOut={approving.event_actual_end_time ?? approving.event_end_datetime}
          timezone={tz}
          onClose={() => setApproving(null)}
          onApproved={(updated) => {
            remove(updated.id);
            setApproving(null);
          }}
        />
      )}

      <AttendancePetitionDeclineDialog
        eventId={declining?.event_id ?? ''}
        petition={declining}
        onClose={() => setDeclining(null)}
        onDeclined={(updated) => {
          remove(updated.id);
          setDeclining(null);
        }}
      />
    </div>
  );
};

export default AttendanceRequestsPage;
