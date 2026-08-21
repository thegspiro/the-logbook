/**
 * Relative Time Hook (#60)
 *
 * Displays timestamps as "2 hours ago" for recent items,
 * with the full date available on hover.
 */

import { useState, useEffect } from 'react';
import { formatShortDateTime } from '../utils/dateFormatting';

const INTERVALS = [
  { seconds: 31536000, label: 'year' },
  { seconds: 2592000, label: 'month' },
  { seconds: 604800, label: 'week' },
  { seconds: 86400, label: 'day' },
  { seconds: 3600, label: 'hour' },
  { seconds: 60, label: 'minute' },
] as const;

export function formatRelativeTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // Future timestamps read forwards ("in 3 days"). Collapsing them to
  // "just now" — as this did — labelled every upcoming event on the events
  // list "just now", since an event list is by definition mostly ahead of us.
  const future = seconds < 0;
  const elapsed = Math.abs(seconds);

  if (elapsed < 60) return 'just now';

  for (const interval of INTERVALS) {
    const count = Math.floor(elapsed / interval.seconds);
    if (count >= 1) {
      const span = `${count} ${interval.label}${count !== 1 ? 's' : ''}`;
      return future ? `in ${span}` : `${span} ago`;
    }
  }

  return 'just now';
}

export function formatAbsoluteDate(dateStr: string | Date | null | undefined, tz?: string): string {
  if (!dateStr) return '';
  return formatShortDateTime(dateStr, tz);
}

/**
 * Hook that returns a relative time string that auto-updates.
 */
export function useRelativeTime(dateStr: string | Date | null | undefined, updateIntervalMs = 60000): string {
  const [relative, setRelative] = useState(() => formatRelativeTime(dateStr));

  useEffect(() => {
    if (!dateStr) return;

    setRelative(formatRelativeTime(dateStr));

    const timer = setInterval(() => {
      setRelative(formatRelativeTime(dateStr));
    }, updateIntervalMs);

    return () => clearInterval(timer);
  }, [dateStr, updateIntervalMs]);

  return relative;
}
