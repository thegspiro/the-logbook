/**
 * Staffing gaps — the shifts that need somebody, and a way to be that somebody.
 *
 * Filling a gap used to mean reading the month grid for a red cell, opening the
 * day, opening the shift, and assigning — once per shift. This lists every
 * short shift over a range and puts the assignment on the row.
 *
 * What counts as short is `staffingGaps`, which reads the board's own capacity
 * and seat rules so this screen cannot come to a different answer about a shift
 * than the calendar does.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarRange, Loader2, RefreshCw, Users } from 'lucide-react';
import { schedulingService } from '../../../../modules/scheduling/services/api';
import type { ShiftRecord } from '../../../../modules/scheduling/services/api';
import { useSchedulingStore } from '../../../../modules/scheduling/store/schedulingStore';
import { staffingGaps, totalOpenSeats, type StaffingGap } from '../../../../modules/scheduling/utils/staffingGaps';
import { positionLabel } from '../../../../modules/scheduling/utils/positionLabels';
import { formatCalendarDate, formatTime } from '../../../../utils/dateFormatting';
import { useTimezone } from '../../../../hooks/useTimezone';
import { getErrorMessage, toAppError } from '../../../../utils/errorHandling';
import { EmptyState } from '../../../../components/ux/EmptyState';
import { DriverBlockedDialog } from '../../DriverBlockedDialog';

/** The support code the backend returns when a driver lacks the EVOC the apparatus requires. */
const DRIVER_NOT_QUALIFIED_CODE = 'LB-SCHED-001';

/** How far ahead the range runs by default. Two weeks is a crew rotation and a bit. */
const DEFAULT_HORIZON_DAYS = 14;

/** Shifts fetched per request. The endpoint pages; a planning range is not a year. */
const FETCH_LIMIT = 200;

const isoDay = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

/** A seat an officer can put somebody in: its position token, or null for an unnamed one. */
interface SeatChoice {
  key: string;
  position: string | null;
  label: string;
}

const seatChoices = (gap: StaffingGap): SeatChoice[] =>
  gap.vacancies.map((seat, index) => ({
    key: `${seat.position ?? 'any'}-${index}`,
    position: seat.position,
    // An unnamed seat still has to be assigned *some* position — the column is
    // not nullable — and firefighter is what the board's own one-click claim
    // uses for the same case.
    label: seat.position ? positionLabel(seat.position) : 'Open seat',
  }));

