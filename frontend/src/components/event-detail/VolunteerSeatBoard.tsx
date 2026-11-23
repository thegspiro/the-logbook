/**
 * An outreach event's volunteer seats on the event page, laid out as a shift's
 * crew board is in Scheduling (owner request, 2026-11-23): one row per seat,
 * with who holds it, or "Open position" and a button to take it.
 *
 * Read from GET /events/{id}/staffing/seats, which sits under `/staffing` so
 * the API cache never holds it: it names members, and a cached copy left
 * "Sign myself up" on screen after the signup it had just recorded. The same
 * board serves members and organizers.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Loader2, UserPlus } from 'lucide-react';
import { eventService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { EventVolunteerSeatBoard } from '../../types/event';
import { getErrorMessage } from '../../utils/errorHandling';

interface VolunteerSeatBoardProps {
  eventId: string;
  /** The event has ended, so no seat is offered. */
  isPast: boolean;
  /** After a signup, for a parent that shows its own counts. */
  onSignedUp?: () => void | Promise<void>;
}

const VolunteerSeatBoard: React.FC<VolunteerSeatBoardProps> = ({ eventId, isPast, onSignedUp }) => {
  const [board, setBoard] = useState<EventVolunteerSeatBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The role being signed up for, so only that row's button spins.
  const [signingUp, setSigningUp] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBoard(await eventService.getVolunteerSeats(eventId));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load the volunteer seats.'));
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <p className="text-sm text-red-800 dark:text-red-300" role="alert">
        {loadError}
      </p>
    );
  }
  if (!board) {
    return (
      <p className="text-theme-text-muted flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading seats…
      </p>
    );
  }

  const signUp = async (role: string, label: string) => {
    setSigningUp(role);
    try {
      await schedulingService.signupForShift(board.shift_id, { outreach_role: role });
      toast.success(`Signed up as ${label}.`);
      await load();
      await onSignedUp?.();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not sign you up.'));
    } finally {
      setSigningUp(null);
    }
  };

  const filled = board.seats.filter((seat) => seat.member_name).length;
  const open = board.seats.length - filled;
  const canSignUp = !board.signed_up && !isPast;

  return (
    <div className="space-y-2">
      <p className="text-theme-text-secondary flex justify-between gap-3 text-sm">
        <span>
          {filled} of {board.seats.length} signed up
        </span>
        {open > 0 && <span className="font-medium text-amber-800 dark:text-amber-300">{open} open</span>}
      </p>
      <ul className="space-y-2">
        {board.seats.map((seat, index) => (
          <li
            // Seats carry no id of their own; their order is the server's.
            key={`${seat.role}-${index}`}
            className={`flex items-center justify-between gap-2 rounded-lg border p-2.5 sm:p-3 ${
              seat.member_name
                ? seat.is_me
                  ? 'border-violet-500/30 bg-violet-500/5'
                  : 'border-theme-surface-border bg-theme-surface-hover/30'
                : 'border-theme-surface-border bg-theme-surface-hover/10 border-dashed'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {seat.member_name ? (
                <>
                  <div
                    className="bg-theme-surface-hover text-theme-text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium"
                    aria-hidden="true"
                  >
                    {seat.member_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-theme-text-primary truncate text-sm font-medium">
                      {seat.member_name}
                      {seat.is_me && <span className="ml-1 text-xs text-violet-700 dark:text-violet-300">(You)</span>}
                    </p>
                    <p className="text-theme-text-muted text-xs">{seat.label}</p>
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="border-theme-surface-border flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed"
                    aria-hidden="true"
                  >
                    <UserPlus className="text-theme-text-muted h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-theme-text-muted text-sm">{seat.label}</p>
                    <p className="text-theme-text-muted text-xs">Open position</p>
                  </div>
                </>
              )}
            </div>
            {!seat.member_name && canSignUp && (
              <button
                type="button"
                onClick={() => void signUp(seat.role, seat.label)}
                disabled={signingUp !== null}
                aria-label={`Sign myself up as ${seat.label}`}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50 sm:px-3"
              >
                {signingUp === seat.role ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus className="h-3 w-3" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">Sign myself up</span>
                <span className="sm:hidden">Sign up</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {board.signed_up && (
        <p className="text-theme-text-secondary text-sm">
          You are signed up{board.my_role_label ? ` as ${board.my_role_label}` : ''}. To give the role up, go to{' '}
          <Link to="/scheduling?tab=my-shifts" className="font-medium text-blue-700 underline dark:text-blue-400">
            My Shifts
          </Link>
          .
        </p>
      )}
    </div>
  );
};

export default VolunteerSeatBoard;
