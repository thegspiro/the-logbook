/**
 * Events Page
 *
 * Lists all events and allows creating new ones.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { eventService } from '../services/api';
import type { EventListItem, EventCreate, EventType } from '../types/event';
import { useAuthStore } from '../stores/authStore';

export const EventsPage: React.FC = () => {
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<EventListItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [formData, setFormData] = useState<EventCreate>({
    title: '',
    description: '',
    event_type: 'business_meeting',
    location: '',
    location_details: '',
    start_datetime: '',
    end_datetime: '',
    requires_rsvp: false,
    rsvp_deadline: '',
    max_attendees: undefined,
    allowed_rsvp_statuses: ['going', 'not_going'],
    is_mandatory: false,
    eligible_roles: undefined,
    allow_guests: false,
    send_reminders: true,
    reminder_hours_before: 24,
  });

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
      console.error('Error fetching events:', err);
      setError('Failed to load events. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartDateChange = (startDate: string) => {
    setFormData({ ...formData, start_datetime: startDate });

    // If no end date is set, default to 2 hours later
    if (!formData.end_datetime && startDate) {
      const start = new Date(startDate);
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      const endDateString = end.toISOString().slice(0, 16);
      setFormData({ ...formData, start_datetime: startDate, end_datetime: endDateString });
    }
  };

  const setDuration = (hours: number) => {
    if (!formData.start_datetime) {
      setCreateError('Please set a start date first');
      return;
    }

    const start = new Date(formData.start_datetime);
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
    const endDateString = end.toISOString().slice(0, 16);
    setFormData({ ...formData, end_datetime: endDateString });
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    // Validate dates
    if (new Date(formData.end_datetime) <= new Date(formData.start_datetime)) {
      setCreateError('End date must be after start date');
      return;
    }

    if (formData.requires_rsvp && formData.rsvp_deadline) {
      if (new Date(formData.rsvp_deadline) >= new Date(formData.start_datetime)) {
        setCreateError('RSVP deadline must be before event start');
        return;
      }
    }

    try {
      await eventService.createEvent(formData);
      setShowCreateModal(false);
      setFormData({
        title: '',
        description: '',
        event_type: 'business_meeting',
        location: '',
        location_details: '',
        start_datetime: '',
        end_datetime: '',
        requires_rsvp: false,
        rsvp_deadline: '',
        max_attendees: undefined,
        allowed_rsvp_statuses: ['going', 'not_going'],
        is_mandatory: false,
        eligible_roles: undefined,
        allow_guests: false,
        send_reminders: true,
        reminder_hours_before: 24,
      });
      await fetchEvents();
    } catch (err: any) {
      console.error('Error creating event:', err);
      setCreateError(err.response?.data?.detail || 'Failed to create event');
    }
  };

  const getEventTypeLabel = (type: EventType): string => {
    const labels: Record<EventType, string> = {
      business_meeting: 'Business Meeting',
      public_education: 'Public Education',
      training: 'Training',
      social: 'Social',
      fundraiser: 'Fundraiser',
      ceremony: 'Ceremony',
      other: 'Other',
    };
    return labels[type];
  };

  const getEventTypeBadgeColor = (type: EventType): string => {
    const colors: Record<EventType, string> = {
      business_meeting: 'bg-blue-100 text-blue-800',
      public_education: 'bg-green-100 text-green-800',
      training: 'bg-purple-100 text-purple-800',
      social: 'bg-pink-100 text-pink-800',
      fundraiser: 'bg-yellow-100 text-yellow-800',
      ceremony: 'bg-indigo-100 text-indigo-800',
      other: 'bg-gray-100 text-gray-800',
    };
    return colors[type];
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4" role="alert">
          <p className="text-red-800">{error}</p>
          <button
            onClick={fetchEvents}
            className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Events</h1>
          <p className="mt-1 text-sm text-gray-600">
            Department events, meetings, training sessions, and more
          </p>
        </div>
        {canManage && (
          <div className="flex gap-3">
            <Link
              to="/training/create-session"
              className="inline-flex items-center px-4 py-2 border border-purple-600 rounded-md shadow-sm text-sm font-medium text-purple-600 bg-white hover:bg-purple-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Create Training Session
            </Link>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Event
            </button>
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8" aria-label="Tabs">
          {['all', 'business_meeting', 'public_education', 'training', 'social', 'fundraiser', 'ceremony', 'other'].map((filter) => (
            <button
              key={filter}
              onClick={() => setTypeFilter(filter)}
              className={`${
                typeFilter === filter
                  ? 'border-red-500 text-red-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
            >
              {filter === 'all' ? 'All Events' : getEventTypeLabel(filter as EventType)}
            </button>
          ))}
        </nav>
      </div>

      {/* Events List */}
      {filteredEvents.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
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
          <h3 className="mt-2 text-sm font-medium text-gray-900">No events found</h3>
          <p className="mt-1 text-sm text-gray-500">
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
              className="block bg-white rounded-lg border border-gray-200 hover:border-red-300 hover:shadow-md transition-all"
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
                      <h3 className="text-lg font-medium text-gray-900 truncate">{event.title}</h3>
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
                    <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      Cancelled
                    </span>
                  )}
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center text-sm text-gray-500">
                    <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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

                  {event.location && (
                    <div className="flex items-center text-sm text-gray-500">
                      <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="truncate">{event.location}</span>
                    </div>
                  )}

                  {event.requires_rsvp && (
                    <div className="flex items-center text-sm text-gray-500">
                      <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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

      {/* Create Event Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-event-title"
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowCreateModal(false); setCreateError(null); } }}
        >
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75"></div>
            </div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
              <form onSubmit={handleCreateEvent}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="create-event-title" className="text-lg font-medium text-gray-900">Create New Event</h3>
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateModal(false);
                        setCreateError(null);
                      }}
                      className="text-gray-400 hover:text-gray-500"
                      aria-label="Close dialog"
                    >
                      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {createError && (
                    <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3" role="alert">
                      <p className="text-sm text-red-800">{createError}</p>
                    </div>
                  )}

                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {/* Title */}
                    <div>
                      <label htmlFor="event-title" className="block text-sm font-medium text-gray-700">
                        Title <span aria-hidden="true">*</span>
                      </label>
                      <input
                        type="text"
                        id="event-title"
                        required
                        aria-required="true"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label htmlFor="event-description" className="block text-sm font-medium text-gray-700">
                        Description
                      </label>
                      <textarea
                        id="event-description"
                        rows={3}
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      />
                    </div>

                    {/* Event Type */}
                    <div>
                      <label htmlFor="event_type" className="block text-sm font-medium text-gray-700">
                        Event Type <span aria-hidden="true">*</span>
                      </label>
                      <select
                        id="event_type"
                        required
                        aria-required="true"
                        value={formData.event_type}
                        onChange={(e) => setFormData({ ...formData, event_type: e.target.value as EventType })}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      >
                        <option value="business_meeting">Business Meeting</option>
                        <option value="public_education">Public Education</option>
                        <option value="training">Training</option>
                        <option value="social">Social</option>
                        <option value="fundraiser">Fundraiser</option>
                        <option value="ceremony">Ceremony</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    {/* Location */}
                    <div>
                      <label htmlFor="location" className="block text-sm font-medium text-gray-700">
                        Location
                      </label>
                      <input
                        type="text"
                        id="location"
                        value={formData.location}
                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                      />
                    </div>

                    {/* Date and Time */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="start_datetime" className="block text-sm font-medium text-gray-700">
                          Start Date & Time <span aria-hidden="true">*</span>
                        </label>
                        <input
                          type="datetime-local"
                          id="start_datetime"
                          required
                          aria-required="true"
                          value={formData.start_datetime}
                          onChange={(e) => handleStartDateChange(e.target.value)}
                          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                        />
                      </div>
                      <div>
                        <label htmlFor="end_datetime" className="block text-sm font-medium text-gray-700">
                          End Date & Time <span aria-hidden="true">*</span>
                        </label>
                        <input
                          type="datetime-local"
                          id="end_datetime"
                          required
                          aria-required="true"
                          value={formData.end_datetime}
                          onChange={(e) => setFormData({ ...formData, end_datetime: e.target.value })}
                          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                        />
                      </div>
                    </div>

                    {/* Quick Duration Buttons */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Quick Duration
                      </label>
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={() => setDuration(1)}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          1 hour
                        </button>
                        <button
                          type="button"
                          onClick={() => setDuration(2)}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          2 hours
                        </button>
                        <button
                          type="button"
                          onClick={() => setDuration(4)}
                          className="px-3 py-1 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                        >
                          4 hours
                        </button>
                      </div>
                    </div>

                    {/* RSVP Settings */}
                    <div className="space-y-3 p-4 bg-gray-50 rounded-md">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="requires_rsvp"
                          checked={formData.requires_rsvp}
                          onChange={(e) => setFormData({ ...formData, requires_rsvp: e.target.checked })}
                          className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                        />
                        <label htmlFor="requires_rsvp" className="ml-2 block text-sm text-gray-700">
                          Require RSVP
                        </label>
                      </div>

                      {formData.requires_rsvp && (
                        <>
                          <div>
                            <label htmlFor="rsvp_deadline" className="block text-sm font-medium text-gray-700">
                              RSVP Deadline
                            </label>
                            <input
                              type="datetime-local"
                              id="rsvp_deadline"
                              value={formData.rsvp_deadline}
                              onChange={(e) => setFormData({ ...formData, rsvp_deadline: e.target.value })}
                              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                            />
                          </div>

                          <div>
                            <label htmlFor="max_attendees" className="block text-sm font-medium text-gray-700">
                              Max Attendees (optional)
                            </label>
                            <input
                              type="number"
                              id="max_attendees"
                              min="1"
                              value={formData.max_attendees || ''}
                              onChange={(e) => setFormData({ ...formData, max_attendees: e.target.value ? parseInt(e.target.value) : undefined })}
                              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500 sm:text-sm"
                            />
                          </div>

                          <div className="flex items-center">
                            <input
                              type="checkbox"
                              id="allow_guests"
                              checked={formData.allow_guests}
                              onChange={(e) => setFormData({ ...formData, allow_guests: e.target.checked })}
                              className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                            />
                            <label htmlFor="allow_guests" className="ml-2 block text-sm text-gray-700">
                              Allow guests
                            </label>
                          </div>

                          <fieldset>
                            <legend className="block text-sm font-medium text-gray-700 mb-2">
                              RSVP Status Options
                            </legend>
                            <div className="space-y-2">
                              <div className="flex items-center">
                                <input
                                  type="checkbox"
                                  id="status_going"
                                  checked={formData.allowed_rsvp_statuses?.includes('going')}
                                  onChange={(e) => {
                                    const statuses = formData.allowed_rsvp_statuses || [];
                                    if (e.target.checked) {
                                      setFormData({ ...formData, allowed_rsvp_statuses: [...statuses, 'going'] });
                                    } else {
                                      setFormData({ ...formData, allowed_rsvp_statuses: statuses.filter(s => s !== 'going') });
                                    }
                                  }}
                                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                                />
                                <label htmlFor="status_going" className="ml-2 block text-sm text-gray-700">
                                  Going
                                </label>
                              </div>
                              <div className="flex items-center">
                                <input
                                  type="checkbox"
                                  id="status_not_going"
                                  checked={formData.allowed_rsvp_statuses?.includes('not_going')}
                                  onChange={(e) => {
                                    const statuses = formData.allowed_rsvp_statuses || [];
                                    if (e.target.checked) {
                                      setFormData({ ...formData, allowed_rsvp_statuses: [...statuses, 'not_going'] });
                                    } else {
                                      setFormData({ ...formData, allowed_rsvp_statuses: statuses.filter(s => s !== 'not_going') });
                                    }
                                  }}
                                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                                />
                                <label htmlFor="status_not_going" className="ml-2 block text-sm text-gray-700">
                                  Not Going
                                </label>
                              </div>
                              <div className="flex items-center">
                                <input
                                  type="checkbox"
                                  id="status_maybe"
                                  checked={formData.allowed_rsvp_statuses?.includes('maybe')}
                                  onChange={(e) => {
                                    const statuses = formData.allowed_rsvp_statuses || [];
                                    if (e.target.checked) {
                                      setFormData({ ...formData, allowed_rsvp_statuses: [...statuses, 'maybe'] });
                                    } else {
                                      setFormData({ ...formData, allowed_rsvp_statuses: statuses.filter(s => s !== 'maybe') });
                                    }
                                  }}
                                  className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                                />
                                <label htmlFor="status_maybe" className="ml-2 block text-sm text-gray-700">
                                  Maybe
                                </label>
                              </div>
                            </div>
                          </fieldset>
                        </>
                      )}
                    </div>

                    {/* Other Settings */}
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="is_mandatory"
                        checked={formData.is_mandatory}
                        onChange={(e) => setFormData({ ...formData, is_mandatory: e.target.checked })}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      />
                      <label htmlFor="is_mandatory" className="ml-2 block text-sm text-gray-700">
                        Mandatory attendance
                      </label>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Create Event
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setCreateError(null);
                    }}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
