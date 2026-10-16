import { calendarDaysFromToday, formatCalendarDate } from '../../../utils/dateFormatting';

/**
 * A list's day heading: `Today`, `Yesterday`, `Tomorrow`, else `Mon, Oct 13`.
 *
 * Measured against the viewer's calendar in `tz`, never UTC — a shift dated
 * today must not read as yesterday to a crew working the evening.
 */
export const dayHeading = (day: string, tz: string): string => {
  const offset = calendarDaysFromToday(day, tz);
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  return formatCalendarDate(day, { weekday: 'short', month: 'short', day: 'numeric' });
};
