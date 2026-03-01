/**
 * Format a duration in minutes to a human-readable string.
 *
 * @param minutes - Duration in minutes, or null/undefined
 * @returns Formatted string like "2h 30m", "45m", or "-" for null values
 */
export const formatDuration = (minutes: number | null | undefined): string => {
  if (minutes === null || minutes === undefined) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
