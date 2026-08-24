/**
 * Hours Formatting Utilities
 *
 * Logged and credited time is reported in quarter-hour increments. That is the
 * granularity members enter it at (the external-training duration stepper moves
 * in 15-minute steps) and the granularity a department reports against, so a
 * screen that prints a raw division of stored minutes reports a precision the
 * record does not have — and, when it sums two of them, float noise besides:
 * `66.7 + 2.9` renders as `69.60000000000001`.
 *
 * This module is for time a member *worked or was credited with*. It is not for
 * configuration thresholds (auto-approve ceilings, reminder lead times, shift
 * template lengths) or for meter readings (apparatus engine hours) — those are
 * entered as exact figures and must be shown back exactly as entered.
 */

/**
 * Formatted with its own Intl instance rather than through `formatNumber` in
 * `dateFormatting`: this module is imported by screens whose tests partially
 * mock that one, and a partial mock leaves the real export undefined.
 */
const hoursFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** The reporting increment for logged time. */
const QUARTER_HOUR = 0.25;

/**
 * Round hours to the nearest quarter, with halfway values going up.
 *
 * `Math.round` breaks ties toward positive infinity, which is the "up" the
 * department's rule asks for. Quarters are exactly representable in binary
 * floating point, so the result carries none of the drift the input may have.
 */
export function roundHoursToQuarter(hours: number | null | undefined): number {
  if (hours == null || !Number.isFinite(hours)) return 0;
  const rounded = Math.round(hours / QUARTER_HOUR) * QUARTER_HOUR;
  // A small negative variance rounds to -0, which formats as "-0".
  return rounded === 0 ? 0 : rounded;
}

/**
 * Sum hours the way the reader will add them up: each part is rounded before
 * the total, so a total printed beside its parts equals what those parts show.
 * Rounding the raw sum instead lets a card state 69.5 above segments reading
 * 66.75 and 3.
 */
export function sumHoursToQuarter(values: Array<number | null | undefined>): number {
  const total = values.reduce<number>((sum, value) => sum + roundHoursToQuarter(value), 0);
  return roundHoursToQuarter(total);
}

/**
 * Hours as they are shown to a member: rounded to the quarter, thousands
 * separated, trailing zeros dropped ("3", "69.75", "1,840.5").
 */
export function formatHours(hours: number | null | undefined): string {
  return hoursFormatter.format(roundHoursToQuarter(hours));
}
