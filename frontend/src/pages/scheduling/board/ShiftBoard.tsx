/**
 * The scheduling board: a month of shifts, and the day you have selected.
 *
 * One job — make it obvious which shifts still need people, and make claiming
 * one take a single tap. Everything the calendar and the panel render comes
 * from a single month fetch that carries the roster, so selecting a day costs
 * no request and the colour of a cell is decided from the same data as the
 * seat list beside it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { schedulingService } from '../../../modules/scheduling';
import type { ShiftRecord } from '../../../modules/scheduling';
import type { SwapRequest } from '../../../types/scheduling';
import { StandingShiftPeriod } from '../../../modules/scheduling';
import {
  daySummary,
  monthMatrix,
  shiftPeriodLetter,
  shiftStatusInfo,
  toDateKey,
  weekDates,
  type BoardFilter,
} from '../../../modules/scheduling/utils/shiftBoard';
import { useAuthStore } from '../../../stores/authStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import DayDetailPanel from './DayDetailPanel';
import GiveUpShiftModal from './GiveUpShiftModal';
import MonthGrid from './MonthGrid';
import PhoneDaySheet from './PhoneDaySheet';
import PhoneMonth from './PhoneMonth';
import StandingShiftModal from './StandingShiftModal';
import { STATUS_STYLES, legendFor } from './statusStyles';

/**
 * How often a visible board re-reads its range.
 *
 * Two minutes: long enough that a station full of phones is not hammering the
 * endpoint, short enough that "3 open" on a screen somebody is looking at is
 * not half an hour stale.
 */
const BOARD_REFRESH_MS = 120_000;

/** The Sunday that starts the week containing `date`, as "YYYY-MM-DD". */
const weekStartKey = (date: Date): string => toDateKey(weekDates(date)[0] ?? date);

const FILTERS: { value: BoardFilter; label: string }[] = [
  { value: 'all', label: 'All shifts' },
  { value: 'needs', label: 'Needs staffing' },
  { value: 'mine', label: 'My shifts' },
];

export type BoardView = 'month' | 'week';

export interface ShiftBoardProps {
  /** Month or week; the cells and the panel are the same either way. */
  view: BoardView;
  visibleDate: Date;
  onVisibleDateChange: (date: Date) => void;
  onViewChange: (view: BoardView) => void;
  /**
   * Offered under the grid when the range holds no shifts at all. A month with
   * nothing on it is not an error state — but a department that has never
   * created one needs somewhere to start, and the header button is easy to
   * miss on the first visit.
   */
  emptyAction?: React.ReactNode;
  /**
   * Bumped by the page when something outside the board changed the roster —
   * a shift created from the header, a detail panel closed after an edit.
   * The board owns its data, so this is how it is told to re-read it.
   */
  refreshKey?: number;
  /**
   * Open the full shift detail panel. The board handles claiming and giving
   * up a seat; editing a shift, managing its attendance and finalizing it
   * live in that panel, and an officer looking at a fully staffed shift they
   * are not on needs a way into it from the calendar.
   */
  onViewShift?: ((shift: ShiftRecord) => void) | undefined;
}

