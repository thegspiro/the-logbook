/**
 * An outreach event's volunteer seats on the event page, laid out as a shift's
 * crew board is in Scheduling (owner request, 2026-11-23): one row per seat,
 * with who holds it, or "Open position" and a button to take it.
 *
 * Read from GET /events/{id}/staffing/seats, which sits under `/staffing` so
 * the API cache never holds it: it names members, and a cached copy left
 * "Sign myself up" on screen after the signup it had just recorded. The same
 * board serves members and organizers.
 *
 * Every change goes through the scheduling endpoints the crew board uses, so
 * the signup window, eligibility and role caps are enforced in one place:
 * signing up, giving your own seat up, and (with `scheduling.assign`, as on the
 * crew board) assigning someone to an open seat.
 */

import React, { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Loader2, UserMinus, UserPlus } from 'lucide-react';
import { eventService } from '../../services/api';
import { schedulingService } from '../../modules/scheduling/services/api';
import { useSchedulingStore } from '../../modules/scheduling/store/schedulingStore';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuthStore } from '../../stores/authStore';
import type { EventVolunteerSeat, EventVolunteerSeatBoard } from '../../types/event';
import { getErrorMessage } from '../../utils/errorHandling';

interface VolunteerSeatBoardProps {
  eventId: string;
  /** The event has ended, so no seat is offered, given up or assigned. */
  isPast: boolean;
  /** After any change to the seats, for a parent that shows its own counts. */
  onChanged?: () => void | Promise<void>;
}

/** The inline picker for one open seat; only one is open at a time. */
const AssignSeatForm: React.FC<{
  seat: EventVolunteerSeat;
  busy: boolean;
  onAssign: (userId: string) => void;
  onCancel: () => void;
}> = ({ seat, busy, onAssign, onCancel }) => {
  const selectId = useId();
  const members = useSchedulingStore((s) => s.members);
  const membersLoaded = useSchedulingStore((s) => s.membersLoaded);
  const loadMembers = useSchedulingStore((s) => s.loadMembers);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  return (
    <div className="border-theme-surface-border bg-theme-surface-hover/30 flex flex-wrap items-end gap-2 rounded-lg border p-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={selectId} className="form-label">
          Assign someone as {seat.label}
        </label>
        <select
          id={selectId}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="form-input"
          disabled={!membersLoaded}
        >
          <option value="">{membersLoaded ? 'Choose a member' : 'Loading members…'}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={() => onAssign(userId)}
        disabled={busy || !userId}
        className="btn-primary inline-flex items-center gap-2"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Assign
      </button>
      <button type="button" onClick={onCancel} className="btn-secondary">
        Cancel
      </button>
    </div>
  );
};

const VolunteerSeatBoard: React.FC<VolunteerSeatBoardProps> = ({ eventId, isPast, onChanged }) => {
  const { confirm } = useConfirm();
  const canAssign = useAuthStore((s) => s.checkPermission('scheduling.assign'));
  const [board, setBoard] = useState<EventVolunteerSeatBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The row being changed, so only that row's button spins.
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);

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

  const change = async (index: number, action: () => Promise<unknown>, done: string, failed: string) => {
    setBusyIndex(index);
    try {
      await action();
      toast.success(done);
      setAssigningIndex(null);
      await load();
      await onChanged?.();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, failed));
    } finally {
      setBusyIndex(null);
    }
  };

  const signUp = (index: number, seat: EventVolunteerSeat) =>
    change(
      index,
      () => schedulingService.signupForShift(board.shift_id, { outreach_role: seat.role }),
      `Signed up as ${seat.label}.`,
      'Could not sign you up.'
    );

  const giveUp = async (index: number, seat: EventVolunteerSeat) => {
    const agreed = await confirm({
      title: 'Give up your spot?',
      message: `You will no longer be signed up as ${seat.label}. The spot opens for someone else to take.`,
      confirmLabel: 'Give up my spot',
      cancelLabel: 'Keep it',
    });
    if (!agreed) return;
    await change(
      index,
      () => schedulingService.withdrawSignup(board.shift_id),
      'You have given up your spot.',
      'Could not give up your spot.'
    );
  };

  const assign = (index: number, seat: EventVolunteerSeat, userId: string) =>
    change(
      index,
      () =>
        schedulingService.createAssignment(board.shift_id, {
          user_id: userId,
          position: 'volunteer',
          outreach_role: seat.role,
        }),
      `Assigned as ${seat.label}.`,
      'Could not assign them.'
    );

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
          // Seats carry no id of their own; their order is the server's.
          <li key={`${seat.role}-${index}`} className="space-y-2">
            <div
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
              {!isPast && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {seat.is_me && (
                    <button
                      type="button"
                      onClick={() => void giveUp(index, seat)}
                      disabled={busyIndex !== null}
                      aria-label={`Give up my spot as ${seat.label}`}
                      className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 sm:px-3"
                    >
                      {busyIndex === index ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserMinus className="h-3 w-3" aria-hidden="true" />
                      )}
                      <span className="hidden sm:inline">Give up my spot</span>
                      <span className="sm:hidden">Give up</span>
                    </button>
                  )}
                  {!seat.member_name && canAssign && assigningIndex !== index && (
                    <button
                      type="button"
                      onClick={() => setAssigningIndex(index)}
                      disabled={busyIndex !== null}
                      aria-label={`Assign someone as ${seat.label}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-500/10 disabled:opacity-50 sm:px-3 dark:text-violet-300"
                    >
                      <UserPlus className="h-3 w-3" aria-hidden="true" />
                      <span className="hidden sm:inline">Assign someone</span>
                      <span className="sm:hidden">Assign</span>
                    </button>
                  )}
                  {!seat.member_name && canSignUp && (
                    <button
                      type="button"
                      onClick={() => void signUp(index, seat)}
                      disabled={busyIndex !== null}
                      aria-label={`Sign myself up as ${seat.label}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50 sm:px-3"
                    >
                      {busyIndex === index ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserPlus className="h-3 w-3" aria-hidden="true" />
                      )}
                      <span className="hidden sm:inline">Sign myself up</span>
                      <span className="sm:hidden">Sign up</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            {assigningIndex === index && !isPast && (
              <AssignSeatForm
                seat={seat}
                busy={busyIndex === index}
                onAssign={(userId) => void assign(index, seat, userId)}
                onCancel={() => setAssigningIndex(null)}
              />
            )}
          </li>
        ))}
      </ul>
      {board.signed_up && (
        <p className="text-theme-text-secondary text-sm">
          You are signed up{board.my_role_label ? ` as ${board.my_role_label}` : ''}. You can give your spot up above,
          or from{' '}
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
