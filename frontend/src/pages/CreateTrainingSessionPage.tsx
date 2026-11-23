/**
 * Create Training Session, the Records › Sessions tab of Training
 * Administration.
 *
 * A training session is a Training event, so this is the one training-event
 * form (EventComposer, drawing TrainingEventWizard) with the type fixed. It saves through the events
 * endpoints, which need events.manage; the hub opens for training.manage, so
 * a training manager without it is told who can create one instead of being
 * handed a form whose save would be refused.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService } from '../services/api';
import type { EventCreate, EventTemplate, RecurringEventCreate } from '../types/event';
import type { ConflictEvent } from '../components/event-form/eventFormTypes';
import { EventComposer } from '../components/event-form/EventComposer';
import { EventType as EventTypeEnum } from '../constants/enums';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { templateToInitialData, templateToInitialTraining } from '../utils/eventTemplates';
import { EventTemplatePicker } from '../components/event-form/EventTemplatePicker';

const CreateTrainingSessionPage: React.FC = () => {
  const navigate = useNavigate();
  const canManageEvents = useAuthStore((state) => state.checkPermission('events.manage'));
  const tz = useTimezone();
  const [userEvents, setUserEvents] = useState<ConflictEvent[]>([]);
  // Training templates only: the type here is fixed to Training.
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  // The picker is offered on Event Details only: a pick starts the form afresh.
  const [onFirstStep, setOnFirstStep] = useState(true);
  const { templateInitialData, templateInitialTraining } = useMemo(() => {
    const template = templates.find((t) => t.id === selectedTemplateId);
    return {
      templateInitialData: template ? templateToInitialData(template, tz) : undefined,
      templateInitialTraining: template ? templateToInitialTraining(template) : undefined,
    };
  }, [templates, selectedTemplateId, tz]);

  useEffect(() => {
    if (!canManageEvents) return;
    eventService
      .getEvents({ end_after: new Date().toISOString(), limit: 500 })
      .then((data) =>
        setUserEvents(
          data.map((e) => ({
            id: e.id,
            title: e.title,
            start_datetime: e.start_datetime,
            end_datetime: e.end_datetime,
            event_type: e.event_type,
          }))
        )
      )
      .catch(() => {
        /* non-critical: no conflict warning */
      });
  }, [canManageEvents]);

  useEffect(() => {
    if (!canManageEvents) return;
    let cancelled = false;
    eventService
      .getTemplates()
      .then((data) => {
        if (!cancelled) setTemplates(data.filter((t) => t.is_active && t.event_type === EventTypeEnum.TRAINING));
      })
      .catch(() => {
        /* templates are optional */
      });
    return () => {
      cancelled = true;
    };
  }, [canManageEvents]);

  const handleSubmit = async (data: EventCreate) => {
    const event = await eventService.createEvent(data);
    toast.success('Training session created');
    void navigate(`/events/${event.id}`);
  };

  const handleSubmitRecurring = async (data: RecurringEventCreate) => {
    // Records which template the series came from; a single event has no such field.
    const events = await eventService.createRecurringEvent({ ...data, template_id: selectedTemplateId || undefined });
    toast.success(`Created ${events.length} recurring training session${events.length === 1 ? '' : 's'}`);
    // The first occurrence, where the series' own page begins.
    const first = events[0];
    void navigate(first ? `/events/${first.id}` : '/events');
  };

  return (
    <div className="min-h-screen">
      <div data-page-main className="mx-auto max-w-5xl py-8">
        {/* Rendered only inside Training Administration, whose page strip draws
            this title visibly; the heading stays for heading navigation, and the
            old back link pointed at the hub the user is already on. The line
            under it said something the strip does not, so it stays visible. */}
        <h2 className="sr-only">Create Training Session</h2>
        {canManageEvents ? (
          <>
            <p className="text-theme-text-muted mb-6">
              Schedule a training event with automatic attendance tracking via QR code
            </p>
            {templates.length > 0 && onFirstStep && (
              <EventTemplatePicker
                templates={templates}
                value={selectedTemplateId}
                onChange={setSelectedTemplateId}
                hint="Training templates only. A template fills the event and its training details, links and completion settings, replacing what is already typed."
              />
            )}
            {/* A template starts the form afresh from its values. */}
            <EventComposer
              key={selectedTemplateId || 'no-template'}
              initialData={templateInitialData}
              initialTraining={templateInitialTraining}
              lockedType={EventTypeEnum.TRAINING}
              onSubmit={handleSubmit}
              onSubmitRecurring={handleSubmitRecurring}
              onCancel={() => {
                void navigate('/training/admin');
              }}
              userEvents={userEvents}
              onFirstStepChange={setOnFirstStep}
            />
          </>
        ) : (
          <div className="alert-info flex items-start gap-3" role="status">
            <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-semibold">Creating a training session needs the Manage all events permission</p>
              <p className="text-sm">
                A training event is an event, so an event manager creates it. You can still approve completions, manage
                the Course Library and requirements, and view every session. You can also edit an existing training
                event&apos;s schedule, location and settings; its training details are changed by an event manager.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CreateTrainingSessionPage;