const StaffingGapsSection: React.FC = () => {
  const timezone = useTimezone();
  const members = useSchedulingStore((s) => s.members);
  const membersLoaded = useSchedulingStore((s) => s.membersLoaded);
  const loadMembers = useSchedulingStore((s) => s.loadMembers);

  const [from, setFrom] = useState(() => isoDay(new Date()));
  const [to, setTo] = useState(() => isoDay(addDays(new Date(), DEFAULT_HORIZON_DAYS)));
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, { userId: string; seat: string }>>({});
  const [driverBlock, setDriverBlock] = useState<{
    userId: string;
    userName: string;
    reason: string;
    shift: ShiftRecord;
  } | null>(null);

  useEffect(() => {
    if (!membersLoaded) void loadMembers();
  }, [membersLoaded, loadMembers]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const result = await schedulingService.getShifts({ start_date: from, end_date: to, limit: FETCH_LIMIT });
      setShifts(result.shifts);
    } catch {
      // Said rather than swallowed: an empty list and "nothing is short" are the
      // same picture, and one of them is a lie an officer would act on.
      setFailed(true);
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const gaps = useMemo(() => staffingGaps(shifts), [shifts]);
  const openSeats = totalOpenSeats(gaps);

  const memberName = (userId: string) => members.find((m) => m.id === userId)?.label ?? 'This member';

  const handleAssign = async (gap: StaffingGap) => {
    const picked = choice[gap.shift.id];
    if (!picked?.userId) return;
    const seat = seatChoices(gap).find((entry) => entry.key === picked.seat);

    setAssigning(gap.shift.id);
    try {
      const res = await schedulingService.createAssignment(gap.shift.id, {
        user_id: picked.userId,
        position: seat?.position ?? 'firefighter',
      });
      // Same warnings the shift drawer surfaces, from the same response fields:
      // an EVOC or overtime advisory is not a refusal, and losing it here would
      // make this the one screen that seats somebody silently.
      const messages = [...(res.evoc_warnings ?? []).map((w) => w.message), ...(res.overtime_warnings ?? [])];
      if (messages.length > 0) toast(messages.join(' '), { icon: '⚠️' });
      toast.success(`${memberName(picked.userId)} assigned`);
      setChoice((current) => {
        const next = { ...current };
        delete next[gap.shift.id];
        return next;
      });
      await load();
    } catch (err) {
      const appError = toAppError(err);
      if (appError.code === DRIVER_NOT_QUALIFIED_CODE) {
        setDriverBlock({
          userId: picked.userId,
          userName: memberName(picked.userId),
          reason: appError.message,
          shift: gap.shift,
        });
      } else {
        toast.error(getErrorMessage(err, 'Failed to assign member'));
      }
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-theme-text-muted text-xs font-medium">From</span>
          <input
            type="date"
            className="form-input px-3 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-theme-text-muted text-xs font-medium">To</span>
          <input type="date" className="form-input px-3 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-secondary mobile-touch-target inline-flex items-center gap-2 px-3 text-sm font-medium"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
        <p className="text-theme-text-muted min-w-0 flex-1 text-right text-sm" role="status" aria-live="polite">
          {loading
            ? 'Checking…'
            : failed
              ? ''
              : `${gaps.length} shift${gaps.length === 1 ? '' : 's'} short · ${openSeats} seat${
                  openSeats === 1 ? '' : 's'
                } open`}
        </p>
      </div>

      {failed && (
        <div className="alert-warning flex items-center gap-2 text-sm" role="alert">
          <span className="flex-1">
            The schedule for this range did not load, so nothing below is a complete answer.
          </span>
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      )}

      {!loading && !failed && gaps.length === 0 && (
        <EmptyState
          icon={CalendarRange}
          title="Every shift in this range has the crew it asks for"
          description="A shift that names neither positions nor a minimum staffing level is not counted here — it has never said how big its crew is, so nothing can say it is short."
        />
      )}

      {!loading &&
        gaps.map((gap) => {
          const seats = seatChoices(gap);
          const picked = choice[gap.shift.id];
          const busy = assigning === gap.shift.id;
          return (
            <div key={gap.shift.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-theme-text-primary text-sm font-semibold">
                    {formatCalendarDate(gap.shift.shift_date, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {' · '}
                    {formatTime(gap.shift.start_time, timezone)}
                    {gap.shift.end_time ? ` – ${formatTime(gap.shift.end_time, timezone)}` : ''}
                  </h3>
                  <p className="text-theme-text-muted mt-0.5 text-xs">
                    {gap.shift.apparatus_unit_number || gap.shift.apparatus_name || 'No apparatus'}
                    {gap.shift.shift_officer_name ? ` · ${gap.shift.shift_officer_name}` : ''}
                  </p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {gap.openSeats} of {gap.capacity} open
                </span>
              </div>

              <p className="text-theme-text-muted text-xs">
                <Users className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true" />
                {gap.filled} on the crew · empty: {seats.map((seat) => seat.label).join(', ')}
              </p>

              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-theme-text-muted text-xs font-medium">Assign a member</span>
                  <select
                    className="form-input px-3 text-sm"
                    value={picked?.userId ?? ''}
                    onChange={(e) =>
                      setChoice((current) => ({
                        ...current,
                        [gap.shift.id]: {
                          userId: e.target.value,
                          seat: current[gap.shift.id]?.seat ?? seats[0]?.key ?? '',
                        },
                      }))
                    }
                  >
                    <option value="">Select a member…</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-theme-text-muted text-xs font-medium">Seat</span>
                  <select
                    className="form-input px-3 text-sm"
                    value={picked?.seat ?? seats[0]?.key ?? ''}
                    onChange={(e) =>
                      setChoice((current) => ({
                        ...current,
                        [gap.shift.id]: { userId: current[gap.shift.id]?.userId ?? '', seat: e.target.value },
                      }))
                    }
                  >
                    {seats.map((seat) => (
                      <option key={seat.key} value={seat.key}>
                        {seat.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void handleAssign(gap)}
                  disabled={busy || !picked?.userId}
                  className="btn-primary mobile-touch-target inline-flex items-center gap-2 px-4 text-sm font-semibold disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {busy ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            </div>
          );
        })}

      {driverBlock && (
        <DriverBlockedDialog
          isOpen
          onClose={() => setDriverBlock(null)}
          userId={driverBlock.userId}
          userName={driverBlock.userName}
          apparatusId={driverBlock.shift.apparatus_id}
          apparatusUnitNumber={driverBlock.shift.apparatus_unit_number}
          shiftDate={driverBlock.shift.shift_date}
          blockedReason={driverBlock.reason}
        />
      )}
    </div>
  );
};

export default StaffingGapsSection;
