/**
 * "Today in history": what happened on today's day and month in earlier
 * years, dated to the day. The server picks the entries, by the department's
 * calendar, and only what the caller may read.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays } from 'lucide-react';
import { historyTimelineService } from '../services/api';
import type { TimelineEntry } from '../types';
import { timelineEntryPath } from '../utils/timeline';

interface TodayInHistoryCardProps {
  /** The Dashboard hides the card on a day with nothing to show; the
   * History home says so instead. */
  hideWhenEmpty?: boolean;
}

export const TodayInHistoryCard: React.FC<TodayInHistoryCardProps> = ({ hideWhenEmpty = false }) => {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    historyTimelineService
      .today()
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch(() => {
        // A card that cannot load is left out rather than shown broken: it is
        // a pleasure, not something anyone depends on.
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries === null) return null;
  if (entries.length === 0 && hideWhenEmpty) return null;

  return (
    <section aria-labelledby="today-in-history-heading" className="card p-4">
      <h2
        id="today-in-history-heading"
        className="text-theme-text-primary mb-3 flex items-center gap-2 text-lg font-semibold"
      >
        <CalendarDays className="h-5 w-5" aria-hidden="true" />
        Today in history
      </h2>
      {entries.length === 0 ? (
        <p className="text-theme-text-secondary text-sm">Nothing in the archive happened on this day.</p>
      ) : (
        <ul className="divide-theme-surface-border divide-y">
          {entries.map((entry) => (
            <li key={entry.key} className="py-2">
              <span className="text-theme-text-secondary mr-2 text-sm font-medium">{entry.date.slice(0, 4)}</span>
              <Link
                to={timelineEntryPath(entry)}
                className="touch-target-phone link-underline text-theme-text-primary inline-flex items-center"
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
