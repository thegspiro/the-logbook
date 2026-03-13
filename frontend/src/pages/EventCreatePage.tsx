/**
 * Event Create Page
 *
 * Full-page form for creating new events with all supported fields.
 * Supports both single and recurring event creation.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Calendar, ArrowLeft, FileText } from 'lucide-react';
import { eventService } from '../services/api';
import type { EventCreate, EventTemplate, RecurringEventCreate } from '../types/event';
import { EventForm } from '../components/EventForm';
import toast from 'react-hot-toast';

/**
 * Convert an EventTemplate into a partial EventCreate suitable for pre-populating the form.
 * start_datetime is set to the next full hour; end_datetime is offset by the template's
 * default_duration_minutes (or 60 min if unset).
 */
function templateToInitialData(template: EventTemplate): Partial<EventCreate> {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  const durationMs = (template.default_duration_minutes || 60) * 60 * 1000;
  const end = new Date(now.getTime() + durationMs);

  // Format as datetime-local value (YYYY-MM-DDTHH:mm)
  const toLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return {
    title: template.default_title || '',
    description: template.default_description || undefined,
    event_type: template.event_type,
    location_id: template.default_location_id || undefined,
    location: template.default_location || undefined,
    location_details: template.default_location_details || undefined,
    start_datetime: toLocal(now),
    end_datetime: toLocal(end),
    requires_rsvp: template.requires_rsvp,
    max_attendees: template.max_attendees || undefined,
    is_mandatory: template.is_mandatory,
    allow_guests: template.allow_guests,
    check_in_window_type: template.check_in_window_type || undefined,
    check_in_minutes_before: template.check_in_minutes_before || undefined,
    check_in_minutes_after: template.check_in_minutes_after || undefined,
    require_checkout: template.require_checkout,
    send_reminders: template.send_reminders,
    reminder_schedule: template.reminder_schedule,
    custom_fields: (template.custom_fields_template as Record<string, string | number | boolean | null> | undefined) || undefined,
  };
}

export const EventCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateInitialData, setTemplateInitialData] = useState<Partial<EventCreate> | undefined>(undefined);

  useEffect(() => {
    void eventService.getTemplates().then((data) => {
      setTemplates(data.filter((t) => t.is_active));
    }).catch(() => {
      // Templates are optional — silently ignore fetch errors
    });
  }, []);

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

  const handleSubmitRecurring = async (data: RecurringEventCreate) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const events = await eventService.createRecurringEvent(data);
      const count = events.length;
      toast.success(`Created ${count} recurring event${count !== 1 ? 's' : ''}`);
      navigate('/events');
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || 'Failed to create recurring events. Please try again.');
      setIsSubmitting(false);
      throw err;
    }
  };

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedTemplateId(id);
    if (!id) {
      setTemplateInitialData(undefined);
      return;
    }
    const template = templates.find((t) => t.id === id);
    if (template) {
      setTemplateInitialData(templateToInitialData(template));
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

        {/* Template Selector */}
        {templates.length > 0 && (
          <div className="card p-6 mb-6">
            <div className="flex items-center space-x-2 mb-3">
              <FileText className="w-5 h-5 text-theme-text-muted" />
              <h2 className="text-lg font-semibold text-theme-text-primary">Start from a Template</h2>
            </div>
            <p className="text-sm text-theme-text-muted mb-3">
              Optionally select a template to pre-fill common event settings.
            </p>
            <select
              value={selectedTemplateId}
              onChange={handleTemplateChange}
              className="w-full sm:w-96 rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              <option value="">— No template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.description ? ` — ${t.description}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Form Card */}
        <div className="card p-8">
          <EventForm
            key={selectedTemplateId || 'no-template'}
            initialData={templateInitialData}
            onSubmit={handleSubmit}
            onSubmitRecurring={handleSubmitRecurring}
            onCancel={handleCancel}
            submitLabel="Create Event"
            isSubmitting={isSubmitting}
            showRecurrence
          />
        </div>
      </main>
    </div>
  );
};

export default EventCreatePage;
