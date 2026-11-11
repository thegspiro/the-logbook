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
import { eventService } from '../services/api';
import type { EventCreate, EventTemplate, RecurringEventCreate } from '../types/event';
import { EventComposer } from '../components/event-form/EventComposer';
import type { ConflictEvent } from '../components/event-form/eventFormTypes';
import toast from 'react-hot-toast';
import { useTimezone } from '../hooks/useTimezone';
import { templateToInitialData } from '../utils/eventTemplates';
import { EventTemplatePicker } from '../components/event-form/EventTemplatePicker';

export const EventCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  // A failed save is reported by the form that made it, under the field a
  // 422 names or in its own banner; a banner here as well said it twice.
  const handleSubmit = async (data: EventCreate) => {
    setIsSubmitting(true);
    try {
      const event = await eventService.createEvent(data);
      void navigate(`/events/${event.id}`);
    } catch (err: unknown) {
      setIsSubmitting(false);
      throw err; // Re-throw so the form knows submission failed
    }
  };

  const handleSubmitRecurring = async (data: RecurringEventCreate) => {
    setIsSubmitting(true);
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
      setIsSubmitting(false);
      throw err;
    }
  };

  const handleTemplateChange = (id: string) => {
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

        {templates.length > 0 && (
          <EventTemplatePicker
            templates={templates}
            value={selectedTemplateId}
            onChange={handleTemplateChange}
            hint="Pick a template to pre-fill common settings, or start blank. A Training template opens the step-by-step form."
            markTraining
          />
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
