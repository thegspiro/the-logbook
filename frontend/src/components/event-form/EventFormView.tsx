/**
 * EventForm's single-page markup, drawn from a model the caller owns. A host
 * that keeps its own `useEventFormModel` — so values survive swapping one form
 * for another, as `EventComposer` does — renders this directly; `EventForm` is
 * the wrapper that creates the model for everyone else.
 *
 * It has no training details: a Training event's are the training-event
 * form's (`TrainingEventWizard`), which `EventComposer` hands off to.
 */

import React from 'react';
import type { EventFormModel } from './useEventFormModel';
import { NoticesSection } from './sections/NoticesSection';
import { DetailsSection } from './sections/DetailsSection';
import { ScheduleSection } from './sections/ScheduleSection';
import { LocationSection } from './sections/LocationSection';
import { AttendanceSection } from './sections/AttendanceSection';
import { RsvpSection } from './sections/RsvpSection';
import { CheckInSection } from './sections/CheckInSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { AttachmentsSection } from './sections/AttachmentsSection';
import { DraftSection } from './sections/DraftSection';

export interface EventFormViewProps {
  model: EventFormModel;
  onCancel: () => void;
  submitLabel: string;
  isSubmitting: boolean;
  showRecurrence: boolean;
  /** Shown under the Event Type picker, which it describes. */
  typeHint?: React.ReactNode;
  typeHintId?: string | undefined;
}

export const EventFormView: React.FC<EventFormViewProps> = ({
  model,
  onCancel,
  submitLabel,
  isSubmitting,
  showRecurrence,
  typeHint,
  typeHintId,
}) => (
  <form
    noValidate
    onSubmit={(e) => {
      void model.handleSubmit(e);
    }}
    className="space-y-8"
  >
    <NoticesSection model={model} />

    {/* === Event Details === */}
    <DetailsSection model={model} typeHint={typeHint} typeHintId={typeHintId} />

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
