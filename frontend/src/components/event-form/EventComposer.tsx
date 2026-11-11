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
 *
 * The edit page mounts it too, with the event's id, so a Training event is
 * edited in the training form and any other event in the single-page one, and
 * a type change swaps the form in either direction as it does on create.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { EventCreate, EventType, EventUpdate, RecurringEventCreate } from '../../types/event';
import { EventType as EventTypeEnum } from '../../constants/enums';
import { getEventTypeLabel } from '../../utils/eventHelpers';
import { TrainingEventWizard } from '../training-event/TrainingEventWizard';
import { DEFAULT_TRAINING_DETAILS, type TrainingDetailsForm } from '../training-event/trainingDetailsModel';
import type { TrainingInfoAccess, TrainingReadOnlyNotice } from '../training-event/TrainingInfoStep';
import { EventFormView } from './EventFormView';
import type { ConflictEvent, InitialRecurrence } from './eventFormTypes';
import { SeriesScopeBanner, SeriesScopeReview, type SeriesScopeChoiceProps } from './SeriesScopeChoice';
import { EVENT_FIELD_IDS } from './eventFormConstants';
import { useEventFormModel } from './useEventFormModel';

interface EventComposerProps {
  initialData?: Partial<EventCreate> | undefined;
  /** Save a single event. Throw on failure: the form shows why. */
  onSubmit: (data: EventCreate) => Promise<void>;
  /** Save a series. Throw on failure: the form shows why. Create only. */
  onSubmitRecurring?: ((data: RecurringEventCreate) => Promise<void>) | undefined;
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
  /**
   * The event being edited. The single-page form saves through `onSubmit`, as
   * it always has on the edit page; the training form through
   * `onSubmitUpdate`, with the training details.
   */
  editing?: EditOptions | undefined;
  /**
   * Told whether the form is on its first page: always for the single-page
   * form, only while Event Details is open for the training form. The host's
   * template picker is drawn only then, because picking a template starts the
   * form afresh, and offering that on a later step would throw away every
   * step's entries and return the officer to the first. The picker stays the
   * host's, outside the form it remounts, so a pick keeps focus on it.
   */
  onFirstStepChange?: ((onFirstStep: boolean) => void) | undefined;
}

/** What the edit page knows about the event, for whichever form draws it. */
export interface EditOptions {
  eventId: string;
  initialRecurrence?: InitialRecurrence | undefined;
  attendanceLocked: boolean;
  eventTypeLocked: boolean;
  /** The event's type as stored: a change away from or to Training is said so under the picker. */
  storedType: EventType;
  /** The session's fields as stored, or the defaults when it has none. */
  initialTraining: TrainingDetailsForm;
  trainingAccess: TrainingInfoAccess;
  readOnlyNotice?: TrainingReadOnlyNotice | undefined;
  storedCourseName?: string | undefined;
  initialStep?: 'details' | 'training' | undefined;
  /** On an occurrence of a series: which occurrences the save reaches. */
  seriesScope?: SeriesScopeChoiceProps | undefined;
  /** On an occurrence of a series: the nearest earlier one with finalized attendance (its start). */
  finalizedOccurrenceBefore?: string | undefined;
  organizerNames?: { organizer?: string | null | undefined; alternate?: string | null | undefined } | undefined;
  onSubmitUpdate: (data: EventUpdate) => Promise<void>;
}

