/**
 * Election Helpers
 *
 * Shared utility functions used across the elections module.
 * Centralizes duplicated logic from ElectionsPage, ElectionDetailPage,
 * ElectionResults, and BallotBuilder to a single source of truth.
 */

import type { Election } from '../types/election';
import { ElectionStatus } from '../constants/enums';

/**
 * Returns a human-readable string describing the time remaining until
 * an election's end date (e.g. "2d 5h remaining", "45m remaining").
 * Returns `null` if the end date is in the past.
 */
export const getTimeRemaining = (endDate: string): string | null => {
  const now = new Date();
  const end = new Date(endDate);
  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) return null;

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ${diffHours % 24}h remaining`;
  }
  if (diffHours > 0) {
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${diffHours}h ${diffMinutes}m remaining`;
  }
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  return `${diffMinutes}m remaining`;
};

/**
 * Maps an election status to the appropriate Tailwind badge classes.
 * Uses opacity-based backgrounds (e.g. `bg-green-500/10`) for consistent
 * appearance across light, dark, and high-contrast themes.
 */
export const getStatusBadgeClass = (status: string): string => {
  switch (status) {
    case ElectionStatus.OPEN:
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case ElectionStatus.CLOSED:
      return 'bg-theme-surface-secondary text-theme-text-muted';
    case ElectionStatus.DRAFT:
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
    case ElectionStatus.CANCELLED:
      return 'bg-red-500/10 text-red-700 dark:text-red-400';
    default:
      return 'bg-theme-surface-secondary text-theme-text-muted';
  }
};

/**
 * Returns a human-readable description of an election's victory condition,
 * including any configured thresholds or percentages.
 */
export const getVictoryDescription = (election: Election): string => {
  const { victory_condition, victory_threshold, victory_percentage } = election;

  switch (victory_condition) {
    case 'most_votes':
      return 'Most Votes (Plurality)';
    case 'majority':
      return 'Majority (>50% of votes)';
    case 'supermajority':
      return `Supermajority (${victory_percentage || 67}% of votes)`;
    case 'threshold':
      if (victory_threshold) {
        return `Threshold (${victory_threshold} votes required)`;
      }
      if (victory_percentage) {
        return `Threshold (${victory_percentage}% of votes required)`;
      }
      return 'Threshold';
    default:
      return 'Simple Majority';
  }
};
