/**
 * Create Training Session, the Records › Sessions tab of Training
 * Administration.
 *
 * A training session is a Training event, so this is the one training-event
 * form (TrainingEventWizard) with the type fixed. It saves through the events
 * endpoints, which need events.manage; the hub opens for training.manage, so
 * a training manager without it is told who can create one instead of being
 * handed a form whose save would be refused.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Lock } from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService } from '../services/api';
import type { EventCreate, RecurringEventCreate } from '../types/event';
import type { ConflictEvent } from '../components/event-form/eventFormTypes';
import { TrainingEventWizard } from '../components/training-event/TrainingEventWizard';
import { useAuthStore } from '../stores/authStore';

const CreateTrainingSessionPage: React.FC = () => {
  const navigate = useNavigate();
  const canManageEvents = useAuthStore((state) => state.checkPermission('events.manage'));
  const [userEvents, setUserEvents] = useState<ConflictEvent[]>([]);

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

  const handleSubmit = async (data: EventCreate) => {
    const event = await eventService.createEvent(data);
    toast.success('Training session created');
    void navigate(`/events/${event.id}`);
  };

  const handleSubmitRecurring = async (data: RecurringEventCreate) => {
    const events = await eventService.createRecurringEvent(data);
    toast.success(`Created ${events.length} recurring training session${events.length === 1 ? '' : 's'}`);
    // The first occurrence, where the series' own page begins.
    const first = events[0];
    void navigate(first ? `/events/${first.id}` : '/events');
  };

  return (
    <div className="min-h-screen">
      <div data-page-main className="mx-auto max-w-5xl py-8">
        {/* Rendered only inside Training Administration, whose section nav already
            names this page; the title stays for heading navigation only, and the
            old back link pointed at the hub the user is already on. The line
            under it said something the nav does not, so it stays visible. */}
        <h2 className="sr-only">Create Training Session</h2>
        {canManageEvents ? (
          <>
            <p className="text-theme-text-muted mb-6">
              Schedule a training event with automatic attendance tracking via QR code
            </p>
            <TrainingEventWizard
              onSubmit={handleSubmit}
              onSubmitRecurring={handleSubmitRecurring}
              onCancel={() => {
                void navigate('/training/admin');
              }}
              userEvents={userEvents}
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
