/**
 * EventForm's single-page markup, drawn from a model the caller owns. A host
 * that keeps its own `useEventFormModel` — so values survive swapping one form
 * for another — renders this directly; `EventForm` is the wrapper that creates
 * the model for everyone else.
 */

import React from 'react';
import { EventType as EventTypeEnum } from '../../constants/enums';
import type { EventFormModel } from './useEventFormModel';
import { NoticesSection } from './sections/NoticesSection';
import { DetailsSection } from './sections/DetailsSection';
import { TrainingDetailsSection } from './sections/TrainingDetailsSection';
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
}

export const EventFormView: React.FC<EventFormViewProps> = ({
  model,
  onCancel,
  submitLabel,
  isSubmitting,
  showRecurrence,
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
    <DetailsSection
      model={model}
      typeHint={
        model.formData.event_type === EventTypeEnum.TRAINING &&
        model.editingEventId && (
          <p className="text-theme-text-muted mt-2 text-sm">
            Training details are edited on the event page&apos;s Requirements &amp; Programs card.
          </p>
        )
      }
      afterType={<TrainingDetailsSection model={model} />}
    />

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
