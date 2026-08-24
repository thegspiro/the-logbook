/**
 * Setting up a standing shift — the same seat, on a repeating schedule.
 *
 * The preview panel is the point of the screen. A member agreeing to "every
 * Tuesday night through December" is agreeing to a number of specific dates,
 * and the button says what that number is before they press it; the dates
 * that cannot be claimed are shown too, rather than quietly dropped from the
 * count afterwards.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { Modal } from '../../../components/Modal';
import { schedulingService } from '../../../modules/scheduling';
import { StandingShiftPattern, StandingShiftPeriod, type StandingShiftPreview } from '../../../modules/scheduling';
import {
  defaultSeriesEnd,
  describeCoverage,
  seriesEndBounds,
  seriesEndError,
} from '../../../modules/scheduling/utils/standingShift';
import { formatCalendarDate, getTodayLocalDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

/** Dates shown in full before the rest are summarised. */
const PREVIEW_LIMIT = 8;

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PATTERN_OPTIONS: { value: StandingShiftPattern; label: string }[] = [
  { value: StandingShiftPattern.WEEKLY, label: 'Every week' },
  { value: StandingShiftPattern.BIWEEKLY, label: 'Every other week' },
  { value: StandingShiftPattern.MONTHLY, label: 'Once a month' },
];

export interface StandingShiftModalProps {
  /** Seeded from the shift the member was looking at. */
  initialWeekday: number;
  initialPeriod: StandingShiftPeriod;
  initialPosition: string;
  apparatusId?: string | undefined;
  /**
   * The date of the shift this was opened from — the series' anchor.
   *
   * It is not the same as today, and the difference is the whole point: both
   * the biweekly parity and the monthly ordinal are read off the first
   * matching weekday on or after the start date. Anchoring on today builds a
   * fortnight that skips the shift the member opened this from, and turns
   * "the first Sunday of the month" into whichever ordinal the current week
   * happens to be.
   */
  anchorDate?: string | undefined;
  timezone: string;
  onClose: () => void;
  onCreated: () => void;
}

