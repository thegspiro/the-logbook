/**
 * Storefront formatting helpers.
 */

import { formatDateCustom } from '../../../utils/dateFormatting';

/**
 * Format a date-only API value ("YYYY-MM-DD") for display.
 *
 * Date-only fields (an order window's expected delivery date) carry no time,
 * so running them through the timezone-aware formatters would parse them as
 * UTC midnight and shift them a day backwards for anyone west of UTC. Build a
 * local Date from the parts instead, and format that.
 */
export const formatDateOnly = (value?: string | null): string => {
  if (!value) return '';
  const datePart = value.split('T')[0] ?? '';
  const [year, month, day] = datePart.split('-').map(Number);
  if (!year || !month || !day) return '';
  return formatDateCustom(new Date(year, month - 1, day), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/** Extract the "YYYY-MM-DD" portion of a date-only API value for `<input type="date">`. */
export const toDateInputValue = (value?: string | null): string => (value ? (value.split('T')[0] ?? '') : '');

/**
 * How much time is left in the order window, phrased for a member deciding
 * whether to order now or later.
 *
 * The unit shrinks as the deadline approaches — "5 days" tells you nothing you
 * need to act on, "43m" does — which is the whole point of showing a countdown
 * rather than a closing date. Returns null once the window has closed: the
 * server decides what is still orderable, so the UI states the deadline has
 * passed rather than disabling controls on the strength of the device clock.
 */
export const formatCountdown = (msRemaining: number): string | null => {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return null;

  const minutes = Math.floor(msRemaining / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
};

/** The same countdown compressed for the phone pill: "5d left", "4h left". */
export const formatCountdownShort = (msRemaining: number): string | null => {
  if (!Number.isFinite(msRemaining) || msRemaining <= 0) return null;

  const minutes = Math.floor(msRemaining / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m left`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h left`;

  return `${Math.floor(hours / 24)}d left`;
};

/**
 * Fraction of the order window already elapsed, 0–1, for the progress bar.
 *
 * Returns null when either end is unknown — a bar with no anchor would be
 * inventing a deadline the department never set.
 */
export const windowElapsedFraction = (
  opensAt: string | null | undefined,
  closesAt: string | null | undefined,
  now: number
): number | null => {
  if (!opensAt || !closesAt) return null;
  const start = new Date(opensAt).getTime();
  const end = new Date(closesAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
};
