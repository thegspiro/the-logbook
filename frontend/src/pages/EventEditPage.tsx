/**
 * Event Edit Page
 *
 * Full-page form for editing an existing event.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Calendar, ArrowLeft } from 'lucide-react';
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
      void fetchEvent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
    allow_guests: event.allow_guests,
    send_reminders: event.send_reminders,
    reminder_schedule: event.reminder_schedule,
    check_in_window_type: event.check_in_window_type || 'flexible',
    check_in_minutes_before: event.check_in_minutes_before ?? 30,
    check_in_minutes_after: event.check_in_minutes_after ?? 15,
    require_checkout: event.require_checkout || false,
    custom_fields: event.custom_fields || undefined,
    attachments: event.attachments || undefined,
  };

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            to={`/events/${eventId}`}
            className="flex items-center text-theme-text-muted hover:text-theme-text-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Event
          </Link>
          <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
            <Calendar className="w-8 h-8 text-red-700" />
            <span>Edit Event</span>
          </h1>
          <p className="text-theme-text-muted mt-1">
            Update the details for &ldquo;{event.title}&rdquo;.
          </p>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Form Card */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-8 border border-theme-surface-border">
          <EventForm
            initialData={initialData}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            submitLabel="Save Changes"
            isSubmitting={isSubmitting}
          />
        </div>
      </main>
    </div>
  );
};

export default EventEditPage;
