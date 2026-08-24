/**
 * The horizon a standing series runs to, and the copy describing it.
 *
 * Lives apart from the modal so both are testable on their own — the horizon
 * decides how many dates a member is committing to, and the sentence is what
 * they read before agreeing to them.
 */

/**
 * The longest series the server will accept, in days.
 *
 * Mirrors ``MAX_SERIES_DAYS`` in ``app/services/standing_shift_service.py``.
 * Duplicated rather than fetched because the picker has to bound its own date
 * input before anything is sent: a member who types a date three years out
 * should see why it is refused while they are choosing it, not after they
 * press save.
 */
export const MAX_SERIES_DAYS = 366;

const addDays = (isoDate: string, days: number): string => {
  // Anchored at UTC midnight: a calendar date belongs to no timezone, and
  // parsing one as local midnight then formatting it back can shift the day.
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * How far out a new series runs unless the member says otherwise.
 *
 * A year, not the end of the calendar year. "Through December" was the
 * design's copy, and it quietly shrinks as the year goes on — set one up in
 * November and it covers six dates; on Boxing Day it covers almost none, for
 * no reason the member can see.
 */
export const defaultSeriesEnd = (today: string): string => addDays(today, 364);

/** The range the end-date picker allows: at least a week, at most a year. */
export const seriesEndBounds = (today: string): { min: string; max: string } => ({
  min: addDays(today, 7),
  max: addDays(today, MAX_SERIES_DAYS),
});

/**
 * Why the chosen end date cannot be used, or null when it can.
 *
 * The server enforces the same bounds; this exists so the member finds out
 * while they are still looking at the picker.
 */
export const seriesEndError = (today: string, end: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return 'Choose an end date for this series.';
  const bounds = seriesEndBounds(today);
  if (end < bounds.min) return 'A standing shift has to run at least a week.';
  if (end > bounds.max) return 'A standing shift can run at most a year ahead.';
  return null;
};

/**
 * What the member is actually signing up for, in one line.
 *
 * Dates with no shift on record are called out separately from conflicts:
 * they are not a problem, they are simply months the department has not
 * scheduled yet, and the series will claim them when it does.
 */
export const describeCoverage = (claimable: number, conflicts: number, missing: number): string => {
  const parts: string[] = [];
  if (conflicts > 0) {
    parts.push(
      `${conflicts} of these dates conflict${conflicts === 1 ? 's' : ''} with a shift you already hold. ` +
        `${conflicts === 1 ? 'It' : 'They'} will be skipped.`
    );
  }
  if (missing > 0) {
    parts.push(
      `${missing} ${missing === 1 ? 'date is' : 'dates are'} not on the schedule yet — ` +
        `${missing === 1 ? 'it' : 'they'} will be claimed once scheduled.`
    );
  }
  if (parts.length === 0) {
    return `No conflicts with shifts you already hold. ${claimable} date${claimable === 1 ? '' : 's'} will be claimed now.`;
  }
  return parts.join(' ');
};
