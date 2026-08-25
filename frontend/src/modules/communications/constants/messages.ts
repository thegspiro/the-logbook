/**
 * Shared constants for the member-facing department message screens.
 *
 * The priority badge palette lives here rather than in either screen so the
 * inbox list and the message detail page cannot drift apart — the same
 * priority must read the same in both places.
 */

export const MESSAGE_PRIORITY_BADGE: Record<string, string> = {
  normal: 'bg-theme-surface-secondary text-theme-text-secondary',
  important: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};
