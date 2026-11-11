/**
 * Event Create Page
 *
 * Full-page form for creating new events with all supported fields.
 * Supports both single and recurring event creation. A Training event, picked
 * by type or by a Training template, is created in the training-event form
 * (EventComposer hands off, carrying what was typed).
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { FileText } from 'lucide-react';
import { eventService } from '../services/api';
import type { EventCreate, EventTemplate, RecurringEventCreate } from '../types/event';
import { EventComposer } from '../components/event-form/EventComposer';
import type { ConflictEvent } from '../components/event-form/eventFormTypes';
import { EventType as EventTypeEnum } from '../constants/enums';
import toast from 'react-hot-toast';
import { getErrorDetail } from '../utils/errorHandling';
import { mapServerFieldErrors } from '../utils/serverFieldErrors';

/**
 * A validation failure is shown by the form, on the fields it names; this
 * page's banner would repeat it with the API's field names ("title: Value is
 * too long.") — the message forms review F-2 set out to retire.
 */
const isFieldValidationError = (err: unknown) => mapServerFieldErrors(err, {}) !== null;
import { formatForDateTimeInput, localToUTC } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';

/**
 * Convert an EventTemplate into a partial EventCreate suitable for pre-populating the form.
 * start_datetime is the next full hour on the department's clock; end_datetime is offset
 * by the template's default_duration_minutes (or 60 min if unset). Both are UTC instants,
 * as EventForm expects of initialData; it converts them to `tz` itself. The naive
 * browser-clock strings this used to build were read as browser time, which put the
 * default an hour or a day out for anyone away from the department (workflow review W21).
 */
function templateToInitialData(template: EventTemplate, tz: string): Partial<EventCreate> {
  const nowLocal = formatForDateTimeInput(new Date(), tz);
  const hourStart = new Date(localToUTC(`${nowLocal.slice(0, 13)}:00`, tz));
  const start = new Date(hourStart.getTime() + 60 * 60 * 1000);
  const durationMs = (template.default_duration_minutes || 60) * 60 * 1000;
  const end = new Date(start.getTime() + durationMs);

  return {
    title: template.default_title || '',
    description: template.default_description || undefined,
    event_type: template.event_type,
    location_id: template.default_location_id || undefined,
    location: template.default_location || undefined,
    location_details: template.default_location_details || undefined,
    start_datetime: start.toISOString(),
    end_datetime: end.toISOString(),
    requires_rsvp: template.requires_rsvp,
    max_attendees: template.max_attendees || undefined,
    is_mandatory: template.is_mandatory,
    allow_guests: template.allow_guests,
    // ?? rather than ||: null here means "inherit the org default" and is a
    // real choice, so it must survive rather than being coerced away.
    attendee_visibility: template.attendee_visibility ?? null,
    check_in_window_type: template.check_in_window_type || undefined,
    check_in_minutes_before: template.check_in_minutes_before ?? undefined,
    check_in_minutes_after: template.check_in_minutes_after ?? undefined,
    require_checkout: template.require_checkout,
    send_reminders: template.send_reminders,
    reminder_target: template.reminder_target,
    reminder_schedule: template.reminder_schedule,
    custom_fields:
      (template.custom_fields_template as Record<string, string | number | boolean | null> | undefined) || undefined,
  };
}

