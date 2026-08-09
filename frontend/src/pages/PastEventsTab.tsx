/**
 * Past Events Tab
 *
 * Displays past events for module managers.
 * Shown within the Events Admin Hub.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { eventService } from '../services/api';
import type { EventListItem, EventType } from '../types/event';
import { getEventTypeLabel, getEventTypeBadgeColor } from '../utils/eventHelpers';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime } from '../utils/dateFormatting';
import { EventType as EventTypeEnum } from '../constants/enums';

const PastEventsTab: React.FC = () => {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<EventListItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tz = useTimezone();

  useEffect(() => {
    void fetchPastEvents();
  }, []);

  useEffect(() => {
    if (typeFilter === 'all') {
      setFilteredEvents(events);
    } else {
      setFilteredEvents(events.filter((e) => e.event_type === typeFilter));
    }
  }, [events, typeFilter]);

  const fetchPastEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEvents({
        end_before: new Date().toISOString(),
        include_cancelled: true,
      });
      // Sort most recent first
      data.sort((a, b) => new Date(b.start_datetime).getTime() - new Date(a.start_datetime).getTime());
      setEvents(data);
    } catch (_err) {
      setError('Failed to load past events. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-red-600"></div>
        <span className="sr-only">Loading past events...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => {
              void fetchPastEvents();
            }}
            className="mt-2 text-sm text-red-700 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Type Filter */}
      <div className="border-theme-surface-border mb-6 border-b">
        <nav
          className="-mb-px flex scrollbar-thin space-x-4 overflow-x-auto pb-px sm:space-x-8"
          aria-label="Filter past events by type"
        >
          {[
            'all',
            EventTypeEnum.BUSINESS_MEETING,
            EventTypeEnum.PUBLIC_EDUCATION,
            EventTypeEnum.TRAINING,
            EventTypeEnum.SOCIAL,
            EventTypeEnum.FUNDRAISER,
            EventTypeEnum.CEREMONY,
            EventTypeEnum.OTHER,
          ].map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              className={`${
                typeFilter === filter
                  ? 'border-red-500 text-red-700 dark:text-red-400'
                  : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
              } shrink-0 border-b-2 px-1 py-3 text-sm font-medium whitespace-nowrap sm:py-4`}
            >
              {filter === 'all' ? 'All Types' : getEventTypeLabel(filter as EventType)}
            </button>
          ))}
        </nav>
      </div>

      {/* Past Events List */}
      {filteredEvents.length === 0 ? (
        <div className="bg-theme-surface-secondary rounded-lg py-12 text-center">
          <svg
            className="text-theme-text-muted mx-auto h-12 w-12"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <h3 className="text-theme-text-primary mt-2 text-sm font-medium">No past events</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            {typeFilter === 'all'
              ? 'There are no past events to display.'
              : `No past ${getEventTypeLabel(typeFilter).toLowerCase()} events found.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEvents.map((event) => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="card block transition-all hover:border-red-300 hover:shadow-md"
            >
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {event.event_type === EventTypeEnum.TRAINING && (
                        <svg
                          className="h-5 w-5 shrink-0 text-purple-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                          />
                        </svg>
                      )}
                      <h3 className="text-theme-text-primary truncate text-lg font-medium">{event.title}</h3>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getEventTypeBadgeColor(event.event_type)}`}
                      >
                        {getEventTypeLabel(event.event_type)}
                      </span>
                      {event.is_mandatory && (
                        <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                          Mandatory
                        </span>
                      )}
                    </div>
                  </div>
                  {event.is_cancelled && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-500/20 dark:text-red-300">
                      Cancelled
                    </span>
                  )}
                </div>

                <div className="mt-4 space-y-2">
                  <div className="text-theme-text-muted flex items-center text-sm">
                    <svg
                      className="text-theme-text-muted mr-1.5 h-5 w-5 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    {formatShortDateTime(event.start_datetime, tz)}
                  </div>

                  {(event.location_name || event.location) && (
                    <div className="text-theme-text-muted flex items-center text-sm">
                      <svg
                        className="text-theme-text-muted mr-1.5 h-5 w-5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      <span className="truncate">{event.location_name || event.location}</span>
                    </div>
                  )}

                  {event.requires_rsvp && (
                    <div className="text-theme-text-muted flex items-center text-sm">
                      <svg
                        className="text-theme-text-muted mr-1.5 h-5 w-5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                        />
                      </svg>
                      {event.going_count} attended
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default PastEventsTab;
