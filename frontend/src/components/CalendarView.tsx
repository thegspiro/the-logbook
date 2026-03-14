/**
 * CalendarView Component
 *
 * Displays events in a monthly calendar grid. Supports month navigation,
 * highlights today, and shows event dots on days that have events.
 * Clicking a day reveals the events for that day.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import type { EventListItem } from '../types/event';
import { getEventTypeLabel, getEventTypeBadgeColor } from '../utils/eventHelpers';
import { formatTime, formatDateCustom } from '../utils/dateFormatting';

interface CalendarViewProps {
  events: EventListItem[];
  timezone?: string;
}

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * Get all days to display in the calendar grid for a given month.
 * Includes trailing days from the previous month and leading days
 * from the next month to fill complete weeks.
 */
const getCalendarDays = (year: number, month: number): Date[] => {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days: Date[] = [];

  // Fill in days from previous month to start on Sunday
  const startDayOfWeek = firstDay.getDay();
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  // Days of current month
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

  // Fill remaining days to complete the last week
  const remaining = 7 - (days.length % 7);
  if (remaining < 7) {
    for (let i = 1; i <= remaining; i++) {
      days.push(new Date(year, month + 1, i));
    }
  }

  return days;
};

/**
 * Convert a Date to a YYYY-MM-DD key string using local date parts.
 */
const toDateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Convert an ISO datetime string to a YYYY-MM-DD key in the given timezone.
 */
const isoToDateKey = (iso: string, timezone?: string): string => {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  if (timezone) opts.timeZone = timezone;
  // en-CA produces YYYY-MM-DD natively
  return new Intl.DateTimeFormat('en-CA', opts).format(date);
};

export const CalendarView: React.FC<CalendarViewProps> = ({ events, timezone }) => {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const todayKey = toDateKey(today);

  // Build a map from date key -> events on that day
  const eventsByDate = useMemo(() => {
    const map = new Map<string, EventListItem[]>();
    for (const event of events) {
      const key = isoToDateKey(event.start_datetime, timezone);
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.push(event);
      } else {
        map.set(key, [event]);
      }
    }
    return map;
  }, [events, timezone]);

  const calendarDays = useMemo(
    () => getCalendarDays(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const goToPreviousMonth = useCallback(() => {
    setCurrentMonth((prev) => {
      if (prev === 0) {
        setCurrentYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
    setSelectedDate(null);
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentMonth((prev) => {
      if (prev === 11) {
        setCurrentYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
    setSelectedDate(null);
  }, []);

  const goToToday = useCallback(() => {
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth());
    setSelectedDate(todayKey);
  }, [today, todayKey]);

  const selectedEvents = useMemo(() => {
    if (!selectedDate) return [];
    return eventsByDate.get(selectedDate) ?? [];
  }, [selectedDate, eventsByDate]);

  const monthLabel = `${MONTH_NAMES[currentMonth] ?? ''} ${currentYear}`;

  return (
    <div className="space-y-4">
      {/* Month navigation header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPreviousMonth}
            className="p-2 rounded-lg text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold text-theme-text-primary min-w-[180px] text-center">
            {monthLabel}
          </h2>
          <button
            onClick={goToNextMonth}
            className="p-2 rounded-lg text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={goToToday}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-theme-surface border border-theme-surface-border rounded-lg overflow-hidden">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-theme-surface-border">
          {DAYS_OF_WEEK.map((day) => (
            <div
              key={day}
              className="py-2 text-center text-xs font-medium text-theme-text-muted uppercase tracking-wider"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map((date, index) => {
            const dateKey = toDateKey(date);
            const isCurrentMonth = date.getMonth() === currentMonth;
            const isToday = dateKey === todayKey;
            const isSelected = dateKey === selectedDate;
            const dayEvents = eventsByDate.get(dateKey);
            const hasEvents = !!dayEvents && dayEvents.length > 0;

            return (
              <button
                key={`${dateKey}-${index}`}
                onClick={() => setSelectedDate(isSelected ? null : dateKey)}
                className={`
                  relative min-h-[72px] sm:min-h-[88px] p-1.5 sm:p-2 border-b border-r border-theme-surface-border
                  text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-theme-focus-ring
                  ${isCurrentMonth ? 'bg-theme-surface' : 'bg-theme-surface-secondary'}
                  ${isSelected ? 'ring-2 ring-inset ring-red-500/50 bg-red-50 dark:bg-red-500/10' : ''}
                  ${!isSelected ? 'hover:bg-theme-surface-hover' : ''}
                `}
                aria-label={`${formatDateCustom(date, { month: 'long', day: 'numeric', year: 'numeric' }, timezone)}${hasEvents ? `, ${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}` : ''}`}
              >
                <span
                  className={`
                    inline-flex items-center justify-center text-sm font-medium w-7 h-7 rounded-full
                    ${isToday ? 'bg-red-600 text-white' : ''}
                    ${!isToday && isCurrentMonth ? 'text-theme-text-primary' : ''}
                    ${!isToday && !isCurrentMonth ? 'text-theme-text-muted' : ''}
                  `}
                >
                  {date.getDate()}
                </span>

                {/* Event dots / chips */}
                {hasEvents && (
                  <div className="mt-0.5 space-y-0.5 overflow-hidden">
                    {dayEvents.slice(0, 3).map((evt) => (
                      <div
                        key={evt.id}
                        className={`text-[10px] sm:text-xs leading-tight truncate rounded px-1 py-0.5 font-medium ${getEventTypeBadgeColor(evt.event_type)}`}
                      >
                        <span className="hidden sm:inline">{evt.title}</span>
                        <span className="sm:hidden">&bull;</span>
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] sm:text-xs text-theme-text-muted font-medium px-1">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected day events panel */}
      {selectedDate && (
        <div className="bg-theme-surface border border-theme-surface-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-theme-text-primary mb-3">
            {formatDateCustom(selectedDate + 'T12:00:00', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            }, timezone)}
          </h3>

          {selectedEvents.length === 0 ? (
            <p className="text-sm text-theme-text-muted flex items-center gap-2">
              <Calendar className="h-4 w-4" aria-hidden="true" />
              No events on this day.
            </p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((event) => (
                <Link
                  key={event.id}
                  to={`/events/${event.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-theme-surface-border hover:bg-theme-surface-hover hover:border-red-300 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-theme-text-primary truncate">
                        {event.title}
                      </h4>
                      {event.is_cancelled && (
                        <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
                          Cancelled
                        </span>
                      )}
                      {event.is_mandatory && (
                        <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                          Mandatory
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${getEventTypeBadgeColor(event.event_type)}`}>
                        {getEventTypeLabel(event.event_type)}
                      </span>
                      <span className="text-xs text-theme-text-muted">
                        {formatTime(event.start_datetime, timezone)}
                      </span>
                      {(event.location_name || event.location) && (
                        <span className="text-xs text-theme-text-muted truncate">
                          &middot; {event.location_name || event.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-theme-text-muted" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