export const EventCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateInitialData, setTemplateInitialData] = useState<Partial<EventCreate> | undefined>(undefined);
  const [userEvents, setUserEvents] = useState<ConflictEvent[]>([]);
  // The Events list's "Use template" opens this tab with ?template=<id>.
  const [searchParams] = useSearchParams();
  const requestedTemplateId = searchParams.get('template');

  useEffect(() => {
    void eventService
      .getEvents({ end_after: new Date().toISOString(), limit: 500 })
      .then((data) => {
        setUserEvents(
          data.map((e) => ({
            id: e.id,
            title: e.title,
            start_datetime: e.start_datetime,
            end_datetime: e.end_datetime,
            event_type: e.event_type,
          }))
        );
      })
      .catch(() => {
        /* non-critical */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void eventService
      .getTemplates()
      .then((data) => {
        if (cancelled) return;
        const active = data.filter((t) => t.is_active);
        setTemplates(active);
        // An unknown or inactive id starts blank, as picking nothing would.
        const requested = requestedTemplateId ? active.find((t) => t.id === requestedTemplateId) : undefined;
        if (requested) {
          setSelectedTemplateId(requested.id);
          setTemplateInitialData(templateToInitialData(requested, tz));
        }
      })
      .catch(() => {
        // Templates are optional — silently ignore fetch errors
      });
    return () => {
      cancelled = true;
    };
  }, [requestedTemplateId, tz]);

  const handleSubmit = async (data: EventCreate) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const event = await eventService.createEvent(data);
      void navigate(`/events/${event.id}`);
    } catch (err: unknown) {
      if (!isFieldValidationError(err)) setError(getErrorDetail(err) || 'Failed to create event. Try again.');
      setIsSubmitting(false);
      throw err; // Re-throw so the form knows submission failed
    }
  };

  const handleSubmitRecurring = async (data: RecurringEventCreate) => {
    setIsSubmitting(true);
    setError(null);
    try {
      // Records which template the series came from; a single event has no
      // such field.
      const events = await eventService.createRecurringEvent({
        ...data,
        template_id: selectedTemplateId || undefined,
      });
      const count = events.length;
      toast.success(`Created ${count} recurring event${count !== 1 ? 's' : ''}`);
      void navigate('/events');
    } catch (err: unknown) {
      if (!isFieldValidationError(err))
        setError(getErrorDetail(err) || 'Failed to create recurring events. Try again.');
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
      setTemplateInitialData(templateToInitialData(template, tz));
    }
  };

  const handleCancel = () => {
    void navigate('/events');
  };

  return (
    <div className="min-h-screen">
      <div data-page-main className="mx-auto max-w-5xl py-8">
        {/* Rendered only as the Create Event tab of Events Administration, whose
            section nav already names it and whose breadcrumb already leads back
            to Events; the title stays for heading navigation only. The line
            about required fields is not said anywhere else, so it stays. */}
        <div className="mb-6">
          <h2 className="sr-only">Create Event</h2>
          <p className="text-theme-text-muted">
            Schedule a new event for your department. All fields marked with{' '}
            <span className="text-red-700 dark:text-red-500">*</span> are required.
          </p>
        </div>

        {error && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Template Selector */}
        {templates.length > 0 && (
          <div className="card mb-6 p-6">
            <div className="mb-3 flex items-center space-x-2">
              <FileText className="text-theme-text-muted h-5 w-5" />
              <h2 className="text-theme-text-primary text-lg font-semibold">Start from a Template</h2>
            </div>
            <p id="event-template-hint" className="text-theme-text-muted mb-3 text-sm">
              Pick a template to pre-fill common settings, or start blank. A Training template opens the step-by-step
              form.
            </p>
            <select
              aria-label="Start from a template"
              aria-describedby="event-template-hint"
              value={selectedTemplateId}
              onChange={handleTemplateChange}
              className="form-input px-3 text-sm focus:ring-red-500 sm:w-96"
            >
              <option value="">— No template —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.description ? ` — ${t.description}` : ''}
                  {t.event_type === EventTypeEnum.TRAINING ? ' (Training)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* A template starts the form afresh from its values. */}
        <EventComposer
          key={selectedTemplateId || 'no-template'}
          initialData={templateInitialData}
          onSubmit={handleSubmit}
          onSubmitRecurring={handleSubmitRecurring}
          onCancel={handleCancel}
          submitLabel="Create Event"
          isSubmitting={isSubmitting}
          userEvents={userEvents}
          trainingSubmitLabel="Create Event"
          trainingRecurringSubmitLabel="Create Recurring Events"
          trainingRecurringSubmitShortLabel="Create events"
        />
      </div>
    </div>
  );
};

export default EventCreatePage;