export const ShiftBoard: React.FC<ShiftBoardProps> = ({
  view,
  visibleDate,
  onVisibleDateChange,
  onViewChange,
  emptyAction,
  refreshKey = 0,
  onViewShift,
}) => {
  const { user } = useAuthStore();
  const timezone = useTimezone();
  const currentUserId = user?.id ?? null;

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [eligibleByShift, setEligibleByShift] = useState<Record<string, string[]>>({});
  const [pendingShiftId, setPendingShiftId] = useState<string | null>(null);
  const [giveUp, setGiveUp] = useState<{ shift: ShiftRecord; choice: 'drop' | 'trade' } | null>(null);
  const [standingSeed, setStandingSeed] = useState<ShiftRecord | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmedShift, setConfirmedShift] = useState<ShiftRecord | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [myOffers, setMyOffers] = useState<SwapRequest[]>([]);

  const today = useMemo(() => new Date(), []);

  const days = useMemo(
    () => (view === 'week' ? weekDates(visibleDate) : monthMatrix(visibleDate.getFullYear(), visibleDate.getMonth())),
    [view, visibleDate]
  );

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, ShiftRecord[]>();
    for (const shift of shifts) {
      const list = map.get(shift.shift_date);
      if (list) list.push(shift);
      else map.set(shift.shift_date, [shift]);
    }
    return map;
  }, [shifts]);

  const selectedShifts = useMemo(() => shiftsByDate.get(toDateKey(selectedDate)) ?? [], [shiftsByDate, selectedDate]);

  // Only explain the "crew size not set" colour when something on screen is
  // in that state; a correctly configured department never sees the entry.
  const hasUnsizedShift = useMemo(
    () => shifts.some((shift) => shiftStatusInfo(shift, currentUserId).capacity === null),
    [shifts, currentUserId]
  );

  // Pending offers, split by which way they point. Keyed by shift so the seat
  // list can ask "is anything waiting on me here" without scanning.
  const offersToMe = useMemo(() => {
    const map: Record<string, SwapRequest> = {};
    for (const offer of myOffers) {
      if (String(offer.target_user_id ?? '') === String(currentUserId ?? '')) {
        map[offer.offering_shift_id] = offer;
      }
    }
    return map;
  }, [myOffers, currentUserId]);

  const offersFromMe = useMemo(() => {
    const map: Record<string, SwapRequest> = {};
    for (const offer of myOffers) {
      if (String(offer.requesting_user_id ?? '') === String(currentUserId ?? '')) {
        map[offer.offering_shift_id] = offer;
      }
    }
    return map;
  }, [myOffers, currentUserId]);

  const openSeatsThisMonth = useMemo(
    () => shifts.reduce((total, shift) => total + shiftStatusInfo(shift, currentUserId).openSeats, 0),
    [shifts, currentUserId]
  );

  const urgentDaysThisWeek = useMemo(() => {
    const week = weekDates(today).map(toDateKey);
    return week.filter((key) => daySummary(shiftsByDate.get(key) ?? [], currentUserId).openSeats > 0).length;
  }, [shiftsByDate, currentUserId, today]);

  const nextShift = useMemo(() => {
    const todayKey = toDateKey(today);
    return (
      shifts
        .filter((shift) => shift.shift_date >= todayKey && shiftStatusInfo(shift, currentUserId).isMine)
        .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] ?? null
    );
  }, [shifts, currentUserId, today]);

  /**
   * Re-read the visible range. Returns the shifts so a caller that has just
   * mutated the roster can act on the server's answer rather than on the
   * optimistic copy it wrote a moment ago.
   */
  const refresh = useCallback(async (): Promise<ShiftRecord[]> => {
    const [data, offers] = await Promise.all([
      view === 'week'
        ? schedulingService.getWeekCalendar(weekStartKey(visibleDate))
        : schedulingService.getMonthCalendar(visibleDate.getFullYear(), visibleDate.getMonth() + 1),
      // Non-critical: without it the offer banners simply do not appear, and
      // the roster below them is still correct.
      schedulingService.getMySwapRequests('pending').catch(() => [] as SwapRequest[]),
    ]);
    setShifts(data);
    setMyOffers(offers);
    return data;
  }, [view, visibleDate]);

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load the schedule.'));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    void fetchShifts();
  }, [fetchShifts, refreshKey]);

  /**
   * Re-read while the board is on screen.
   *
   * Two members working the same day otherwise see each other's claims only
   * after navigating: the seat counts on a board left open all morning are
   * whatever they were at breakfast, which is exactly when somebody claims the
   * last seat twice. Refreshing on focus covers the common case (tab away,
   * tab back) and the interval covers a board left visible.
   *
   * It is a quiet refresh — no spinner, no error banner — because it is not
   * something the member asked for, and a failed poll is not news. It also
   * holds off while anything is in flight or a modal is open, so it cannot
   * pull the roster out from under a decision being made on it.
   */
  const canQuietlyRefresh = pendingShiftId === null && giveUp === null && standingSeed === null;
  const quietRefreshRef = useRef(canQuietlyRefresh);
  quietRefreshRef.current = canQuietlyRefresh;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible' || !quietRefreshRef.current) return;
      void refresh().catch(() => {
        /* A failed background poll leaves the last good data on screen. */
      });
    };
    const interval = window.setInterval(tick, BOARD_REFRESH_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  // Eligibility only matters for the day on screen, so it is fetched for the
  // selected day rather than the whole month — and in one request rather than
  // one per shift, because the expensive part of the answer (rank, training,
  // the org's open positions) is about the member and identical across them.
  const eligibilityRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    let cancelled = false;
    const missing = selectedShifts.filter((shift) => !(shift.id in eligibilityRef.current));
    if (missing.length === 0) return;

    void schedulingService
      .getEligiblePositionsBulk(missing.map((shift) => shift.id))
      // A failed lookup must not present as "you may take any seat": an empty
      // list disables the claim and says why. Annotated because a bare `{}`
      // widens the union and loses the index signature the lines below need.
      .catch((): Record<string, string[]> => ({}))
      .then((answers) => {
        if (cancelled) return;
        const next = { ...eligibilityRef.current };
        for (const shift of missing) next[shift.id] = answers[shift.id] ?? [];
        eligibilityRef.current = next;
        setEligibleByShift(next);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedShifts]);

  const step = (direction: number) => {
    const next = new Date(visibleDate);
    if (view === 'week') next.setDate(next.getDate() + direction * 7);
    else next.setMonth(next.getMonth() + direction);
    onVisibleDateChange(next);
  };

  const openGiveUp = (shift: ShiftRecord, choice: 'drop' | 'trade' = 'drop') => {
    setGiveUp({ shift, choice });
  };

  const handleSelect = (date: Date) => {
    setSelectedDate(date);
    setConfirmedShift(null);
    setSheetOpen(true);
  };

  const handleClaim = async (shift: ShiftRecord, position: string | null) => {
    const eligible = eligibleByShift[shift.id] ?? [];
    const seat = position ?? eligible[0];
    if (!seat) {
      toast.error('You are not cleared for a seat on this shift.');
      return;
    }

    const before = shifts;
    setPendingShiftId(shift.id);
    // Optimistic: the chip, the badge and the CTA all move at once, because
    // they read the same roster.
    const optimistic = shifts.map((s) =>
      s.id === shift.id
        ? {
            ...s,
            attendee_count: (s.attendee_count ?? 0) + 1,
            roster: [
              ...(s.roster ?? []),
              {
                assignment_id: `pending-${shift.id}`,
                user_id: String(currentUserId),
                user_name: user?.full_name ?? 'You',
                position: seat,
                status: 'assigned',
              },
            ],
          }
        : s
    );
    setShifts(optimistic);

    try {
      await schedulingService.signupForShift(shift.id, { position: seat });
      const fresh = await refresh();
      const updated = fresh.find((s) => s.id === shift.id) ?? shift;
      setConfirmedShift(updated);
      setAnnouncement(
        `You are on the ${formatCalendarDate(shift.shift_date, { month: 'long', day: 'numeric' })} shift.`
      );
      const info = shiftStatusInfo(updated, currentUserId);
      if (info.capacity !== null && info.filled > info.capacity) {
        // An officer can seat a crew past its planned size deliberately, so a
        // member arriving on an over-full shift is told rather than left to
        // read a roster that silently disagrees with the seat count.
        toast('This crew is over its planned size — the duty officer can rebalance it.', { icon: '⚠️' });
      } else {
        toast.success('Seat claimed.');
      }
    } catch (err) {
      setShifts(before);
      // The server is authoritative on whether a seat was still free, and its
      // message names which race was lost — the position going, or the last
      // seat. The fallback only covers a request that never got an answer.
      toast.error(getErrorMessage(err, 'The seat could not be claimed. The calendar has been refreshed.'));
      void fetchShifts();
    } finally {
      setPendingShiftId(null);
    }
  };

  const handleAnswerOffer = async (offer: SwapRequest, accept: boolean) => {
    setPendingShiftId(offer.offering_shift_id);
    try {
      await schedulingService.respondToSwapOffer(offer.id, accept);
      await refresh();
      toast.success(accept ? 'The shift is yours.' : 'Offer declined.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not answer that offer.'));
      void refresh();
    } finally {
      setPendingShiftId(null);
    }
  };

  const handleCancelOffer = async (offer: SwapRequest) => {
    setPendingShiftId(offer.offering_shift_id);
    try {
      await schedulingService.cancelSwapRequest(offer.id);
      await refresh();
      toast.success('Offer withdrawn — the shift is still yours.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not withdraw that offer.'));
    } finally {
      setPendingShiftId(null);
    }
  };

  const handleAddToCalendar = async () => {
    try {
      const feed = await schedulingService.getCalendarFeed();
      await navigator.clipboard.writeText(`${window.location.origin}${feed.feed_path}`);
      toast.success('Calendar link copied — subscribe to it in Google, Apple or Outlook Calendar.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not copy your calendar link.'));
    }
  };

  const rangeLabel =
    view === 'week'
      ? `${formatCalendarDate(toDateKey(days[0] ?? visibleDate), {
          month: 'short',
          day: 'numeric',
        })} – ${formatCalendarDate(toDateKey(days[6] ?? visibleDate), {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`
      : formatCalendarDate(toDateKey(visibleDate), { month: 'long', year: 'numeric' });

  const gridProps = {
    days,
    // The week view's seven days routinely straddle a month boundary, so it
    // must not drop the ones outside the "visible" month.
    visibleMonth: view === 'week' ? null : visibleDate.getMonth(),
    shiftsByDate,
    selectedDate,
    currentUserId,
    timezone,
    filter,
    today,
    hasUnsizedShift,
    onSelect: handleSelect,
  };

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {/* Header: navigation, then the filters. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => step(-1)}
          className="btn-secondary btn-icon-sm"
          aria-label={view === 'week' ? 'Previous week' : 'Previous month'}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          className="btn-secondary btn-icon-sm"
          aria-label={view === 'week' ? 'Next week' : 'Next month'}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <h2 className="text-theme-text-primary min-w-[190px] text-[22px] font-bold">{rangeLabel}</h2>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onVisibleDateChange(new Date());
              setSelectedDate(new Date());
            }}
            className="btn-secondary btn-sm rounded-full px-3.5 text-[13px] font-semibold"
          >
            Today
          </button>
          <div className="segmented-group hscroll flex rounded-full" role="group" aria-label="Calendar filter">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                aria-pressed={filter === option.value}
                className={`min-h-[30px] shrink-0 rounded-full px-3.5 text-[13px] font-semibold transition-colors max-md:min-h-[44px] ${
                  filter === option.value
                    ? 'bg-red-600 text-white'
                    : 'text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Kept as a tablist rather than a pressed-button group: the two
              ranges are alternative views of the same panel, and this is the
              accessible name the page has always exposed. */}
          <div className="segmented-group hidden rounded-full sm:flex" role="tablist" aria-label="Calendar view mode">
            {(['month', 'week'] as BoardView[]).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                onClick={() => onViewChange(option)}
                aria-selected={view === option}
                className={`min-h-[30px] rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                  view === option ? 'bg-red-600 text-white' : 'text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                {option === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="alert-danger mb-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center" role="status" aria-live="polite">
          <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-red-600 dark:text-red-400" aria-hidden="true" />
          <p className="text-theme-text-secondary">Loading the schedule…</p>
        </div>
      ) : (
        <>
          {shifts.length === 0 && emptyAction && (
            <div className="card mb-3 p-6 text-center">
              <p className="text-theme-text-secondary mb-3 text-sm">
                Nothing is scheduled for this {view === 'week' ? 'week' : 'month'} yet.
              </p>
              {emptyAction}
            </div>
          )}

          {/* Phone: grid, then the selected day as a sheet beneath it. */}
          <div className="md:hidden">
            {urgentDaysThisWeek > 0 && (
              <div className="alert-warning mb-3 flex items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  {urgentDaysThisWeek} day{urgentDaysThisWeek === 1 ? '' : 's'} this week still need people
                </p>
              </div>
            )}
            <div className="card p-3">
              <PhoneMonth {...gridProps} />
            </div>
            {sheetOpen && (
              <div className="card mt-3 overflow-hidden">
                <PhoneDaySheet
                  selectedDate={selectedDate}
                  shifts={selectedShifts}
                  currentUserId={currentUserId}
                  timezone={timezone}
                  eligibleByShift={eligibleByShift}
                  pendingShiftId={pendingShiftId}
                  confirmedShift={confirmedShift}
                  onClose={() => setSheetOpen(false)}
                  onClaim={(shift, position) => void handleClaim(shift, position)}
                  onRelease={openGiveUp}
                  onOpenStanding={setStandingSeed}
                  offersToMe={offersToMe}
                  offersFromMe={offersFromMe}
                  onAnswerOffer={(offer, accept) => void handleAnswerOffer(offer, accept)}
                  onCancelOffer={(offer) => void handleCancelOffer(offer)}
                  onAddToCalendar={() => void handleAddToCalendar()}
                  onDismissConfirmation={() => setConfirmedShift(null)}
                  onViewShift={onViewShift}
                />
              </div>
            )}
          </div>

          {/* Desktop: calendar beside the day panel. */}
          <div className="hidden gap-5 md:grid md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_400px]">
            <div className="flex min-h-0 flex-col">
              <div
                className="card mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3.5 py-2.5"
                data-testid="board-legend"
              >
                {legendFor(hasUnsizedShift).map((status) => (
                  <span key={status} className="flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded-sm border ${STATUS_STYLES[status].swatch}`} aria-hidden="true" />
                    <span className="text-theme-text-secondary text-xs">{STATUS_STYLES[status].label}</span>
                  </span>
                ))}
                <span className="text-theme-text-secondary ml-auto text-xs" data-testid="month-open-seats">
                  <span className="font-mono font-bold text-red-700 dark:text-red-400">{openSeatsThisMonth}</span> open
                  seat{openSeatsThisMonth === 1 ? '' : 's'} {view === 'week' ? 'this week' : 'this month'}
                </span>
              </div>
              <MonthGrid {...gridProps} />
            </div>

            <DayDetailPanel
              selectedDate={selectedDate}
              shifts={selectedShifts}
              nextShift={nextShift}
              currentUserId={currentUserId}
              timezone={timezone}
              eligibleByShift={eligibleByShift}
              pendingShiftId={pendingShiftId}
              onClaim={(shift, position) => void handleClaim(shift, position)}
              onRelease={openGiveUp}
              onOpenStanding={setStandingSeed}
              offersToMe={offersToMe}
              offersFromMe={offersFromMe}
              onAnswerOffer={(offer, accept) => void handleAnswerOffer(offer, accept)}
              onCancelOffer={(offer) => void handleCancelOffer(offer)}
              onViewShift={onViewShift}
            />
          </div>
        </>
      )}

      {giveUp && (
        <GiveUpShiftModal
          shift={giveUp.shift}
          initialChoice={giveUp.choice}
          currentUserId={currentUserId}
          timezone={timezone}
          onClose={() => setGiveUp(null)}
          onChanged={() => void refresh()}
        />
      )}

      {standingSeed && (
        <StandingShiftModal
          initialWeekday={new Date(`${standingSeed.shift_date}T12:00:00`).getDay()}
          initialPeriod={
            shiftPeriodLetter(standingSeed, timezone) === 'N' ? StandingShiftPeriod.NIGHT : StandingShiftPeriod.DAY
          }
          initialPosition={
            (standingSeed.roster ?? []).find((seat) => String(seat.user_id) === String(currentUserId))?.position ??
            eligibleByShift[standingSeed.id]?.[0] ??
            'firefighter'
          }
          apparatusId={standingSeed.apparatus_id}
          // The series is anchored on the shift the member tapped, not on
          // today. Biweekly parity and the monthly ordinal are both read off
          // the first matching weekday from the start date, so anchoring on
          // today builds a fortnight that skips the very shift they opened
          // this from, and turns "the first Sunday" into whichever ordinal
          // this week happens to be.
          anchorDate={standingSeed.shift_date}
          timezone={timezone}
          onClose={() => setStandingSeed(null)}
          onCreated={() => void refresh()}
        />
      )}
    </div>
  );
};

export default ShiftBoard;
