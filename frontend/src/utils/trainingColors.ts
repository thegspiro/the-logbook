/**
 * Training Module Color Utilities
 *
 * Shared color helpers for training progress bars and status indicators.
 * Prevents duplication of inline color logic across training pages.
 */

import { SubmissionStatus } from '../constants/enums';

/** Badge classes for a training record, submission or enrollment status. */
export const getTrainingStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400';
    case SubmissionStatus.APPROVED:
      return 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-400';
    case 'active':
      return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
    case 'in_progress':
      return 'bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400';
    case SubmissionStatus.PENDING_REVIEW:
      return 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400';
    case SubmissionStatus.REJECTED:
      return 'bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400';
    case SubmissionStatus.REVISION_REQUESTED:
      return 'bg-orange-500/10 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400';
    default:
      return 'bg-theme-surface-secondary text-theme-text-secondary';
  }
};

/**
 * Returns a Tailwind class for a progress bar based on completion state.
 *
 * @param percentage - Progress percentage (0-100)
 * @param isMet - Whether the requirement/goal is fully met
 * @param isOverdue - Whether the deadline has passed
 */
export function getProgressBarColor(percentage: number, isMet?: boolean, isOverdue?: boolean): string {
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
