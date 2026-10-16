import { formatShortDateTime, formatTime, getTodayLocalDate, toLocalISODate } from '../../../utils/dateFormatting';

/** `7:10 AM` for a check made today, else `Oct 14, 7:10 AM` — in the viewer's zone. */
export const lastCheckLabel = (at: string, tz: string): string =>
  toLocalISODate(at, tz) === getTodayLocalDate(tz) ? formatTime(at, tz) : formatShortDateTime(at, tz);
