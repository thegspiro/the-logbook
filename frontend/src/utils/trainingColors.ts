/**
 * Training Module Color Utilities
 *
 * Shared color helpers for training progress bars and status indicators.
 * Prevents duplication of inline color logic across training pages.
 */

/**
 * Returns a Tailwind class for a progress bar based on completion state.
 *
 * @param percentage - Progress percentage (0-100)
 * @param isMet - Whether the requirement/goal is fully met
 * @param isOverdue - Whether the deadline has passed
 */
export function getProgressBarColor(
  percentage: number,
  isMet?: boolean,
  isOverdue?: boolean,
): string {
  if (isMet) return 'bg-green-500';
  if (isOverdue) return 'bg-red-500';
  if (percentage >= 50) return 'bg-blue-500';
  return 'bg-yellow-500';
}

/**
 * Returns a Tailwind class for a progress bar based purely on percentage.
 * Used for pipeline enrollment progress where there is no met/overdue state.
 */
export function getPercentageBarColor(percentage: number): string {
  if (percentage >= 75) return 'bg-green-500';
  if (percentage >= 50) return 'bg-blue-500';
  if (percentage >= 25) return 'bg-yellow-500';
  return 'bg-red-500';
}
