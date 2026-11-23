/**
 * Reading a timeline entry: where it leads and how its date reads. The entries
 * themselves are the server's (CLAUDE.md pitfall #29): which records appear,
 * and to whom, is decided there, never re-derived here.
 */
import type { TimelineEntry } from '../types';
import { formatDateSpan } from './historyFormat';

const RECORD_PATHS: Record<TimelineEntry['record_type'], string> = {
  event: '/history/events',
  apparatus: '/history/apparatus',
  member: '/history/people',
};

/** The page of the record an entry was read from. */
export const timelineEntryPath = (entry: TimelineEntry): string =>
  `${RECORD_PATHS[entry.record_type]}/${encodeURIComponent(entry.record_id)}`;

/** "Jul 4, 1911", or a span such as "1908 – Jun 1911" for an event that ran
 * over time. */
export const timelineEntryWhen = (entry: TimelineEntry): string =>
  formatDateSpan({
    start_date: entry.date,
    start_precision: entry.precision,
    start_circa: entry.circa,
    end_date: entry.end_date,
    end_precision: entry.end_precision,
    end_circa: entry.end_circa,
  });

/** The year an entry falls in, for grouping a decade's entries. */
export const timelineEntryYear = (entry: TimelineEntry): number => Number(entry.date.slice(0, 4));
