/**
 * Event Edit Page
 *
 * Full-page form for editing an existing event.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { AxiosError } from 'axios';
import { eventService } from '../services/api';
import type { EventCreate, Event } from '../types/event';
import { EventForm } from '../components/EventForm';
import { LoadingSpinner } from '../components/LoadingSpinner';

export const EventEditPage: React.FC = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (eventId) {
      fetchEvent();
    }
  }, [eventId]);

  const fetchEvent = async () => {
    if (!eventId) return;

    try {
      setLoading(true);
      const data = await eventService.getEvent(eventId);
      setEvent(data);
    } catch (err) {
      const apiError = err as AxiosError<{ detail?: string }>;
      setError(apiError.response?.data?.detail || 'Failed to load event');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (data: EventCreate) => {
    if (!eventId) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await eventService.updateEvent(eventId, data);
      navigate(`/events/${eventId}`);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || 'Failed to update event. Please try again.');
      setIsSubmitting(false);
      throw err;
    }
  };

  const handleCancel = () => {
    navigate(`/events/${eventId}`);
  };

  if (loading) {
    return <LoadingSpinner message="Loading event..." />;
  }

  if (error && !event) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => navigate('/events')}
            className="mt-2 text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
          >
            Back to Events
          </button>
        </div>
      </div>
    );
  }

  if (!event) return null;

  // Convert Event to EventCreate format for the form
  const initialData: EventCreate = {
    title: event.title,
    description: event.description || undefined,
    event_type: event.event_type,
    location_id: event.location_id || undefined,
    location: event.location || undefined,
    location_details: event.location_details || undefined,
    start_datetime: event.start_datetime,
    end_datetime: event.end_datetime,
    requires_rsvp: event.requires_rsvp,
    rsvp_deadline: event.rsvp_deadline || undefined,
    max_attendees: event.max_attendees || undefined,
    allowed_rsvp_statuses: event.allowed_rsvp_statuses || undefined,
    is_mandatory: event.is_mandatory,
    eligible_roles: event.eligible_roles || undefined,
    allow_guests: event.allow_guests,
    send_reminders: event.send_reminders,
    reminder_hours_before: event.reminder_hours_before,
    check_in_window_type: event.check_in_window_type || 'flexible',
    check_in_minutes_before: event.check_in_minutes_before ?? 30,
    check_in_minutes_after: event.check_in_minutes_after ?? 15,
    require_checkout: event.require_checkout || false,
    custom_fields: event.custom_fields || undefined,
    attachments: event.attachments || undefined,
  };

  return (
    <div className="min-h-screen">
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex mb-6" aria-label="Breadcrumb">
        <ol className="flex items-center space-x-2 text-sm text-theme-text-muted">
          <li>
            <Link to="/events" className="hover:text-slate-200">
              Events
            </Link>
          </li>
          <li>
            <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </li>
          <li>
            <Link to={`/events/${eventId}`} className="hover:text-slate-200">
              {event.title}
            </Link>
          </li>
          <li>
            <svg className="h-4 w-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </li>
          <li className="text-theme-text-primary font-medium">Edit</li>
        </ol>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-theme-text-primary">Edit Event</h1>
        <p className="mt-1 text-sm text-theme-text-secondary">
          Update the details for &ldquo;{event.title}&rdquo;.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      <EventForm
        initialData={initialData}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        submitLabel="Save Changes"
        isSubmitting={isSubmitting}
      />
    </div>
    </div>
  );
};

export default EventEditPage;
