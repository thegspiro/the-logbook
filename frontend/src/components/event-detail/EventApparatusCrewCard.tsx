/**
 * Apparatus & Crew — the seats on an apparatus night, on the event page.
 *
 * Renders nothing for an ordinary event: the board answers 404 there, which
 * is the signal, not an error. A member takes or leaves an open seat — or,
 * on a night whose sign-ups need approval, asks for one and waits; a
 * coordinator also answers those requests, assigns, clears and reshapes the
 * night. Check-in and the
 * Finalize step that posts the crew's hours stay where they already are on
 * this page, so there is one way to confirm attendance, not two.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import { Check, CheckCircle2, Clock, Megaphone, Pencil, Truck, UserMinus, UserPlus, X } from 'lucide-react';
import { apparatusEventService } from '../../services/api';
import {
  ApparatusEventSeatType,
  type CrewBoard,
  type CrewSeat,
  type CrewUnit,
  type SeatRequest,
} from '../../types/apparatusEvent';
import { useConfirm } from '../../contexts/ConfirmContext';
import { formatCalendarDate, formatShortDateTime, toLocalDateString } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { PromptDialog } from '../ux/PromptDialog';
import {
  EVOC_MODE_LABEL,
  EVOC_MODE_TONE,
  TONE,
  readinessLabel,
  readinessTone,
} from '../../pages/apparatus-events/tones';
import AssignSeatDialog from './apparatus-crew/AssignSeatDialog';
import EditNightDialog from './apparatus-crew/EditNightDialog';
import SeatCallDialog from './apparatus-crew/SeatCallDialog';
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
  const [emailing, setEmailing] = useState(false);
  const [declining, setDeclining] = useState<{ request: SeatRequest; label: string } | null>(null);
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [declineBusy, setDeclineBusy] = useState(false);

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
  const started = new Date(board.start_datetime).getTime() <= Date.now();
  const asks = board.require_signup_approval;
  const canTake =
    !closed &&
    !ended &&
    !(asks && started) &&
    board.can_sign_up &&
    board.allow_self_signup &&
    board.my_seat_id === null &&
    board.my_request === null;
  // Approval and decline are refused once a night starts; what is still
  // waiting then lapses on its own and the member is emailed.
  const canAnswer = board.can_manage && !closed && !started;
  const waiting = board.units.reduce((n, u) => n + u.seats.reduce((m, s) => m + s.requests.length, 0), 0);
  const filled = board.units.reduce((n, u) => n + u.seats.filter((s) => s.user_id).length, 0);
  const total = board.units.reduce((n, u) => n + u.seats.length, 0);
  const essentialSeats = board.units.flatMap((u) => u.seats.filter((s) => s.is_essential));
  const essentialFilled = essentialSeats.filter((s) => s.user_id).length;

  const act = async (
    seatId: string,
    action: () => Promise<CrewBoard>,
    done: string | ((updated: CrewBoard) => string)
  ) => {
    setPendingSeat(seatId);
    try {
      const updated = await action();
      updated.warnings.forEach((w) => toast(w.message, { icon: '⚠️' }));
      toast.success(typeof done === 'string' ? done : done(updated));
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
      title: mine ? 'Give up your spot?' : `Clear ${label}?`,
      message: mine
        ? `You come off the ${label} seat on this night, and your RSVP changes to not going.`
        : `${seat.user_name ?? 'This member'} comes off the ${label} seat, and their RSVP changes to not going.`,
      confirmLabel: mine ? 'Give up my spot' : 'Clear seat',
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
      mine ? 'You gave up your spot' : 'Seat cleared'
    );
  };

  const decline = async (note: string) => {
    if (!declining) return;
    setDeclineBusy(true);
    setDeclineError(null);
    try {
      setBoard(await apparatusEventService.declineRequest(board.event_id, declining.request.id, note || undefined));
      toast.success('Request declined. The member is emailed.');
      setDeclining(null);
    } catch (err) {
      setDeclineError(getErrorMessage(err, 'Could not decline the request.'));
    } finally {
      setDeclineBusy(false);
    }
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
            {board.template_name ? ` · from “${board.template_name}”` : ''} ·{' '}
            {readinessLabel(essentialFilled, essentialSeats.length, filled, total)}
          </p>
        </div>
        {board.can_manage && !closed && (
          <div className="flex flex-wrap gap-2">
            {!ended && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => setEmailing(true)}>
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                Email members
              </button>
            )}
            <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Edit this night
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`badge ${TONE.slate}`}>Outreach · not a shift</span>
        <span className={`badge ${EVOC_MODE_TONE[board.evoc_mode]}`}>{EVOC_MODE_LABEL[board.evoc_mode]}</span>
        <span className={`badge ${TONE.slate}`}>Hours: {board.admin_hours_category_name ?? 'by event type'}</span>
        {asks && board.allow_self_signup && <span className={`badge ${TONE.amber}`}>Sign-ups need approval</span>}
        {board.can_manage && waiting > 0 && (
          <span className={`badge ${TONE.amber}`}>
            {waiting} {waiting === 1 ? 'request' : 'requests'} waiting
          </span>
        )}
      </div>

      {board.my_request && !closed && (
        <div className="alert-info mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" role="status">
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4" aria-hidden="true" />
            You asked for the {board.my_request.seat_name} seat. The coordinator will approve or decline it, and you’ll
            be emailed either way.
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={pendingSeat === board.my_request.seat_id}
            onClick={() => {
              const request = board.my_request;
              if (!request) return;
              void act(
                request.seat_id,
                () => apparatusEventService.withdrawRequest(board.event_id, request.id),
                'Request withdrawn'
              );
            }}
          >
            Withdraw request
          </button>
        </div>
      )}

      {board.last_seat_call && (
        <p className="text-theme-text-muted mt-2 text-xs">
          Members last emailed about open seats {formatShortDateTime(board.last_seat_call.sent_at, timezone)} ·{' '}
          {board.last_seat_call.recipients} {board.last_seat_call.recipients === 1 ? 'member' : 'members'}
          {board.last_seat_call.sent_by_name ? ` · by ${board.last_seat_call.sent_by_name}` : ''}
        </p>
      )}

      {board.series.length > 1 && (
        <nav className="mt-3 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Other nights in this run">
          <span className="text-theme-text-muted">Nights:</span>
          {board.series.map((night) => {
            const current = night.event_id === board.event_id;
            const day = formatCalendarDate(toLocalDateString(new Date(night.start_datetime), timezone), {
              month: 'short',
              day: 'numeric',
            });
            // Coloured by how full each night is, as in the night list; the
            // night on screen is marked with a ring, not with red, which read
            // as "this one needs people" whatever its count.
            return current ? (
              <span
                key={night.event_id}
                className={`badge ring-theme-text-primary ring-2 ring-offset-1 ${readinessTone(night.essential_filled, night.essential_total, night.filled, night.total)}`}
                aria-current="page"
              >
                {day} · {night.filled}/{night.total}
              </span>
            ) : (
              <Link
                key={night.event_id}
                to={`/events/${night.event_id}`}
                className={`badge hover:underline ${readinessTone(night.essential_filled, night.essential_total, night.filled, night.total)}`}
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
                      // The same row the shift crew board and the volunteer
                      // seat board draw (owner request, 2026-11-23): who holds
                      // the seat, or that it is open, and the seat beneath.
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 sm:p-3 ${
                        seat.user_id
                          ? seat.is_me
                            ? 'border-violet-500/30 bg-violet-500/5'
                            : 'border-theme-surface-border bg-theme-surface-hover/30'
                          : 'border-theme-surface-border bg-theme-surface-hover/10 border-dashed'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                        {seat.user_id ? (
                          <div
                            className="bg-theme-surface-hover text-theme-text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium"
                            aria-hidden="true"
                          >
                            {(seat.user_name ?? '?').charAt(0).toUpperCase()}
                          </div>
                        ) : (
                          <div
                            className="border-theme-surface-border flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-dashed"
                            aria-hidden="true"
                          >
                            <UserPlus className="text-theme-text-muted h-3.5 w-3.5" />
                          </div>
                        )}
                        <div className="min-w-0 text-sm">
                          {seat.user_id ? (
                            <p className="text-theme-text-primary font-medium">
                              {seat.user_name ?? 'A member'}
                              {seat.is_me && (
                                <span className="ml-1 text-xs text-violet-700 dark:text-violet-300">(You)</span>
                              )}
                              {seat.checked_in && (
                                <span className={`badge ml-2 ${TONE.green}`}>
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                  Checked in
                                </span>
                              )}
                            </p>
                          ) : (
                            <p className="text-theme-text-muted">{label}</p>
                          )}
                          <p className="text-theme-text-muted text-xs">
                            {seat.user_id ? label : seat.is_essential ? 'Open position' : 'Optional position'}
                            {seat.user_id && !seat.is_essential && ' (optional)'}
                            {seat.seat_type === ApparatusEventSeatType.DRIVER && (
                              <span className={`badge ml-2 ${TONE.red}`}>Driver · EVOC</span>
                            )}
                            {board.my_request?.seat_id === seat.id && (
                              <span className={`badge ml-2 ${TONE.amber}`}>Your request is waiting</span>
                            )}
                          </p>
                          {seat.note && <p className="text-theme-text-muted mt-0.5 text-xs">{seat.note}</p>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        {seat.is_me && !closed && !seat.checked_in && (
                          <button
                            type="button"
                            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 sm:px-3"
                            disabled={busy}
                            aria-label={`Give up my spot as ${label}`}
                            onClick={() => void leave(seat, label, true)}
                          >
                            <UserMinus className="h-3 w-3" aria-hidden="true" />
                            <span className="hidden sm:inline">Give up my spot</span>
                            <span className="sm:hidden">Give up</span>
                          </button>
                        )}
                        {board.can_manage && !closed && !seat.user_id && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 px-2.5 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-500/10 disabled:opacity-50 sm:px-3 dark:text-violet-300"
                            disabled={busy}
                            aria-label={`Assign someone as ${label}`}
                            onClick={() => setAssigning({ unit, seat, label })}
                          >
                            <UserPlus className="h-3 w-3" aria-hidden="true" />
                            <span className="hidden sm:inline">Assign someone</span>
                            <span className="sm:hidden">Assign</span>
                          </button>
                        )}
                        {!seat.user_id && canTake && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50 sm:px-3"
                            disabled={busy}
                            aria-label={asks ? `Ask for this seat as ${label}` : `Sign myself up as ${label}`}
                            onClick={() =>
                              void act(
                                seat.id,
                                () => apparatusEventService.claimSeat(board.event_id, seat.id),
                                (updated) =>
                                  updated.my_request
                                    ? `You asked for ${label}. The coordinator will answer it.`
                                    : `You’re on the crew as ${label}`
                              )
                            }
                          >
                            <UserPlus className="h-3 w-3" aria-hidden="true" />
                            <span className="hidden sm:inline">{asks ? 'Ask for this seat' : 'Sign myself up'}</span>
                            <span className="sm:hidden">{asks ? 'Ask' : 'Sign up'}</span>
                          </button>
                        )}
                        {board.can_manage && !closed && seat.user_id && (
                          <button
                            type="button"
                            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 sm:px-3"
                            disabled={busy || seat.checked_in}
                            onClick={() => setAssigning({ unit, seat, label })}
                          >
                            Change…
                          </button>
                        )}
                        {board.can_manage && !closed && seat.user_id && !seat.is_me && !seat.checked_in && (
                          <button
                            type="button"
                            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50 sm:px-3"
                            disabled={busy}
                            onClick={() => void leave(seat, label, false)}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      {seat.requests.length > 0 && (
                        <div className="border-theme-surface-border border-t pt-2 sm:col-span-3">
                          <p className="text-theme-text-muted text-xs font-semibold">
                            Waiting for your answer, first asked first
                          </p>
                          <ul className="mt-1 space-y-1">
                            {seat.requests.map((request) => (
                              <li
                                key={request.id}
                                className="flex flex-wrap items-center justify-between gap-2 text-sm"
                              >
                                <span className="text-theme-text-primary min-w-0">
                                  {request.user_name ?? 'A member'}
                                  <span className="text-theme-text-muted ml-2 text-xs">
                                    asked {formatShortDateTime(request.requested_at, timezone)}
                                  </span>
                                </span>
                                {canAnswer && (
                                  <span className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      className="btn-primary btn-sm"
                                      disabled={busy || Boolean(seat.user_id)}
                                      aria-label={`Approve ${request.user_name ?? 'this member'} for ${label}`}
                                      onClick={() =>
                                        void act(
                                          seat.id,
                                          () => apparatusEventService.approveRequest(board.event_id, request.id),
                                          `${request.user_name ?? 'The member'} is on the crew as ${label}`
                                        )
                                      }
                                    >
                                      <Check className="h-4 w-4" aria-hidden="true" />
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary btn-sm"
                                      disabled={busy}
                                      aria-label={`Decline ${request.user_name ?? 'this member'} for ${label}`}
                                      onClick={() => {
                                        setDeclineError(null);
                                        setDeclining({ request, label });
                                      }}
                                    >
                                      <X className="h-4 w-4" aria-hidden="true" />
                                      Decline
                                    </button>
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Where the hours go and that this is not a shift are the badges above. */}
      <p className="text-theme-text-muted mt-4 text-xs">
        Crew check in on the night like any event. Finalizing attendance on this page confirms the crew and posts their
        hours.
      </p>

      <PromptDialog
        isOpen={declining !== null}
        onClose={() => setDeclining(null)}
        onSubmit={(note) => void decline(note)}
        title="Decline this request?"
        message={
          declining
            ? `${declining.request.user_name ?? 'The member'} is emailed that they did not get the ${declining.label} seat.`
            : undefined
        }
        label="Note to the member (optional)"
        required={false}
        multiline
        hint="Up to 300 characters, sent in the email."
        confirmLabel="Decline request"
        cancelLabel="Keep it waiting"
        confirmVariant="warning"
        loading={declineBusy}
        error={declineError}
      />
      <AssignSeatDialog
        eventId={board.event_id}
        target={assigning}
        onClose={() => setAssigning(null)}
        onAssigned={(updated) => {
          setAssigning(null);
          setBoard(updated);
        }}
      />
      <SeatCallDialog
        eventId={emailing ? board.event_id : null}
        runTitle={board.title}
        onClose={() => setEmailing(false)}
        onSent={() => {
          setEmailing(false);
          void load();
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
