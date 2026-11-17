/**
 * Apparatus & Crew — the seats on an apparatus night, on the event page.
 *
 * Renders nothing for an ordinary event: the board answers 404 there, which
 * is the signal, not an error. A member takes or leaves an open seat; a
 * coordinator also assigns, clears and reshapes the night. Check-in and the
 * Finalize step that posts the crew's hours stay where they already are on
 * this page, so there is one way to confirm attendance, not two.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import { CheckCircle2, Pencil, Truck, UserMinus, UserPlus } from 'lucide-react';
import { apparatusEventService } from '../../services/api';
import { ApparatusEventSeatType, type CrewBoard, type CrewSeat, type CrewUnit } from '../../types/apparatusEvent';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatCalendarDate, toLocalDateString } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { EVOC_MODE_LABEL, EVOC_MODE_TONE, TONE } from '../../pages/apparatus-events/tones';
import AssignSeatDialog from './apparatus-crew/AssignSeatDialog';
import EditNightDialog from './apparatus-crew/EditNightDialog';
import { seatLabels } from './apparatus-crew/seatLabels';

interface EventApparatusCrewCardProps {
  eventId: string;
  timezone: string;
}

export const EventApparatusCrewCard: React.FC<EventApparatusCrewCardProps> = ({ eventId, timezone }) => {
  const { confirm } = useConfirm();
  const [board, setBoard] = useState<CrewBoard | null>(null);
  const [absent, setAbsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSeat, setPendingSeat] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<{ unit: CrewUnit; seat: CrewSeat; label: string } | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      setBoard(await apparatusEventService.getCrewBoard(eventId));
      setAbsent(false);
      setError(null);
    } catch (err) {
      if (isAxiosError(err) && (err.response?.status === 404 || err.response?.status === 403)) {
        setAbsent(true);
      } else {
        setError(getErrorMessage(err, 'Could not load the crew.'));
      }
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (absent) return null;
  if (error) {
    return (
      <div className="card p-6">
        <p className="alert-danger text-sm" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!board) return null;

  const closed = board.is_cancelled || board.attendance_finalized;
  const ended = new Date(board.end_datetime).getTime() <= Date.now();
  const canTake = !closed && !ended && board.can_sign_up && board.allow_self_signup && board.my_seat_id === null;
  const filled = board.units.reduce((n, u) => n + u.seats.filter((s) => s.user_id).length, 0);
  const total = board.units.reduce((n, u) => n + u.seats.length, 0);

  const act = async (seatId: string, action: () => Promise<CrewBoard>, done: string) => {
    setPendingSeat(seatId);
    try {
      const updated = await action();
      updated.warnings.forEach((w) => toast(w.message, { icon: '⚠️' }));
      toast.success(done);
      setBoard(updated);
    } catch (err) {
      toast.error(getErrorMessage(err, 'That did not go through.'));
      void load();
    } finally {
      setPendingSeat(null);
    }
  };

  const leave = async (seat: CrewSeat, label: string, mine: boolean) => {
    const ok = await confirm({
      title: mine ? 'Leave this seat?' : `Clear ${label}?`,
      message: mine
        ? `You come off the ${label} seat on this night, and your RSVP changes to not going.`
        : `${seat.user_name ?? 'This member'} comes off the ${label} seat, and their RSVP changes to not going.`,
      confirmLabel: mine ? 'Leave seat' : 'Clear seat',
      cancelLabel: 'Keep it',
      variant: 'warning',
    });
    if (!ok) return;
    void act(
      seat.id,
      () =>
        mine
          ? apparatusEventService.releaseSeat(board.event_id, seat.id)
          : apparatusEventService.assignSeat(board.event_id, seat.id, null),
      mine ? 'You left the seat' : 'Seat cleared'
    );
  };

  return (
    <section className="card p-6" aria-labelledby="crew-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="crew-heading" className="text-theme-text-primary flex items-center gap-2 text-lg font-medium">
            <Truck className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden="true" />
            Apparatus &amp; Crew
          </h2>
          <p className="text-theme-text-muted mt-1 text-sm">
            {board.night_count > 1 ? `Night ${board.night_number} of ${board.night_count}` : 'One night'}
            {board.template_name ? ` · from “${board.template_name}”` : ''} · {filled} of {total} seats filled
          </p>
        </div>
        {board.can_manage && !closed && (
          <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit this night
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`badge ${TONE.slate}`}>Outreach · not a shift</span>
        <span className={`badge ${EVOC_MODE_TONE[board.evoc_mode]}`}>{EVOC_MODE_LABEL[board.evoc_mode]}</span>
        <span className={`badge ${TONE.slate}`}>Hours: {board.admin_hours_category_name ?? 'by event type'}</span>
      </div>

      {board.series.length > 1 && (
        <nav className="mt-3 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Other nights in this run">
          <span className="text-theme-text-muted">Nights:</span>
          {board.series.map((night) => {
            const current = night.event_id === board.event_id;
            const day = formatCalendarDate(toLocalDateString(new Date(night.start_datetime), timezone), {
              month: 'short',
              day: 'numeric',
            });
            return current ? (
              <span key={night.event_id} className={`badge ${TONE.red}`} aria-current="page">
                {day} · {night.filled}/{night.total}
              </span>
            ) : (
              <Link
                key={night.event_id}
                to={`/events/${night.event_id}`}
                className={`badge hover:underline ${TONE.slate}`}
              >
                {day} · {night.filled}/{night.total}
              </Link>
            );
          })}
        </nav>
      )}

      {closed && (
        <p className="alert-info mt-3 text-sm">
          {board.is_cancelled
            ? 'This night was cancelled.'
            : 'Attendance is finalized and the crew’s hours are posted. The crew can no longer change.'}
        </p>
      )}

      <div className="mt-4 space-y-5">
        {board.units.map((unit) => {
          const labels = seatLabels(unit);
          return (
            <div key={unit.id}>
              <h3 className="text-theme-text-primary mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span className="rounded-md bg-red-800 px-2 py-0.5 font-mono text-xs font-bold text-white">
                  {unit.unit_number}
                </span>
                {unit.apparatus_name && <span>{unit.apparatus_name}</span>}
                {unit.required_evoc_level_name && (
                  <span className="text-theme-text-muted font-normal">
                    · requires {unit.required_evoc_level_name} to drive
                  </span>
                )}
              </h3>
              <ul className="space-y-2">
                {unit.seats.map((seat) => {
                  const label = labels.get(seat.id) ?? seat.name;
                  const busy = pendingSeat === seat.id;
                  return (
                    <li
                      key={seat.id}
                      className={`grid gap-2 rounded-lg border p-3 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:items-center sm:gap-3 ${
                        seat.user_id
                          ? 'border-theme-surface-border'
                          : 'border-theme-surface-border bg-theme-surface-secondary border-dashed'
                      }`}
                    >
                      <span className="text-theme-text-primary font-semibold">{label}</span>
                      <div className="min-w-0 text-sm">
                        {seat.user_id ? (
                          <span className="text-theme-text-primary">
                            {seat.user_name ?? 'A member'}
                            {seat.is_me && <span className={`badge ml-2 ${TONE.blue}`}>You</span>}
                            {seat.checked_in && (
                              <span className={`badge ml-2 ${TONE.green}`}>
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                Checked in
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-theme-text-muted">Open seat</span>
                        )}
                        {seat.seat_type === ApparatusEventSeatType.DRIVER && (
                          <span className={`badge ml-2 ${TONE.red}`}>Driver · EVOC</span>
                        )}
                        {seat.note && <p className="text-theme-text-muted mt-0.5 text-xs">{seat.note}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {!seat.user_id && canTake && (
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                seat.id,
                                () => apparatusEventService.claimSeat(board.event_id, seat.id),
                                `You’re on the crew as ${label}`
                              )
                            }
                          >
                            <UserPlus className="h-4 w-4" aria-hidden="true" />
                            Sign me up
                          </button>
                        )}
                        {seat.is_me && !closed && !seat.checked_in && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => void leave(seat, label, true)}
                          >
                            <UserMinus className="h-4 w-4" aria-hidden="true" />
                            Leave seat
                          </button>
                        )}
                        {board.can_manage && !closed && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={busy || seat.checked_in}
                            onClick={() => setAssigning({ unit, seat, label })}
                          >
                            {seat.user_id ? 'Change…' : 'Assign…'}
                          </button>
                        )}
                        {board.can_manage && !closed && seat.user_id && !seat.is_me && !seat.checked_in && (
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            disabled={busy}
                            onClick={() => void leave(seat, label, false)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-theme-text-muted mt-4 text-xs">
        Crew check in on the night like any event. Finalizing attendance on this page confirms the crew and posts their
        hours to Admin Hours{board.admin_hours_category_name ? ` → ${board.admin_hours_category_name}` : ''}; they never
        count as shift hours.
      </p>

      <AssignSeatDialog
        eventId={board.event_id}
        target={assigning}
        onClose={() => setAssigning(null)}
        onAssigned={(updated) => {
          setAssigning(null);
          setBoard(updated);
        }}
      />
      <EditNightDialog
        board={editing ? board : null}
        onClose={() => setEditing(false)}
        onSaved={(updated) => {
          setEditing(false);
          setBoard(updated);
        }}
        onRemoved={() => {
          setEditing(false);
          setBoard(null);
          setAbsent(true);
        }}
      />
    </section>
  );
};

export default EventApparatusCrewCard;
