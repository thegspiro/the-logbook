/**
 * Date Formatting Utilities
 *
 * Centralized date formatting functions to ensure consistency
 * and reduce code duplication across the application.
 */

/**
 * Format a date string to localized date
 * @param dateString - ISO date string or Date object
 * @returns Formatted date string (e.g., "1/15/2024")
 */
export const formatDate = (dateString?: string | Date): string => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString();
};

/**
 * Format a date string to full date with time
 * @param dateString - ISO date string or Date object
 * @returns Formatted date-time string (e.g., "Monday, January 15, 2024, 2:30 PM")
 */
export const formatDateTime = (dateString?: string | Date): string => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

/**
 * Format a date string to short date with time
 * @param dateString - ISO date string or Date object
 * @returns Formatted date-time string (e.g., "Jan 15, 2:30 PM")
 */
export const formatShortDateTime = (dateString?: string | Date): string => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

/**
 * Format time only from a date string
 * @param dateString - ISO date string or Date object
 * @returns Formatted time string (e.g., "2:30 PM")
 */
export const formatTime = (dateString?: string | Date): string => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
};

/**
 * Format a date for datetime-local input
 * @param dateString - ISO date string or Date object
 * @returns Formatted string for datetime-local input (e.g., "2024-01-15T14:30")
 */
export const formatForDateTimeInput = (dateString?: string | Date): string => {
  if (!dateString) return '';
  return new Date(dateString).toISOString().slice(0, 16);
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