export const StandingShiftModal: React.FC<StandingShiftModalProps> = ({
  initialWeekday,
  initialPeriod,
  initialPosition,
  apparatusId,
  anchorDate,
  timezone,
  onClose,
  onCreated,
}) => {
  const today = useMemo(() => getTodayLocalDate(timezone), [timezone]);
  // A past anchor cannot start a series — nothing before today can be
  // claimed — so it falls back to today rather than generating a run of dates
  // that are all already gone.
  const seriesStart = useMemo(() => (anchorDate && anchorDate > today ? anchorDate : today), [anchorDate, today]);
  // Bounds key off the start, not today: a series starting three weeks out
  // whose minimum end is a week from *today* could be given an end date
  // before its own first date.
  const bounds = useMemo(() => seriesEndBounds(seriesStart), [seriesStart]);

  const [pattern, setPattern] = useState<StandingShiftPattern>(StandingShiftPattern.WEEKLY);
  const [weekday, setWeekday] = useState(initialWeekday);
  const [period, setPeriod] = useState<StandingShiftPeriod>(initialPeriod);
  const [endDate, setEndDate] = useState(() => defaultSeriesEnd(seriesStart));
  const [preview, setPreview] = useState<StandingShiftPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const endDateError = seriesEndError(seriesStart, endDate);

  const loadPreview = useCallback(() => {
    // An out-of-range date is refused by the picker's own message; asking the
    // server about it would replace that with a less specific 400.
    if (seriesEndError(seriesStart, endDate)) {
      setLoading(false);
      setPreview(null);
      return;
    }
    setLoading(true);
    setError(null);
    schedulingService
      .previewStandingShift({
        pattern,
        weekday,
        period,
        start_date: seriesStart,
        end_date: endDate,
        apparatus_id: apparatusId || undefined,
      })
      .then(setPreview)
      .catch((err: unknown) => {
        setError(getErrorMessage(err, 'Could not work out which dates this covers.'));
        setPreview(null);
      })
      .finally(() => setLoading(false));
  }, [apparatusId, endDate, pattern, period, seriesStart, weekday]);

  useEffect(() => loadPreview(), [loadPreview]);

  const claimable = preview?.claimable_count ?? 0;
  const conflicts = preview?.conflict_count ?? 0;
  const missing = preview?.missing_count ?? 0;
  const dates = preview?.dates ?? [];
  // A series with nothing to claim *today* is still worth storing: shift
  // creation reads active claims and seats the member on matching shifts as
  // they are generated, which is exactly the case for a member setting up
  // "every Tuesday night" past the end of the schedule the department has
  // published. Only a range that covers no matching date at all has nothing
  // to store.
  const canSave = dates.length > 0 && endDateError === null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await schedulingService.createStandingShift({
        pattern,
        weekday,
        period,
        position: initialPosition,
        start_date: seriesStart,
        end_date: endDate,
        apparatus_id: apparatusId || undefined,
      });
      toast.success(
        result.claimed > 0
          ? `Standing shift saved — ${result.claimed} date${result.claimed === 1 ? '' : 's'} claimed.`
          : 'Standing shift saved. Matching shifts will be claimed as they are scheduled.'
      );
      onCreated();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not save the standing shift.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Add a standing shift"
      size="md"
      titleId="standing-shift-title"
      footer={
        <>
          <button
            type="button"
            disabled={saving || loading || !canSave}
            onClick={() => void handleSave()}
            className="btn-primary min-h-[42px] rounded-lg"
          >
            {saving && <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />}
            {dates.length === 0
              ? 'No dates in this range'
              : claimable > 0
                ? `Add ${claimable} shift${claimable === 1 ? '' : 's'}`
                : missing > 0
                  ? `Save for ${missing} upcoming date${missing === 1 ? '' : 's'}`
                  : 'Save this standing shift'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary min-h-[42px] rounded-lg">
            Cancel
          </button>
        </>
      }
    >
      <p className="text-theme-text-secondary mb-4 text-[13px]">
        Claim the same shift on a repeating schedule. You can still give up any single date.
      </p>

      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="text-theme-text-muted mb-1.5 text-[10px] font-bold tracking-[0.12em] uppercase">
            Repeats
          </legend>
          <div className="flex flex-wrap gap-2">
            {PATTERN_OPTIONS.map((option) => (
              <Segment
                key={option.value}
                selected={pattern === option.value}
                onSelect={() => setPattern(option.value)}
                label={option.label}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-theme-text-muted mb-1.5 text-[10px] font-bold tracking-[0.12em] uppercase">
            Day of the week
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, index) => (
              <button
                key={WEEKDAY_NAMES[index]}
                type="button"
                onClick={() => setWeekday(index)}
                aria-pressed={weekday === index}
                aria-label={WEEKDAY_NAMES[index]}
                className={`h-11 w-11 rounded-lg border text-sm font-bold transition-colors ${
                  weekday === index
                    ? 'border-red-800 bg-red-800 text-white'
                    : 'border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-theme-text-muted mb-1.5 text-[10px] font-bold tracking-[0.12em] uppercase">
            Shift
          </legend>
          <div className="flex flex-wrap gap-2">
            <Segment
              selected={period === StandingShiftPeriod.DAY}
              onSelect={() => setPeriod(StandingShiftPeriod.DAY)}
              label="Day · starts before noon"
            />
            <Segment
              selected={period === StandingShiftPeriod.NIGHT}
              onSelect={() => setPeriod(StandingShiftPeriod.NIGHT)}
              label="Night · starts from noon"
            />
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-theme-text-muted mb-1.5 text-[10px] font-bold tracking-[0.12em] uppercase">
            Runs until
          </legend>
          <input
            type="date"
            value={endDate}
            min={bounds.min}
            max={bounds.max}
            onChange={(event) => setEndDate(event.target.value)}
            className="form-input w-full sm:w-56"
            aria-label="Last date this standing shift covers"
            aria-invalid={endDateError !== null}
            {...(endDateError ? { 'aria-describedby': 'standing-end-error' } : {})}
          />
          {endDateError ? (
            <p id="standing-end-error" className="mt-1 text-xs font-semibold text-red-700 dark:text-red-300">
              {endDateError}
            </p>
          ) : (
            <p className="text-theme-text-muted mt-1 text-xs">
              You can end the series early at any time, and giving up one date never ends it.
            </p>
          )}
        </fieldset>

        <section className="card-secondary p-4" aria-live="polite">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-theme-text-primary text-sm font-bold">
              {PATTERN_OPTIONS.find((option) => option.value === pattern)?.label} · {WEEKDAY_NAMES[weekday]} ·{' '}
              {period === StandingShiftPeriod.NIGHT ? 'Night' : 'Day'}
            </p>
            <p className="text-theme-text-secondary text-xs">
              through {formatCalendarDate(endDate, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>

          {loading && (
            <p className="text-theme-text-muted flex items-center gap-2 py-2 text-sm" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Working out the dates…
            </p>
          )}
          {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}

          {!loading && !error && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {dates.slice(0, PREVIEW_LIMIT).map((entry) => (
                  <span
                    key={entry.date}
                    title={PREVIEW_STATUS_TITLES[entry.status]}
                    className={`rounded-full border px-2.5 py-1 font-mono text-xs font-semibold ${
                      entry.status === 'available'
                        ? 'border-theme-surface-border bg-theme-surface text-theme-text-primary'
                        : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300'
                    }`}
                  >
                    {formatCalendarDate(entry.date, { month: 'short', day: 'numeric' })}
                  </span>
                ))}
                {dates.length > PREVIEW_LIMIT && (
                  <span className="text-theme-text-muted self-center text-xs">
                    +{dates.length - PREVIEW_LIMIT} more
                  </span>
                )}
                {dates.length === 0 && (
                  <span className="text-theme-text-muted text-xs">
                    No {WEEKDAY_NAMES[weekday]}s left in the year on that schedule.
                  </span>
                )}
              </div>

              {dates.length > 0 && (
                <p
                  className={`mt-2.5 text-xs font-semibold ${
                    conflicts > 0 || missing > 0
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-green-700 dark:text-green-400'
                  }`}
                >
                  {describeCoverage(claimable, conflicts, missing)}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </Modal>
  );
};

const PREVIEW_STATUS_TITLES: Record<string, string> = {
  available: 'Will be claimed',
  conflict: 'Skipped — you already hold a shift that day',
  already_yours: 'Already yours',
  no_shift: 'No shift scheduled that day yet',
};

const Segment: React.FC<{ selected: boolean; onSelect: () => void; label: string }> = ({
  selected,
  onSelect,
  label,
}) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    className={`min-h-[38px] rounded-lg border px-3.5 text-[13px] font-semibold transition-colors ${
      selected
        ? 'border-2 border-red-600 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-500/10 dark:text-red-300'
        : 'border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
    }`}
  >
    {label}
  </button>
);

export default StandingShiftModal;
