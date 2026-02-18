/**
 * Event Create Page
 *
 * Full-page form for creating new events with all supported fields.
 */

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Calendar, ArrowLeft } from 'lucide-react';
import { eventService } from '../services/api';
import type { EventCreate } from '../types/event';
import { EventForm } from '../components/EventForm';

export const EventCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (data: EventCreate) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const event = await eventService.createEvent(data);
      navigate(`/events/${event.id}`);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || 'Failed to create event. Please try again.');
      setIsSubmitting(false);
      throw err; // Re-throw so EventForm knows submission failed
    }
  };

  const handleCancel = () => {
    navigate('/events');
  };

  return (
    <div className="min-h-screen">
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/events"
            className="flex items-center text-theme-text-muted hover:text-theme-text-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Events
          </Link>
          <h1 className="text-3xl font-bold text-theme-text-primary flex items-center space-x-3">
            <Calendar className="w-8 h-8 text-red-700" />
            <span>Create Event</span>
          </h1>
          <p className="text-theme-text-muted mt-1">
            Schedule a new event for your department. All fields marked with <span className="text-red-700 dark:text-red-500">*</span> are required.
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
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            submitLabel="Create Event"
            isSubmitting={isSubmitting}
          />
        </div>
      </main>
    </div>
  );
};

export default EventCreatePage;
