/**
 * Creating an event: the single-page event form for every type but Training,
 * and the step-by-step training-event form for Training (owner decision,
 * 2026-11-10). One model is owned here and drawn by whichever form the type
 * calls for, so picking Training hands every typed value to the training
 * form, and picking another type hands it all back: title, description,
 * category, organizer and alternate, schedule, the recurrence with its rolling
 * cycle and skipped dates, location, and every RSVP, check-in, mandatory and
 * reminder setting. The training session's own fields are kept here too, so a
 * detour through another type does not lose them.
 *
 * Training Admin mounts it with the type fixed, where only the training form
 * is drawn.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { EventCreate, EventType, RecurringEventCreate } from '../../types/event';
import { EventType as EventTypeEnum } from '../../constants/enums';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import { TrainingEventWizard } from '../training-event/TrainingEventWizard';
import { DEFAULT_TRAINING_DETAILS, type TrainingDetailsForm } from '../training-event/trainingDetailsModel';
import { EventFormView } from './EventFormView';
import type { ConflictEvent } from './eventFormTypes';
import { EVENT_FIELD_IDS } from './eventFormConstants';
import { useEventFormModel } from './useEventFormModel';

interface EventComposerProps {
  initialData?: Partial<EventCreate> | undefined;
  /** Save a single event. Throw on failure: the form shows why. */
  onSubmit: (data: EventCreate) => Promise<void>;
  /** Save a series. Throw on failure: the form shows why. */
  onSubmitRecurring: (data: RecurringEventCreate) => Promise<void>;
  onCancel: () => void;
  /** Events the user is going to, for the schedule conflict warning. */
  userEvents?: ConflictEvent[] | undefined;
  /** Fix the type to Training, as Training Admin's Create Session does. */
  lockedType?: typeof EventTypeEnum.TRAINING | undefined;
  /** The single-page form's submit button. */
  submitLabel?: string | undefined;
  /** Whether the host is saving, for the single-page form's button. */
  isSubmitting?: boolean | undefined;
  /** The training form's submit buttons, single and series. */
  trainingSubmitLabel?: string | undefined;
  trainingRecurringSubmitLabel?: string | undefined;
  trainingRecurringSubmitShortLabel?: string | undefined;
  /** Says where a fixed type comes from. */
  typeNote?: string | undefined;
}

export const EventComposer: React.FC<EventComposerProps> = ({
  initialData,
  onSubmit,
  onSubmitRecurring,
  onCancel,
  userEvents,
  lockedType,
  submitLabel = 'Create Event',
  isSubmitting = false,
  trainingSubmitLabel,
  trainingRecurringSubmitLabel,
  trainingRecurringSubmitShortLabel,
  typeNote,
}) => {
  const model = useEventFormModel({
    initialData: lockedType ? { ...initialData, event_type: lockedType } : initialData,
    onSubmit,
    onSubmitRecurring,
    userEvents,
    editingEventId: undefined,
    initialRecurrence: undefined,
    showOrganizerPickers: true,
    attendanceLocked: false,
    eventTypeLocked: false,
  });
  const [training, setTraining] = useState<TrainingDetailsForm>(DEFAULT_TRAINING_DETAILS);
  // The type the officer left when picking Training, for the way back. Null
  // when the form opened on Training (a Training template, or Training Admin).
  const [switchedFrom, setSwitchedFrom] = useState<EventType | null>(null);
  const isTraining = model.formData.event_type === EventTypeEnum.TRAINING;

  // Swapping forms unmounts the type picker the officer was using; focus goes
  // to the new form's picker, so a keyboard or screen-reader user carries on
  // from where they were rather than from the top of the page.
  const swapped = useRef(false);
  useEffect(() => {
    if (!swapped.current) return;
    swapped.current = false;
    document.getElementById(EVENT_FIELD_IDS.event_type)?.focus();
  }, [isTraining]);

  const changeType = (next: EventType) => {
    const previous = model.formData.event_type;
    model.handleEventTypeChange(next);
    const nextIsTraining = next === EventTypeEnum.TRAINING;
    if (nextIsTraining === (previous === EventTypeEnum.TRAINING)) return;
    // Each form places its own errors; the other's would point at nothing.
    model.clearErrors();
    setSwitchedFrom(nextIsTraining ? previous : null);
    swapped.current = true;
  };
  const composed = { ...model, handleEventTypeChange: changeType };

  if (!isTraining) {
    return (
      <div className="card p-8">
        <EventFormView
          model={composed}
          onCancel={onCancel}
          submitLabel={submitLabel}
          isSubmitting={isSubmitting}
          showRecurrence
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {switchedFrom && (
        <div className="alert-info flex items-start gap-3" role="status">
          <ArrowLeftRight className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">Switched to the training form</p>
            <p className="text-sm">
              Training events use the step-by-step training form. Everything you have entered carries over.
            </p>
            <p className="text-sm">
              That includes the category, organizer and alternate, the recurrence and its skipped dates, and the
              location. Any RSVP, check-in, mandatory or reminder settings you set are on the Settings step.
            </p>
            <button
              type="button"
              onClick={() => changeType(switchedFrom)}
              className="touch:min-h-11 text-sm font-medium underline"
            >
              Change back to {getEventTypeLabel(switchedFrom)}
            </button>
          </div>
        </div>
      )}
      <TrainingEventWizard
        model={composed}
        training={training}
        setTraining={setTraining}
        onSubmit={onSubmit}
        onSubmitRecurring={onSubmitRecurring}
        onCancel={onCancel}
        typeLocked={Boolean(lockedType)}
        typeNote={typeNote}
        submitLabel={trainingSubmitLabel}
        recurringSubmitLabel={trainingRecurringSubmitLabel}
        recurringSubmitShortLabel={trainingRecurringSubmitShortLabel}
      />
    </div>
  );
};