const EDIT_TYPE_HINT_ID = 'event-type-edit-hint';

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
  editing,
  onFirstStepChange,
}) => {
  const model = useEventFormModel({
    initialData: lockedType ? { ...initialData, event_type: lockedType } : initialData,
    onSubmit,
    onSubmitRecurring: editing ? undefined : onSubmitRecurring,
    userEvents,
    editingEventId: editing?.eventId,
    initialRecurrence: editing?.initialRecurrence,
    // Create only: once an event exists, who runs it changes by a transfer
    // from the event page.
    showOrganizerPickers: !editing,
    attendanceLocked: editing?.attendanceLocked ?? false,
    eventTypeLocked: editing?.eventTypeLocked ?? false,
  });
  const [training, setTraining] = useState<TrainingDetailsForm>(editing?.initialTraining ?? DEFAULT_TRAINING_DETAILS);
  // What the form opened with, so the training form's Cancel asks only when
  // there is something to lose. Recurrence and Mandatory for live outside
  // formData, so they are part of it too.
  const snapshot = () =>
    JSON.stringify([
      model.formData,
      training,
      model.organizerId,
      model.alternateId,
      model.mandatoryScope,
      model.isRecurring,
      model.recurrencePattern,
      model.recurrenceEndDate,
      model.isRolling,
      model.recurrenceCustomDays,
      model.recurrenceWeekday,
      model.recurrenceWeekOrdinal,
      model.recurrenceMonth,
      model.recurrenceExceptions,
    ]);
  const [openedWith] = useState(snapshot);
  // The type the officer left when picking Training, for the way back. Null
  // when the form opened on Training (a Training template, or Training Admin).
  const [switchedFrom, setSwitchedFrom] = useState<EventType | null>(null);
  const isTraining = model.formData.event_type === EventTypeEnum.TRAINING;
  const [onDetailsStep, setOnDetailsStep] = useState(true);
  const onFirstStep = !isTraining || onDetailsStep;
  useEffect(() => {
    onFirstStepChange?.(onFirstStep);
  }, [onFirstStep, onFirstStepChange]);

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

  const storedTraining = editing?.storedType === EventTypeEnum.TRAINING;
  const scope = editing?.seriesScope;

  if (!isTraining) {
    return (
      <>
        {scope && <SeriesScopeBanner {...scope} />}
        <div className="card p-8">
          <EventFormView
            model={composed}
            onCancel={onCancel}
            submitLabel={submitLabel}
            isSubmitting={isSubmitting}
            showRecurrence={!editing}
            typeHintId={storedTraining ? EDIT_TYPE_HINT_ID : undefined}
            typeHint={
              storedTraining && (
                <p id={EDIT_TYPE_HINT_ID} className="text-theme-text-muted mt-2 text-sm">
                  The single-page form replaces the training steps, with your changes. Saving takes the event out of
                  training: the training credit its attendance gave is taken back.
                </p>
              )
            }
          />
        </div>
      </>
    );
  }

  // On an edit the type picker is the event's own; what it says depends on
  // which way the type is going.
  // A locked picker says why it is locked instead.
  const typeChangeable = editing && !editing.attendanceLocked && !editing.eventTypeLocked;
  const editTypeHint = typeChangeable ? (
    <p id="training-wizard-type-hint" className="text-theme-text-muted mt-2 text-sm">
      {storedTraining
        ? 'Training uses this step-by-step form. Pick another type to use the single-page form; your changes carry over.'
        : 'Training uses the step-by-step form. Your changes carry over, and Training Info opens with No course yet; saving adds the training details.'}
    </p>
  ) : null;

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
            {/* An edit draws no organizer pickers and no recurrence controls, so
                naming them there would describe fields the officer cannot see. */}
            <p className="text-sm">
              {editing
                ? 'That includes the category and the location.'
                : 'That includes the category, organizer and alternate, the recurrence and its skipped dates, and the location.'}{' '}
              Any RSVP, check-in, mandatory or reminder settings you set are on the Settings step.
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
        isDirty={snapshot() !== openedWith}
        typeLocked={Boolean(lockedType)}
        typeNote={typeNote}
        typeHint={editing ? editTypeHint : undefined}
        submitLabel={trainingSubmitLabel}
        recurringSubmitLabel={trainingRecurringSubmitLabel}
        recurringSubmitShortLabel={trainingRecurringSubmitShortLabel}
        onDetailsStepChange={setOnDetailsStep}
        {...(editing
          ? {
              submittingLabel: 'Saving...',
              failureMessage: 'Failed to update event. Try again.',
              onSubmitUpdate: editing.onSubmitUpdate,
              // A non-Training event changed to Training has no session yet:
              // its details are new, and the edit page has no reason to lock them.
              trainingAccess: storedTraining ? editing.trainingAccess : 'edit',
              readOnlyNotice: storedTraining ? editing.readOnlyNotice : undefined,
              originalTraining: storedTraining ? editing.initialTraining : undefined,
              storedCourseName: editing.storedCourseName,
              initialStep: storedTraining ? editing.initialStep : undefined,
              organizerNames: editing.organizerNames,
              scopeChoice: scope && <SeriesScopeReview {...scope} />,
              seriesOccurrence: scope && {
                occurrenceStart: scope.occurrenceStart,
                seriesStart: scope.seriesStart,
                finalizedBefore: editing.finalizedOccurrenceBefore,
              },
            }
          : {})}
      />
    </div>
  );
};
