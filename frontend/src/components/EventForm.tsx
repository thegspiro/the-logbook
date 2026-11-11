/**
 * EventForm Component
 *
 * Reusable form for creating and editing events.
 * Supports location picker, role-based eligibility, RSVP settings,
 * check-in window configuration, and reminder settings.
 *
 * State, validation and payloads live in `useEventFormModel`; the markup is the
 * sections under `./event-form/sections`, which other event forms compose too.
 */

import React from 'react';
import type { EventCreate, RecurringEventCreate } from '../types/event';
import type { ConflictEvent, InitialRecurrence } from './event-form/eventFormTypes';
import { useEventFormModel } from './event-form/useEventFormModel';
import { NoticesSection } from './event-form/sections/NoticesSection';
import { DetailsSection } from './event-form/sections/DetailsSection';
import { ScheduleSection } from './event-form/sections/ScheduleSection';
import { LocationSection } from './event-form/sections/LocationSection';
import { AttendanceSection } from './event-form/sections/AttendanceSection';
import { RsvpSection } from './event-form/sections/RsvpSection';
import { CheckInSection } from './event-form/sections/CheckInSection';
import { NotificationsSection } from './event-form/sections/NotificationsSection';
import { AttachmentsSection } from './event-form/sections/AttachmentsSection';
import { DraftSection } from './event-form/sections/DraftSection';

export type { ConflictEvent, InitialRecurrence } from './event-form/eventFormTypes';

interface EventFormProps {
  initialData?: Partial<EventCreate> | undefined;
  onSubmit: (data: EventCreate) => Promise<void>;
  onSubmitRecurring?: (data: RecurringEventCreate) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
  showRecurrence?: boolean;
  /** Pre-populate recurrence state when editing a recurring event */
  initialRecurrence?: InitialRecurrence | undefined;
  /** Events the user has RSVP'd to, used for conflict detection */
  userEvents?: ConflictEvent[] | undefined;
  /** When editing, the ID of the current event (excluded from conflict checks) */
  editingEventId?: string | undefined;
  /**
   * Offer organizer and alternate pickers. Create only: once an event exists,
   * changing who runs it is a transfer from the event page, which tells the
   * members involved and can carry the change across a recurring series.
   */
  showOrganizerPickers?: boolean | undefined;
  /**
   * The event's attendance is finalized. Its type, category, schedule and
   * check-in rules are shown but cannot be changed: members' credited hours
   * were calculated from them, and the API refuses a change until attendance is
   * reopened. The edit page leaves them out of the save.
   */
  attendanceLocked?: boolean | undefined;
  /**
   * The editor may change everything but the type: a training manager editing
   * a Training event. The API refuses a type change from them, because it would
   * take the event out of training oversight and out of their reach.
   */
  eventTypeLocked?: boolean | undefined;
}

export const EventForm: React.FC<EventFormProps> = ({
  initialData,
  onSubmit,
  onSubmitRecurring,
  onCancel,
  submitLabel = 'Create Event',
  isSubmitting = false,
  showRecurrence = false,
  initialRecurrence,
  userEvents,
  editingEventId,
  showOrganizerPickers = false,
  attendanceLocked = false,
  eventTypeLocked = false,
}) => {
  const model = useEventFormModel({
    initialData,
    onSubmit,
    onSubmitRecurring,
    initialRecurrence,
    userEvents,
    editingEventId,
    showOrganizerPickers,
    attendanceLocked,
    eventTypeLocked,
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        void model.handleSubmit(e);
      }}
      className="space-y-8"
    >
      <NoticesSection model={model} />

      {/* === Event Details === */}
      <DetailsSection model={model} />

      <hr className="border-theme-surface-border" />

      {/* === Schedule === */}
      <ScheduleSection model={model} showRecurrence={showRecurrence} />

      <hr className="border-theme-surface-border" />

      {/* === Location === */}
      <LocationSection model={model} />

      <hr className="border-theme-surface-border" />

      {/* === Attendance & RSVP Settings (side-by-side) === */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <AttendanceSection model={model} />
        <RsvpSection model={model} />
      </div>

      <hr className="border-theme-surface-border" />

      {/* === Check-In Settings & Notifications (side-by-side) === */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CheckInSection model={model} />
        <NotificationsSection model={model} />
      </div>

      <hr className="border-theme-surface-border" />

      {/* === Attachments === */}
      <AttachmentsSection existingAttachments={model.existingAttachments} />

      {/* === Actions === */}
      <DraftSection model={model} onCancel={onCancel} isSubmitting={isSubmitting} submitLabel={submitLabel} />
    </form>
  );
};
