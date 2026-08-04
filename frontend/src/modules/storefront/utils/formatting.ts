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
