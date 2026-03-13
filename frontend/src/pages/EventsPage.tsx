/**
 * Events Page
 *
 * Lists all events with filtering by type, search, pagination,
 * and a toggle between upcoming and past events.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Plus, Download, Search, Repeat, SlidersHorizontal, User } from 'lucide-react';
import { eventService } from '../services/api';
import type { EventListItem, EventType, EventCategoryConfig } from '../types/event';
import { getEventTypeLabel, getEventTypeBadgeColor, getRSVPStatusLabel, getRSVPStatusColor } from '../utils/eventHelpers';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatShortDateTime } from '../utils/dateFormatting';
import { Breadcrumbs, SkeletonCardGrid, EmptyState, Pagination } from '../components/ux';
import { formatRelativeTime, formatAbsoluteDate } from '../hooks/useRelativeTime';
import { DEFAULT_PAGE_SIZE } from '../constants/config';
import { EventType as EventTypeEnum } from '../constants/enums';

const ALL_EVENT_TYPES: EventType[] = [
  EventTypeEnum.BUSINESS_MEETING,
  EventTypeEnum.PUBLIC_EDUCATION,
  EventTypeEnum.TRAINING,
  EventTypeEnum.SOCIAL,
  EventTypeEnum.FUNDRAISER,
  EventTypeEnum.CEREMONY,
  EventTypeEnum.OTHER,
];

export const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visibleTypes, setVisibleTypes] = useState<EventType[]>(ALL_EVENT_TYPES);
  const [customCategories, setCustomCategories] = useState<EventCategoryConfig[]>([]);
  const [visibleCustomCategories, setVisibleCustomCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showPastEvents, setShowPastEvents] = useState(false);
  const [showMyEventsOnly, setShowMyEventsOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'rsvp_count'>('date');

  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('events.manage');
  const tz = useTimezone();

  const tzAbbr = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date())
        .find(p => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
  }, [tz]);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = showPastEvents
        ? { end_before: new Date().toISOString(), include_drafts: canManage }
        : { end_after: new Date().toISOString(), include_drafts: canManage };
      const data = await eventService.getEvents(params);
      setEvents(data);
    } catch (_err) {
      setError('Failed to load events. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [showPastEvents, canManage]);

  useEffect(() => {
    void fetchEvents();
    eventService.getVisibleEventTypesWithCategories()
      .then((data) => {
        setVisibleTypes(data.visible_event_types);
        setCustomCategories(data.custom_event_categories || []);
        setVisibleCustomCategories(data.visible_custom_categories || []);
      })
      .catch(() => { /* fall back to showing all types */ });
  }, [fetchEvents]);

  // Types not marked visible are grouped under the "Other" tab
  const hiddenTypes = useMemo(
    () => ALL_EVENT_TYPES.filter((t) => !visibleTypes.includes(t)),
    [visibleTypes]
  );

  // Build filter tab keys: "all" + visible types + visible custom categories + "other"
  const filterTabs = useMemo(() => {
    const tabs: string[] = ['all', ...visibleTypes.filter((t) => t !== 'other')];
    // Add visible custom categories as tabs (prefixed with "cat:" to distinguish from event types)
    for (const catValue of visibleCustomCategories) {
      tabs.push(`cat:${catValue}`);
    }
    // Always include "other" at the end
    tabs.push('other');
    return tabs;
  }, [visibleTypes, visibleCustomCategories]);

  // Filter by type, then search, then paginate
  const typeFilteredEvents = useMemo(() => {
    if (typeFilter === 'all') return events;
    if (typeFilter.startsWith('cat:')) {
      const catValue = typeFilter.slice(4);
      return events.filter((e) => e.custom_category === catValue);
    }
    if (typeFilter === EventTypeEnum.OTHER) {
      return events.filter(
        (e) => e.event_type === EventTypeEnum.OTHER || hiddenTypes.includes(e.event_type)
      );
    }
    return events.filter(e => e.event_type === typeFilter);
  }, [events, typeFilter, hiddenTypes]);

  const searchFilteredEvents = useMemo(() => {
    let filtered = typeFilteredEvents;
    if (showMyEventsOnly) {
      filtered = filtered.filter((e) => e.user_rsvp_status);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.title.toLowerCase().includes(query) ||
          (e.location ?? '').toLowerCase().includes(query) ||
          (e.location_name ?? '').toLowerCase().includes(query) ||
          (e.custom_category ?? '').toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [typeFilteredEvents, searchQuery, showMyEventsOnly]);

  const sortedEvents = useMemo(() => {
    const sorted = [...searchFilteredEvents];
    switch (sortBy) {
      case 'title':
        sorted.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
        break;
      case 'rsvp_count':
        sorted.sort((a, b) => (b.going_count ?? 0) - (a.going_count ?? 0));
        break;
      case 'date':
      default:
        sorted.sort((a, b) => {
          const dateA = new Date(a.start_datetime).getTime();
          const dateB = new Date(b.start_datetime).getTime();
          return showPastEvents ? dateB - dateA : dateA - dateB;
        });
        break;
    }
    return sorted;
  }, [searchFilteredEvents, sortBy, showPastEvents]);

  const paginatedEvents = useMemo(() => {
    const start = (currentPage - 1) * DEFAULT_PAGE_SIZE;
    return sortedEvents.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [sortedEvents, currentPage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, searchQuery, showPastEvents, showMyEventsOnly, sortBy]);

  // #48: CSV export for events
  const handleExportCSV = useCallback(() => {
    const headers = ['Title', 'Type', 'Date', 'Location', 'Mandatory', 'Cancelled'];
    const rows = sortedEvents.map(e => [
      e.title,
      getEventTypeLabel(e.event_type),
      formatShortDateTime(e.start_datetime, tz),
      e.location || '',
      e.is_mandatory ? 'Yes' : 'No',
      e.is_cancelled ? 'Yes' : 'No',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedEvents, tz]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs />
        <div className="mb-6">
          <div className="h-8 w-32 bg-theme-surface-hover rounded-sm animate-pulse mb-2" />
          <div className="h-4 w-64 bg-theme-surface-hover rounded-sm animate-pulse" />
        </div>
        <SkeletonCardGrid count={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => { void fetchEvents(); }}
            className="mt-2 text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
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
      <Breadcrumbs />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-text-primary">Events</h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Department events, meetings, training sessions, and more
          </p>
        </div>
        <div className="flex items-center gap-3">
          {sortedEvents.length > 0 && (
            <button
              onClick={handleExportCSV}
              className="btn-secondary inline-flex items-center gap-2"
              title="Export to CSV"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}
          {canManage && (
            <>
            <Link
              to="/events/admin"
              className="btn-secondary btn-icon"
              title="Module Settings"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
            <Link
              to="/events/new"
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              Create Event
            </Link>
            </>
          )}
        </div>
      </div>

      {/* Upcoming / Past Toggle + Search + My Events + Sort */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
        <div className="inline-flex rounded-lg border border-theme-surface-border bg-theme-surface p-1">
          <button
            onClick={() => setShowPastEvents(false)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              !showPastEvents
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            Upcoming
          </button>
          <button
            onClick={() => setShowPastEvents(true)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              showPastEvents
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-theme-text-secondary hover:text-theme-text-primary'
            }`}
          >
            Past
          </button>
        </div>
        <button
          onClick={() => setShowMyEventsOnly((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            showMyEventsOnly
              ? 'bg-red-600 text-white border-red-600 shadow-sm'
              : 'bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:text-theme-text-primary'
          }`}
        >
          <User className="h-4 w-4" aria-hidden="true" />
          My Events
        </button>
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
          />
        </div>
        <div className="relative">
          <SlidersHorizontal className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-theme-text-muted pointer-events-none" aria-hidden="true" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'title' | 'rsvp_count')}
            className="pl-9 pr-8 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-sm text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring appearance-none"
          >
            <option value="date">Sort by Date</option>
            <option value="title">Sort by Title</option>
            <option value="rsvp_count">Sort by RSVP Count</option>
          </select>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-theme-surface-border mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
        <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto scrollbar-thin pb-px" aria-label="Tabs">
          {filterTabs.map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              className={`${
                typeFilter === filter
                  ? 'border-red-500 text-red-700 dark:text-red-400'
                  : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
              } whitespace-nowrap py-3 sm:py-4 px-1 border-b-2 font-medium text-sm shrink-0`}
            >
              {filter === 'all'
                ? 'All Events'
                : filter.startsWith('cat:')
                  ? customCategories.find((c) => c.value === filter.slice(4))?.label || filter.slice(4)
                  : getEventTypeLabel(filter as EventType)}
            </button>
          ))}
        </nav>
      </div>

      {/* Events List */}
      {paginatedEvents.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No events found"
          description={
            searchQuery
              ? `No events matching "${searchQuery}".`
              : typeFilter === 'all'
                ? showPastEvents
                  ? 'No past events found.'
                  : 'Get started by creating a new event.'
                : typeFilter.startsWith('cat:')
                  ? `No events in "${customCategories.find((c) => c.value === typeFilter.slice(4))?.label || typeFilter.slice(4)}" category.`
                  : `No ${getEventTypeLabel(typeFilter as EventType).toLowerCase()} events found.`
          }
          actions={canManage && !showPastEvents ? [
            { label: 'Create Event', onClick: () => window.location.href = '/events/new', icon: Plus },
          ] : undefined}
          className="bg-theme-surface-secondary rounded-lg"
        />
      ) : (
        <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedEvents.map((event) => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="card block hover:border-red-300 hover:shadow-md transition-all"
            >
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {event.event_type === EventTypeEnum.TRAINING && (
                        <svg className="h-5 w-5 text-purple-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      )}
                      <h3 className="text-lg font-medium text-theme-text-primary truncate">{event.title}</h3>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventTypeBadgeColor(event.event_type)}`}>
                        {getEventTypeLabel(event.event_type)}
                      </span>
                      {event.is_draft && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300">
                          Draft
                        </span>
                      )}
                      {event.is_mandatory && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400">
                          Mandatory
                        </span>
                      )}
                      {(event.is_recurring || event.recurrence_parent_id) && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                          <Repeat className="h-3 w-3" />
                          Recurring
                        </span>
                      )}
                      {event.user_rsvp_status && (
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRSVPStatusColor(event.user_rsvp_status)}`}>
                          {getRSVPStatusLabel(event.user_rsvp_status)}
                        </span>
                      )}
                    </div>
                  </div>
                  {event.is_cancelled && (
                    <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
                      Cancelled
                    </span>
                  )}
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center text-sm text-theme-text-muted">
                    <svg className="shrink-0 mr-1.5 h-5 w-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span title={formatAbsoluteDate(event.start_datetime, tz)}>
                      {formatShortDateTime(event.start_datetime, tz)}{tzAbbr ? ` ${tzAbbr}` : ''}
                      <span className="text-theme-text-muted ml-1">
                        ({formatRelativeTime(event.start_datetime)})
                      </span>
                    </span>
                  </div>

                  {(event.location_name || event.location) && (
                    <div className="flex items-center text-sm text-theme-text-muted">
                      <svg className="shrink-0 mr-1.5 h-5 w-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="truncate">{event.location_name || event.location}</span>
                    </div>
                  )}

                  {event.requires_rsvp && (
                    <div className="flex items-center text-sm text-theme-text-muted">
                      <svg className="shrink-0 mr-1.5 h-5 w-5 text-theme-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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

        {sortedEvents.length > DEFAULT_PAGE_SIZE && (
          <div className="mt-6">
            <Pagination
              currentPage={currentPage}
              totalItems={sortedEvents.length}
              pageSize={DEFAULT_PAGE_SIZE}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
        </>
      )}
    </div>
    </div>
  );
};
