/**
 * Event Create Page
 *
 * Full-page form for creating new events with all supported fields.
 */

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex mb-6" aria-label="Breadcrumb">
        <ol className="flex items-center space-x-2 text-sm text-slate-400">
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
          <li className="text-white font-medium">Create Event</li>
        </ol>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Create Event</h1>
        <p className="mt-1 text-sm text-slate-300">
          Schedule a new event for your department. All fields marked with <span className="text-red-500">*</span> are required.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      <EventForm
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        submitLabel="Create Event"
        isSubmitting={isSubmitting}
      />
    </div>
    </div>
  );
};

export default EventCreatePage;
