/**
 * CalendarView Component
 *
 * Displays events in a monthly calendar grid. Supports month navigation,
 * highlights today, and shows event dots on days that have events.
 * Clicking a day reveals the events for that day.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router';
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
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
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
  const today = useMemo(() => new Date(), []);
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

  const calendarDays = useMemo(() => getCalendarDays(currentYear, currentMonth), [currentYear, currentMonth]);

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
            className="text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="text-theme-text-primary min-w-[180px] text-center text-lg font-semibold">{monthLabel}</h2>
          <button
            onClick={goToNextMonth}
            className="text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg p-2 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <button
          onClick={goToToday}
          className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div className="bg-theme-surface border-theme-surface-border overflow-hidden rounded-lg border">
        {/* Day-of-week headers */}
        <div className="border-theme-surface-border grid grid-cols-7 border-b">
          {DAYS_OF_WEEK.map((day) => (
            <div
              key={day}
              className="text-theme-text-muted py-2 text-center text-xs font-medium tracking-wider uppercase"
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
                className={`border-theme-surface-border focus:ring-theme-focus-ring relative min-h-[72px] border-r border-b p-1.5 text-left transition-colors focus:ring-2 focus:outline-none focus:ring-inset sm:min-h-[88px] sm:p-2 ${isCurrentMonth ? 'bg-theme-surface' : 'bg-theme-surface-secondary'} ${isSelected ? 'bg-red-50 ring-2 ring-red-500/50 ring-inset dark:bg-red-500/10' : ''} ${!isSelected ? 'hover:bg-theme-surface-hover' : ''} `}
                aria-label={`${formatDateCustom(date, { month: 'long', day: 'numeric', year: 'numeric' }, timezone)}${hasEvents ? `, ${dayEvents.length} event${dayEvents.length !== 1 ? 's' : ''}` : ''}`}
              >
                <span
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${isToday ? 'bg-red-600 text-white' : ''} ${!isToday && isCurrentMonth ? 'text-theme-text-primary' : ''} ${!isToday && !isCurrentMonth ? 'text-theme-text-muted' : ''} `}
                >
                  {date.getDate()}
                </span>

                {/* Event dots / chips */}
                {hasEvents && (
                  <div className="mt-0.5 space-y-0.5 overflow-hidden">
                    {dayEvents.slice(0, 3).map((evt) => (
                      <div
                        key={evt.id}
                        className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight font-medium sm:text-xs ${getEventTypeBadgeColor(evt.event_type)}`}
                      >
                        <span className="hidden sm:inline">{evt.title}</span>
                        <span className="sm:hidden">&bull;</span>
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-theme-text-muted px-1 text-[10px] font-medium sm:text-xs">
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
        <div className="bg-theme-surface border-theme-surface-border rounded-lg border p-4">
          <h3 className="text-theme-text-primary mb-3 text-sm font-semibold">
            {formatDateCustom(
              selectedDate + 'T12:00:00',
              {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              },
              timezone
            )}
          </h3>

          {selectedEvents.length === 0 ? (
            <p className="text-theme-text-muted flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4" aria-hidden="true" />
              No events on this day.
            </p>
          ) : (
            <div className="space-y-2">
              {selectedEvents.map((event) => (
                <Link
                  key={event.id}
                  to={`/events/${event.id}`}
                  className="border-theme-surface-border hover:bg-theme-surface-hover flex items-center gap-3 rounded-lg border p-3 transition-colors hover:border-red-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-theme-text-primary truncate text-sm font-medium">{event.title}</h4>
                      {event.is_cancelled && (
                        <span className="inline-flex shrink-0 items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                          Cancelled
                        </span>
                      )}
                      {event.is_mandatory && (
                        <span className="inline-flex shrink-0 items-center rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                          Mandatory
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${getEventTypeBadgeColor(event.event_type)}`}
                      >
                        {getEventTypeLabel(event.event_type)}
                      </span>
                      <span className="text-theme-text-muted text-xs">
                        {formatTime(event.start_datetime, timezone)}
                      </span>
                      {(event.location_name || event.location) && (
                        <span className="text-theme-text-muted truncate text-xs">
                          &middot; {event.location_name || event.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
