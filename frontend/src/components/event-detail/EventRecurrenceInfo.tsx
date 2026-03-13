/**
 * EventRecurrenceInfo
 *
 * Displays series navigation (prev/next occurrence) and a collapsible list of
 * all occurrences for recurring events.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { formatShortDateTime } from '../../utils/dateFormatting';
import type { EventListItem } from '../../types/event';

export interface EventRecurrenceInfoProps {
  eventId: string;
  seriesEvents: EventListItem[];
  seriesPosition: number | null;
  seriesTotal: number | null;
  prevOccurrence: EventListItem | null;
  nextOccurrence: EventListItem | null;
  showAllOccurrences: boolean;
  onToggleAllOccurrences: () => void;
  timezone: string;
}

export const EventRecurrenceInfo: React.FC<EventRecurrenceInfoProps> = ({
  eventId,
  seriesEvents,
  seriesPosition,
  seriesTotal,
  prevOccurrence,
  nextOccurrence,
  showAllOccurrences,
  onToggleAllOccurrences,
  timezone,
}) => {
  if (seriesEvents.length <= 1) return null;

  return (
    <>
      <div className="mt-2 flex items-center gap-3 text-sm">
        <span className="text-theme-text-muted">
          Occurrence {seriesPosition} of {seriesTotal}
        </span>
        <div className="flex items-center gap-1">
          {prevOccurrence ? (
            <Link
              to={`/events/${prevOccurrence.id}`}
              className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Link>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-theme-text-muted cursor-default">
              <ChevronLeft className="h-4 w-4" />
              Previous
            </span>
          )}
          <span className="text-theme-text-muted mx-1">|</span>
          {nextOccurrence ? (
            <Link
              to={`/events/${nextOccurrence.id}`}
              className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-theme-text-muted cursor-default">
              Next
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>
        <span className="text-theme-text-muted mx-1">|</span>
        <button
          onClick={onToggleAllOccurrences}
          className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          View All ({seriesEvents.length})
          <ChevronDown className={`h-4 w-4 transition-transform ${showAllOccurrences ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {showAllOccurrences && (
        <div className="mt-2 ml-1 space-y-1 max-h-60 overflow-y-auto">
          {seriesEvents.map((se) => {
            const isCurrent = se.id === eventId;
            const isUpcoming = new Date(se.start_datetime) > new Date();
            return (
              <div key={se.id} className={`flex items-center gap-2 text-sm ${isCurrent ? 'font-medium text-theme-text-primary' : ''}`}>
                {isCurrent ? (
                  <span className="text-theme-text-primary">
                    {formatShortDateTime(se.start_datetime, timezone)} &mdash; {se.title}
                  </span>
                ) : (
                  <Link
                    to={`/events/${se.id}`}
                    className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    {formatShortDateTime(se.start_datetime, timezone)} &mdash; {se.title}
                  </Link>
                )}
                {se.is_cancelled && (
                  <span className="text-xs text-red-500">Cancelled</span>
                )}
                {!se.is_cancelled && isUpcoming && (
                  <span className="text-xs text-green-600 dark:text-green-400">Upcoming</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};
