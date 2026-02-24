/**
 * Date Formatting Utilities
 *
 * Centralized date formatting functions to ensure consistency
 * and reduce code duplication across the application.
 *
 * All formatting functions accept an optional timezone parameter.
 * When provided, dates are displayed in that timezone (e.g., "America/New_York").
 * When omitted, the browser's local timezone is used.
 */

/**
 * Format a date string to localized date
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted date string (e.g., "1/15/2024")
 */
export const formatDate = (dateString?: string | Date | null, timezone?: string): string => {
  if (!dateString) return 'N/A';
  const opts: Intl.DateTimeFormatOptions = {};
  if (timezone) opts.timeZone = timezone;
  return new Date(dateString).toLocaleDateString('en-US', opts);
};

/**
 * Format a date string to full date with time
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted date-time string (e.g., "Monday, January 15, 2024, 2:30 PM")
 */
export const formatDateTime = (dateString?: string | Date | null, timezone?: string): string => {
  if (!dateString) return 'N/A';
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  return new Date(dateString).toLocaleString('en-US', opts);
};

/**
 * Format a date string to short date with time
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted date-time string (e.g., "Jan 15, 2:30 PM")
 */
export const formatShortDateTime = (dateString?: string | Date | null, timezone?: string): string => {
  if (!dateString) return 'N/A';
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  return new Date(dateString).toLocaleString('en-US', opts);
};

/**
 * Format time only from a date string
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted time string (e.g., "2:30 PM")
 */
export const formatTime = (dateString?: string | Date | null, timezone?: string): string => {
  if (!dateString) return 'N/A';
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  return new Date(dateString).toLocaleTimeString('en-US', opts);
};

/**
 * Format a date for datetime-local input
 * Converts UTC to the given timezone for display in input fields.
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted string for datetime-local input (e.g., "2024-01-15T14:30")
 */
export const formatForDateTimeInput = (dateString?: string | Date | null, timezone?: string): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const formatOpts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  if (timezone) formatOpts.timeZone = timezone;
  // Use Intl to format in the target timezone (or browser local when omitted)
  const parts = new Intl.DateTimeFormat('en-CA', formatOpts).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
};

/**
 * Convert a datetime-local input value to a UTC ISO string.
 * This is the inverse of formatForDateTimeInput: it interprets the given
 * "YYYY-MM-DDTHH:mm" string as a time in `timezone` and returns the
 * equivalent UTC ISO-8601 string (e.g., "2024-01-15T19:30:00.000Z").
 *
 * @param localDateTimeStr - Value from a datetime-local input (e.g., "2024-01-15T14:30")
 * @param timezone - IANA timezone the value should be interpreted in (e.g., "America/New_York")
 * @returns UTC ISO string, or empty string if input is falsy
 */
export const localToUTC = (localDateTimeStr?: string | null, timezone?: string): string => {
  if (!localDateTimeStr) return '';

  const [datePart, timePart] = localDateTimeStr.split('T');
  const [year, month, day] = datePart!.split('-').map(Number);
  const [hour, minute] = (timePart || '00:00').split(':').map(Number);

  if (!timezone) {
    // No timezone specified — interpret as browser-local time
    return new Date(year!, month! - 1, day!, hour!, minute!).toISOString();
  }

  // Treat the local datetime components as if they were UTC to get a reference point
  const refUtcMs = Date.UTC(year!, month! - 1, day!, hour!, minute!);

  // Determine what local time that UTC instant corresponds to in the target timezone
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(refUtcMs));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const localAtRefMs = Date.UTC(+get('year'), +get('month') - 1, +get('day'), +get('hour'), +get('minute'));

  // Offset = how far ahead the timezone is from UTC at this instant
  const offsetMs = localAtRefMs - refUtcMs;

  // The UTC time for our desired local time
  const utcMs = refUtcMs - offsetMs;

  // Verify the result handles DST transitions correctly: format the computed
  // UTC time back in the target timezone and confirm it matches the input.
  const checkParts = fmt.formatToParts(new Date(utcMs));
  const cGet = (type: string) => checkParts.find(p => p.type === type)?.value ?? '';
  const checkStr = `${cGet('year')}-${cGet('month')}-${cGet('day')}T${cGet('hour')}:${cGet('minute')}`;

  if (checkStr !== localDateTimeStr) {
    // DST edge case: recalculate with the offset at the computed UTC time
    const checkLocalMs = Date.UTC(+cGet('year'), +cGet('month') - 1, +cGet('day'), +cGet('hour'), +cGet('minute'));
    const correctedOffset = checkLocalMs - utcMs;
    return new Date(refUtcMs - correctedOffset).toISOString();
  }

  return new Date(utcMs).toISOString();
};

/**
 * Get today's date as YYYY-MM-DD in the given timezone.
 * Use this instead of `new Date().toISOString().split('T')[0]`
 * which returns the UTC date and can be off by a day.
 * @param timezone - IANA timezone (e.g., "America/New_York")
 * @returns Date string "YYYY-MM-DD"
 */
export const getTodayLocalDate = (timezone?: string): string => {
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  // en-CA produces YYYY-MM-DD natively
  return new Intl.DateTimeFormat('en-CA', opts).format(new Date());
};

/**
 * Convert a Date to a YYYY-MM-DD string in the given timezone.
 * @param date - Date object
 * @param timezone - IANA timezone (e.g., "America/New_York")
 * @returns Date string "YYYY-MM-DD"
 */
export const toLocalDateString = (date: Date, timezone?: string): string => {
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  return new Intl.DateTimeFormat('en-CA', opts).format(date);
};

/**
 * Calculate days until a date
 * @param dateString - ISO date string or Date object
 * @returns Number of days until the date (negative if past)
 */
export const daysUntil = (dateString: string | Date): number => {
  const targetDate = new Date(dateString);
  const today = new Date();
  const diffTime = targetDate.getTime() - today.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Calculate duration between two dates in minutes
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Duration in minutes
 */
export const calculateDurationMinutes = (
  startDate: string | Date,
  endDate: string | Date
): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.round((end.getTime() - start.getTime()) / 60000);
};

/**
 * Check if a date is in the past
 * @param dateString - ISO date string or Date object
 * @returns True if the date is in the past
 */
export const isPastDate = (dateString: string | Date): boolean => {
  return new Date(dateString) < new Date();
};

/**
 * Check if a date is in the future
 * @param dateString - ISO date string or Date object
 * @returns True if the date is in the future
 */
export const isFutureDate = (dateString: string | Date): boolean => {
  return new Date(dateString) > new Date();
};
