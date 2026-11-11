/**
 * Event Edit Page
 *
 * Full-page form for editing an existing event: the step-by-step training
 * form for a Training event, with its session's fields, and the single-page
 * event form for any other (owner decision, 2026-11-10). `?step=training`
 * opens the training form on Training Info, where the event page's "Edit
 * training details" leads.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import { Breadcrumbs } from '../components/ux';
import { EventsPageHeader } from '../components/events/EventsPageHeader';
import { Calendar } from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService, trainingSessionService } from '../services/api';
import type { TrainingSessionResponse } from '../services/api';
import type { EventCreate, Event, EventUpdate } from '../types/event';
import type { ConflictEvent, InitialRecurrence } from '../components/event-form/eventFormTypes';
import { EventComposer, type EditOptions } from '../components/event-form/EventComposer';
import type { SeriesScope } from '../components/event-form/SeriesScopeChoice';
import type { TrainingInfoAccess, TrainingReadOnlyNotice } from '../components/training-event/TrainingInfoStep';
import { DEFAULT_TRAINING_DETAILS, fromSession } from '../components/training-event/trainingDetailsModel';
import { EventType as EventTypeEnum } from '../constants/enums';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { getErrorDetail } from '../utils/errorHandling';
import { withoutAttendanceLockedFields } from '../utils/eventAttendanceLock';
import { formatDateCustom } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';
import { useAuthStore } from '../stores/authStore';

const DATE_ONLY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };

/** What a training manager without events.manage is told on Training Info: the API refuses them training details (403). */
const TRAINING_MANAGER_NOTICE: TrainingReadOnlyNotice = {
  title: 'Training details are changed by an event manager.',
  detail:
    "You can view them here, including the Training completion settings. The event's schedule, location, RSVP, check-in and reminder settings on the other steps are yours to edit.",
};

