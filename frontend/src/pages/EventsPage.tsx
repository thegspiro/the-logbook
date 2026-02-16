/**
 * Events Page
 *
 * Lists all events with filtering by type.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { eventService } from '../services/api';
import type { EventListItem, EventType } from '../types/event';
import { getEventTypeLabel, getEventTypeBadgeColor } from '../utils/eventHelpers';
import { useAuthStore } from '../stores/authStore';

export const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<EventListItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('events.manage');

  useEffect(() => {
    fetchEvents();
  }, []);

  useEffect(() => {
    if (typeFilter === 'all') {
      setFilteredEvents(events);
    } else {
      setFilteredEvents(events.filter(e => e.event_type === typeFilter));
    }
  }, [events, typeFilter]);

  const fetchEvents = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await eventService.getEvents();
      setEvents(data);
    } catch (err) {
      setError('Failed to load events. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64" role="status" aria-live="polite">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
        <span className="sr-only">Loading events...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-300">{error}</p>
          <button
            onClick={fetchEvents}
            className="mt-2 text-sm text-red-400 hover:text-red-300 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Events</h1>
          <p className="mt-1 text-sm text-slate-300">
            Department events, meetings, training sessions, and more
          </p>
        </div>
        {canManage && (
          <Link
            to="/events/new"
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Event
          </Link>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-white/20 mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {['all', 'business_meeting', 'public_education', 'training', 'social', 'fundraiser', 'ceremony', 'other'].map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              className={`${
                typeFilter === filter
                  ? 'border-red-500 text-red-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              {filter === 'all' ? 'All Events' : getEventTypeLabel(filter as EventType)}
            </button>
          ))}
        </nav>
      </div>

      {/* Events List */}
      {filteredEvents.length === 0 ? (
        <div className="text-center py-12 bg-white/5 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-slate-500"
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
          <h3 className="mt-2 text-sm font-medium text-white">No events found</h3>
          <p className="mt-1 text-sm text-slate-400">
            {typeFilter === 'all'
              ? 'Get started by creating a new event.'
              : `No ${getEventTypeLabel(typeFilter as EventType).toLowerCase()} events found.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEvents.map((event) => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="block bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 hover:border-red-300 hover:shadow-md transition-all"
            >
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {event.event_type === 'training' && (
                        <svg className="h-5 w-5 text-purple-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      )}
                      <h3 className="text-lg font-medium text-white truncate">{event.title}</h3>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventTypeBadgeColor(event.event_type)}`}>
                        {getEventTypeLabel(event.event_type)}
                      </span>
                      {event.is_mandatory && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          Mandatory
                        </span>
                      )}
                    </div>
                  </div>
                  {event.is_cancelled && (
                    <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-300">
                      Cancelled
                    </span>
                  )}
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center text-sm text-slate-400">
                    <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {new Date(event.start_datetime).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>

                  {(event.location_name || event.location) && (
                    <div className="flex items-center text-sm text-slate-400">
                      <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="truncate">{event.location_name || event.location}</span>
                    </div>
                  )}

                  {event.requires_rsvp && (
                    <div className="flex items-center text-sm text-slate-400">
                      <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      {event.going_count} attending
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
    </div>
  );
};
