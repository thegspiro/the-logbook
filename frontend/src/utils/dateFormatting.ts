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
 * Parse a date string or Date object, returning null if the value is
 * falsy or results in an invalid Date.
 */
const parseDate = (value: string | Date | undefined | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return date;
};

/**
 * Format a date string to localized date
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted date string (e.g., "1/15/2024")
 */
export const formatDate = (dateString?: string | Date | null, timezone?: string): string => {
  const date = parseDate(dateString);
  if (!date) return 'N/A';
  const opts: Intl.DateTimeFormatOptions = {};
  if (timezone) opts.timeZone = timezone;
  return date.toLocaleDateString('en-US', opts);
};

/**
 * Format a date string to full date with time
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted date-time string (e.g., "Monday, January 15, 2024, 2:30 PM")
 */
export const formatDateTime = (dateString?: string | Date | null, timezone?: string): string => {
  const date = parseDate(dateString);
  if (!date) return 'N/A';
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  return date.toLocaleString('en-US', opts);
};

/**
 * Format a date string to short date with time
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted date-time string (e.g., "Jan 15, 2:30 PM")
 */
export const formatShortDateTime = (dateString?: string | Date | null, timezone?: string): string => {
  const date = parseDate(dateString);
  if (!date) return 'N/A';
  const opts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  return date.toLocaleString('en-US', opts);
};

/**
 * Format time only from a date string
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted time string (e.g., "2:30 PM")
 */
export const formatTime = (dateString?: string | Date | null, timezone?: string): string => {
  const date = parseDate(dateString);
  if (!date) return 'N/A';
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  return date.toLocaleTimeString('en-US', opts);
};

/**
 * Format a date for datetime-local input
 * Converts UTC to the given timezone for display in input fields.
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone (e.g., "America/New_York")
 * @returns Formatted string for datetime-local input (e.g., "2024-01-15T14:30")
 */
export const formatForDateTimeInput = (dateString?: string | Date | null, timezone?: string): string => {
  const date = parseDate(dateString);
  if (!date) return '';
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
  const parts = (datePart ?? '').split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  const timeParts = (timePart || '00:00').split(':').map(Number);
  const hour = timeParts[0] ?? 0;
  const minute = timeParts[1] ?? 0;

  if (!timezone) {
    // No timezone specified — interpret as browser-local time
    return new Date(year, month - 1, day, hour, minute).toISOString();
  }

  // Treat the local datetime components as if they were UTC to get a reference point
  const refUtcMs = Date.UTC(year, month - 1, day, hour, minute);

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
  const dtParts = fmt.formatToParts(new Date(refUtcMs));
  const get = (type: string) => dtParts.find(p => p.type === type)?.value ?? '';
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
 * @returns Number of days until the date (negative if past), or NaN if the date is invalid
 */
export const daysUntil = (dateString: string | Date): number => {
  const targetDate = parseDate(dateString);
  if (!targetDate) return NaN;
  const today = new Date();
  const diffTime = targetDate.getTime() - today.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Calculate duration between two dates in minutes
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Duration in minutes, or NaN if either date is invalid
 */
export const calculateDurationMinutes = (
  startDate: string | Date,
  endDate: string | Date
): number => {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return NaN;
  return Math.round((end.getTime() - start.getTime()) / 60000);
};

/**
 * Check if a date is in the past
 * @param dateString - ISO date string or Date object
 * @returns True if the date is in the past, false if in the future or invalid
 */
export const isPastDate = (dateString: string | Date): boolean => {
  const date = parseDate(dateString);
  if (!date) return false;
  return date < new Date();
};

/**
 * Check if a date is in the future
 * @param dateString - ISO date string or Date object
 * @returns True if the date is in the future, false if in the past or invalid
 */
export const isFutureDate = (dateString: string | Date): boolean => {
  const date = parseDate(dateString);
  if (!date) return false;
  return date > new Date();
};

/**
 * Convert a date to YYYY-MM-DD in the given timezone.
 * Use this instead of `new Date(x).toISOString().slice(0,10)` which
 * returns the UTC date (can be off by a day near midnight).
 * @param dateString - ISO date string or Date object
 * @param timezone - Optional IANA timezone
 * @returns Date string "YYYY-MM-DD"
 */
export const toLocalISODate = (dateString?: string | Date | null, timezone?: string): string => {
  const date = parseDate(dateString);
  if (!date) return '';
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  return new Intl.DateTimeFormat('en-CA', opts).format(date);
};

/**
 * Format a date with custom Intl.DateTimeFormat options, ensuring timezone is applied.
 * Use this when the standard formatDate/formatDateTime/formatTime don't
 * provide the exact format you need (e.g., weekday + short month).
 * @param dateString - ISO date string or Date object
 * @param options - Intl.DateTimeFormatOptions (timeZone will be overwritten)
 * @param timezone - Optional IANA timezone
 * @returns Formatted string
 */
export const formatDateCustom = (
  dateString: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
  timezone?: string,
): string => {
  const date = parseDate(dateString);
  if (!date) return 'N/A';
  const opts = { ...options };
  if (timezone) opts.timeZone = timezone;
  return date.toLocaleString('en-US', opts);
};

/**
 * Format a number for display (currency, counts, measurements).
 * Use this instead of `value.toLocaleString()` to avoid ESLint
 * conflicts with the date-method restrictions.
 * @param value - Numeric value
 * @param options - Optional Intl.NumberFormatOptions
 * @returns Formatted number string
 */
export const formatNumber = (
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
): string => {
  if (value == null) return '0';
  return new Intl.NumberFormat('en-US', options).format(value);
};

/**
 * Format a number as USD currency.
 * @param value - Numeric value
 * @param includeSymbol - Whether to include the $ symbol (default true)
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export const formatCurrency = (
  value: number | null | undefined,
  includeSymbol = true,
): string => {
  if (value == null) return includeSymbol ? '$0.00' : '0.00';
  if (includeSymbol) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

/**
 * Calculate the difference in days between a date string and today, accounting
 * for timezone so that "days remaining" calculations near midnight are correct.
 * @param dateString - ISO date string or Date object (target date)
 * @param timezone - Optional IANA timezone
 * @returns Number of full days between today and the target date (negative if past)
 */
export const daysBetween = (
  dateString: string | Date,
  timezone?: string,
): number => {
  const targetDate = parseDate(dateString);
  if (!targetDate) return NaN;
  // Get today's date string and target date string in the timezone
  const todayStr = getTodayLocalDate(timezone);
  const targetStr = toLocalISODate(targetDate, timezone);
  // Parse as date-only values (no time component) and compute difference
  const todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
  const targetMs = new Date(targetStr + 'T00:00:00Z').getTime();
  return Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));
};