export const EventEditPage: React.FC = () => {
  const { id: eventId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tz = useTimezone();
  const canManage = useAuthStore((state) => state.checkPermission('events.manage'));
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEvents, setUserEvents] = useState<ConflictEvent[]>([]);
  const [updateScope, setUpdateScope] = useState<SeriesScope>('single');
  // A Training event's session: null when it has none. Its load failing is
  // not "none": the form then leaves the training details out of the save
  // rather than overwrite what it could not read.
  const [session, setSession] = useState<TrainingSessionResponse | null>(null);
  const [sessionLoadFailed, setSessionLoadFailed] = useState(false);
  // A later occurrence's series: the end date and the rolling flag are stored
  // on the series' first event only (SERIES_PARENT_FIELDS in event_service),
  // so an occurrence read on its own reports neither.
  const [seriesParent, setSeriesParent] = useState<Event | null>(null);
  // The nearest earlier occurrence with finalized attendance, for Review's
  // "<date>, before it, has finalized attendance.": what tells the officer
  // that "This and all future events" leaves that one alone.
  const [finalizedBefore, setFinalizedBefore] = useState<string | undefined>(undefined);

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
      if (data.event_type === EventTypeEnum.TRAINING) {
        try {
          setSession(await trainingSessionService.getSessionByEvent(eventId));
        } catch {
          setSessionLoadFailed(true);
        }
      }
      if (data.recurrence_parent_id) {
        const parentId = data.recurrence_parent_id;
        let parent: Event | null = null;
        try {
          parent = await eventService.getEvent(parentId);
          setSeriesParent(parent);
        } catch {
          /* non-critical: the scope choice leaves out the series' end */
        }
        if (data.event_type === EventTypeEnum.TRAINING) {
          try {
            const earlier = await eventService.getEvents({
              ...(parent ? { start_after: parent.start_datetime } : {}),
              start_before: data.start_datetime,
              limit: 500,
            });
            const finalized = earlier
              .filter(
                (e) =>
                  e.id !== data.id &&
                  (e.id === parentId || e.recurrence_parent_id === parentId) &&
                  Boolean(e.attendance_finalized_at) &&
                  e.start_datetime < data.start_datetime
              )
              .map((e) => e.start_datetime)
              .sort();
            setFinalizedBefore(finalized[finalized.length - 1]);
          } catch {
            /* non-critical: Review leaves out the finalized occurrence */
          }
        }
      }
      setEvent(data);
    } catch (err) {
      setError(getErrorDetail(err) || 'Failed to load event');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (data: EventUpdate) => {
    if (!eventId) return;

    setIsSubmitting(true);
    setError(null);
    try {
      // Only on a finalized event, where the form disables these controls:
      // leaving them out keeps what the server has, so a value the browser
      // rounded or defaulted (a time's seconds, an unset lead time) cannot be
      // refused as a change nobody made. An open event's save keeps them as
      // the form produced them, including the nulls it sends for a cleared
      // field (Category → None among them).
      const payload: EventUpdate = event?.attendance_finalized_at ? withoutAttendanceLockedFields(data) : data;
      const isRecurring = event?.is_recurring || event?.recurrence_parent_id;
      if (isRecurring && updateScope === 'future') {
        const result = await eventService.updateFutureEvents(eventId, payload);
        toast.success(`Updated ${result.updated_count} event(s) in the series`);
      } else {
        await eventService.updateEvent(eventId, payload);
        toast.success('Event updated');
      }
      void navigate(`/events/${eventId}`);
    } catch (err: unknown) {
      // The form shows why, under the field a 422 names or in its banner.
      setIsSubmitting(false);
      throw err;
    }
  };

  const handleSubmit = (data: EventCreate) => handleUpdate(data);

  const handleCancel = () => {
    void navigate(`/events/${eventId}`);
  };

  // Explicit items: /events/:id/edit skips the id, leaving "Events > Edit" with
  // no sign of which event — and the loading and error branches had no route
  // away at all. The event crumb links back to the record being edited.
  const trail = [
    { label: 'Events', path: '/events' },
    ...(event ? [{ label: event.title, path: `/events/${eventId ?? ''}` }] : [{ label: 'Event' }]),
    { label: 'Edit' },
  ];

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs items={trail} />
        <LoadingSpinner message="Loading event..." />
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs items={trail} />
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={() => void navigate('/events')}
            className="mt-2 text-sm text-red-700 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Back to Events
          </button>
        </div>
      </div>
    );
  }

  if (!event) return null;

  // The route also admits training.manage, which may edit only a Training
  // event; the server says whether this one is theirs (can_edit_event).
  if (!canManage && !event.can_edit_event) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs items={trail} />
        <div className="alert-warning rounded-lg p-4" role="alert">
          <p>Only an event manager can edit this event. A training manager can edit training events.</p>
          <button onClick={() => void navigate(`/events/${eventId ?? ''}`)} className="mt-2 text-sm underline">
            Back to the event
          </button>
        </div>
      </div>
    );
  }

  // Convert Event to EventCreate format for the form
  const initialData: EventCreate = {
    title: event.title,
    description: event.description ?? undefined,
    event_type: event.event_type,
    custom_category: event.custom_category ?? undefined,
    location_id: event.location_id ?? undefined,
    location: event.location ?? undefined,
    location_details: event.location_details ?? undefined,
    start_datetime: event.start_datetime,
    end_datetime: event.end_datetime,
    requires_rsvp: event.requires_rsvp,
    rsvp_deadline: event.rsvp_deadline ?? undefined,
    max_attendees: event.max_attendees ?? undefined,
    allowed_rsvp_statuses: event.allowed_rsvp_statuses ?? undefined,
    is_mandatory: event.is_mandatory,
    // Without the saved member types a mandatory event opened with none ticked,
    // and the form refused to save it until somebody ticked them again.
    mandatory_membership_types: event.mandatory_membership_types ?? undefined,
    allow_guests: event.allow_guests,
    // ?? null, not ?? undefined: null is the "inherit the org default" state
    // and has to reach the form as a real value. Omitting it left the select
    // showing "Use organization default" for an event that actually overrode
    // it — and because that option was already displayed, choosing it fired no
    // change event, so the override could not be cleared either.
    attendee_visibility: event.attendee_visibility ?? null,
    send_reminders: event.send_reminders,
    reminder_target: event.reminder_target,
    reminder_schedule: event.reminder_schedule,
    check_in_window_type: event.check_in_window_type ?? 'flexible',
    // A missing lead time means what the backend reads it as: 15 minutes on a
    // window-type event, 60 otherwise (event_service._validate_check_in_window).
    // Showing 60 for every event saved that 60 on the first edit and moved an
    // open window event's check-in start without anyone touching the field.
    check_in_minutes_before: event.check_in_minutes_before ?? (event.check_in_window_type === 'window' ? 15 : 60),
    check_in_minutes_after: event.check_in_minutes_after ?? 15,
    require_checkout: event.require_checkout ?? false,
    allow_guest_check_in: event.allow_guest_check_in ?? false,
    guest_check_in_creates_prospect: event.guest_check_in_creates_prospect ?? false,
    custom_fields: event.custom_fields ?? undefined,
    attachments: event.attachments ?? undefined,
    // The form defaults is_draft to false, so leaving it out made every save
    // of a draft publish it.
    is_draft: event.is_draft ?? false,
  };

  // Build initial recurrence state when editing a recurring event
  const initialRecurrence: InitialRecurrence | undefined =
    event.is_recurring || event.recurrence_parent_id
      ? {
          is_recurring: true,
          recurrence_pattern: event.recurrence_pattern,
          recurrence_end_date: event.recurrence_end_date,
          rolling_recurrence: event.rolling_recurrence,
          recurrence_custom_days: event.recurrence_custom_days,
          recurrence_weekday: event.recurrence_weekday,
          recurrence_week_ordinal: event.recurrence_week_ordinal,
          recurrence_month: event.recurrence_month,
          recurrence_exceptions: event.recurrence_exceptions,
        }
      : undefined;

  const isSeries = Boolean(event.is_recurring || event.recurrence_parent_id);
  const attendanceLocked = Boolean(event.attendance_finalized_at);

  // What this editor may change of the session's fields. Only events.manage
  // may change them (the API refuses a training manager with 403); once
  // attendance is finalized, only Counts toward attendance, and a session
  // cannot be added at all until attendance is reopened.
  const { trainingAccess, readOnlyNotice } = ((): {
    trainingAccess: TrainingInfoAccess;
    readOnlyNotice?: TrainingReadOnlyNotice;
  } => {
    if (!canManage) return { trainingAccess: 'readonly', readOnlyNotice: TRAINING_MANAGER_NOTICE };
    if (sessionLoadFailed) {
      return {
        trainingAccess: 'readonly',
        readOnlyNotice: {
          title: 'The training details could not be loaded.',
          detail: 'Saving leaves them as they are. Reload the page to change them.',
        },
      };
    }
    if (attendanceLocked && !session) {
      return {
        trainingAccess: 'readonly',
        readOnlyNotice: {
          title: `No training details: attendance is filed under ‘${event.title}’ as Continuing Education.`,
          detail: 'Details can be added after someone who can reopen attendance reopens it.',
        },
      };
    }
    return { trainingAccess: attendanceLocked ? 'finalized' : 'edit' };
  })();

  const storedTraining = session ? fromSession(session, event) : DEFAULT_TRAINING_DETAILS;
  const series = seriesParent ?? event;

  const editing: EditOptions = {
    eventId: event.id,
    initialRecurrence,
    attendanceLocked,
    eventTypeLocked: !canManage,
    storedType: event.event_type,
    // A locked step shows the hours as stored: the save leaves them alone, so
    // following the event's length there would show a figure never saved.
    initialTraining:
      trainingAccess === 'edit' || storedTraining.credit_hours_source !== 'duration'
        ? storedTraining
        : { ...storedTraining, credit_hours_source: 'manual' },
    trainingAccess,
    readOnlyNotice,
    storedCourseName: session?.course_name,
    finalizedOccurrenceBefore: finalizedBefore,
    initialStep: searchParams.get('step') === 'training' ? 'training' : 'details',
    seriesScope: isSeries
      ? {
          value: updateScope,
          onChange: setUpdateScope,
          occurrenceStart: event.start_datetime,
          seriesEnd: series.recurrence_end_date,
          rolling: series.rolling_recurrence,
          seriesStart: seriesParent?.start_datetime,
          tz,
        }
      : undefined,
    organizerNames: { organizer: event.organizer_name, alternate: event.alternate_organizer_name },
    onSubmitUpdate: handleUpdate,
  };

  return (
    <div data-page-main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <EventsPageHeader
        icon={Calendar}
        title="Edit Event"
        breadcrumbLabel="Edit"
        subtitle={
          isSeries ? (
            <>
              Update the details for &ldquo;{event.title}&rdquo;, the{' '}
              {formatDateCustom(event.start_datetime, DATE_ONLY, tz)} occurrence.
            </>
          ) : (
            <>
              Update the details for &ldquo;{event.title}&rdquo;,{' '}
              {formatDateCustom(event.start_datetime, DATE_ONLY, tz)}.
            </>
          )
        }
        parentCrumbs={[{ label: event.title, path: `/events/${eventId ?? ''}` }]}
      />
      {/* The form keeps its reading width under the full-width strip. */}
      <div className="mx-auto max-w-5xl">
        <EventComposer
          initialData={initialData}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          submitLabel="Save Changes"
          isSubmitting={isSubmitting}
          trainingSubmitLabel="Save Changes"
          userEvents={userEvents}
          editing={editing}
        />
      </div>
    </div>
  );
};

export default EventEditPage;
