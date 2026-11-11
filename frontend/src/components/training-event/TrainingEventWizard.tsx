/**
 * The one form for a Training event (owner decision, 2026-11-10): four steps —
 * Event Details, Training Info, Settings, Review — drawn from the event form's
 * own sections and model, with the training session's fields on a step of
 * their own. It saves through the events endpoints and always sends
 * `training_details`, so every Training event it creates has a session to
 * file its credit under.
 *
 * The model and the session's fields are its host's (`EventComposer`), which
 * draws the single-page form instead when the type is not Training, so a type
 * change in either form carries every value to the other.
 *
 * Each step is checked before Next; a refused save, or a 422, puts every
 * message under its field and goes to the earliest step holding one, never a
 * toast (forms review F-3/F-4).
 *
 * The same steps edit an existing Training event. An edit sends every training
 * field the form owns, blanks as null (pitfall #1), except where the session's
 * fields are not this editor's to change: on a finalized event only Counts
 * toward attendance goes, and a training manager without events.manage, whom
 * the API refuses training details from (403), sends none.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import {
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  QrCode,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { EventCreate, EventUpdate, RecurringEventCreate } from '../../types/event';
import type { TrainingCourse } from '../../types/training';
import type { User } from '../../types/user';
import { trainingService, userService } from '../../services/api';
import { useRanks } from '../../hooks/useRanks';
import { useTrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import { useMandatoryTierPrefill } from '../../hooks/useMandatoryTierPrefill';
import { getErrorDetail } from '../../utils/errorHandling';
import { mapServerFieldErrors } from '../../utils/serverFieldErrors';
import { displayNameOf } from '../../utils/memberName';
import { getEventTypeBadgeColor } from '../../utils/eventHelpers';
import { useConfirm } from '../../contexts/ConfirmContext';
import type { EventFormModel } from '../event-form/useEventFormModel';
import { EVENT_FIELDS, EVENT_FIELD_IDS, type EventField } from '../event-form/eventFormConstants';
import { NoticesSection } from '../event-form/sections/NoticesSection';
import { DetailsSection } from '../event-form/sections/DetailsSection';
import { ScheduleSection } from '../event-form/sections/ScheduleSection';
import { LocationSection } from '../event-form/sections/LocationSection';
import { AttendanceSection } from '../event-form/sections/AttendanceSection';
import { RsvpSection } from '../event-form/sections/RsvpSection';
import { CheckInSection } from '../event-form/sections/CheckInSection';
import { NotificationsSection } from '../event-form/sections/NotificationsSection';
import { AttachmentsSection } from '../event-form/sections/AttachmentsSection';
import { TrainingInfoStep, type TrainingInfoAccess, type TrainingReadOnlyNotice } from './TrainingInfoStep';
import { TrainingReviewStep, type ReviewTarget, type SeriesOccurrence } from './TrainingReviewStep';
import { MandatoryPrefillNote } from './MandatoryPrefillNote';
import {
  TRAINING_FIELDS,
  applyLibraryCourse,
  scheduledHours,
  strippedForFinalized,
  toAttachPayload,
  toUpdatePayload,
  validateTrainingDetails,
  withCourseChoice,
  type InstructorOption,
  type TrainingDetailsForm,
  type TrainingField,
} from './trainingDetailsModel';

const STEPS: { title: string; icon: LucideIcon }[] = [
  { title: 'Event Details', icon: Calendar },
  { title: 'Training Info', icon: GraduationCap },
  { title: 'Settings', icon: SlidersHorizontal },
  { title: 'Review', icon: ClipboardCheck },
];
const DETAILS = 0;
const TRAINING = 1;
const SETTINGS = 2;
const REVIEW = 3;

const STEP_HEADING_ID = 'training-wizard-step';
const TYPE_HINT_ID = 'training-wizard-type-hint';

const REVIEW_TARGET_STEP: Record<ReviewTarget, number> = {
  details: DETAILS,
  training: TRAINING,
  settings: SETTINGS,
};

/** The step each event field is entered on. */
const EVENT_FIELD_STEP: Record<EventField, number> = {
  title: DETAILS,
  description: DETAILS,
  event_type: DETAILS,
  start_datetime: DETAILS,
  end_datetime: DETAILS,
  recurrence_end_date: DETAILS,
  recurrence_custom_days: DETAILS,
  location: DETAILS,
  location_details: DETAILS,
  mandatory_membership_types: SETTINGS,
  rsvp_deadline: SETTINGS,
  max_attendees: SETTINGS,
};

/** Both forms' fields, for placing a 422 from the one request that carries them all. */
const SERVER_FIELDS = { ...EVENT_FIELDS, ...TRAINING_FIELDS };
type ServerField = keyof typeof SERVER_FIELDS;

type EventErrors = Partial<Record<EventField, string>>;
type TrainingErrors = Partial<Record<TrainingField, string>>;
/** A refusal no single control owns, and the step it is about. */
interface StepMessage {
  step: number;
  message: string;
}

interface TrainingEventWizardProps {
  /**
   * The event form's model, owned by the host (`EventComposer`) so that every
   * value survives a hand-off to or from the single-page form.
   */
  model: EventFormModel;
  /** The training session's fields, owned by the host for the same reason. */
  training: TrainingDetailsForm;
  setTraining: Dispatch<SetStateAction<TrainingDetailsForm>>;
  /** Save a single event. Throw on failure: the wizard shows why. */
  onSubmit: (data: EventCreate) => Promise<void>;
  /** Save a series. Throw on failure: the wizard shows why. */
  onSubmitRecurring?: ((data: RecurringEventCreate) => Promise<void>) | undefined;
  onCancel: () => void;
  /** Whether anything was entered or changed: Cancel then asks before discarding it. */
  isDirty?: boolean | undefined;
  /**
   * Training Admin fixes the type and says so; the Events page offers the type
   * picker, where choosing another type returns to the single-page form.
   */
  typeLocked?: boolean | undefined;
  /** Says where the fixed event type comes from. */
  typeNote?: string | undefined;
  /** Replaces the hint under the type picker (null for none); must carry the id `training-wizard-type-hint`. */
  typeHint?: React.ReactNode;
  submitLabel?: string | undefined;
  recurringSubmitLabel?: string | undefined;
  /** The recurring label for a phone under 480px, where the full one wraps. */
  recurringSubmitShortLabel?: string | undefined;
  /** The submit button while the save runs. */
  submittingLabel?: string | undefined;
  /** The banner's message for a refused save that names no reason. */
  failureMessage?: string | undefined;
  /** An edit's save (the model has an editing event id). Throw on failure: the wizard shows why. */
  onSubmitUpdate?: ((data: EventUpdate) => Promise<void>) | undefined;
  /** What an edit may change on Training Info; a create is always `edit`. */
  trainingAccess?: TrainingInfoAccess | undefined;
  readOnlyNotice?: TrainingReadOnlyNotice | undefined;
  /** The training details as stored, for the Review step's "was" notes. */
  originalTraining?: TrainingDetailsForm | undefined;
  /** The stored session's course name, for a course the library no longer lists. */
  storedCourseName?: string | undefined;
  /** The step to open on: the event page's "Edit training details" opens Training Info. */
  initialStep?: 'details' | 'training' | undefined;
  /** On a series edit, the "This event only / This and all future events" choice, drawn on Review. */
  scopeChoice?: React.ReactNode;
  /** On an edit, who runs the event, for Review. */
  organizerNames?: { organizer?: string | null | undefined; alternate?: string | null | undefined } | undefined;
  /** On a series edit, the occurrence's start and its series' (ISO instants), for Review. */
  seriesOccurrence?: SeriesOccurrence | undefined;
}

export const TrainingEventWizard: React.FC<TrainingEventWizardProps> = ({
  model,
  training,
  setTraining,
  onSubmit,
  onSubmitRecurring,
  onCancel,
  isDirty = false,
  typeLocked = true,
  typeNote = 'Set by Training Admin. Other event types use the Events page.',
  typeHint,
  submitLabel = 'Create Training Session',
  recurringSubmitLabel = 'Create Recurring Sessions',
  recurringSubmitShortLabel = 'Create sessions',
  submittingLabel = 'Creating...',
  failureMessage,
  onSubmitUpdate,
  trainingAccess = 'edit',
  readOnlyNotice,
  originalTraining,
  storedCourseName,
  initialStep = 'details',
  scopeChoice,
  organizerNames,
  seriesOccurrence,
}) => {
  const { formatRank } = useRanks();
  const { confirm } = useConfirm();
  const editing = Boolean(model.editingEventId);
  // A series is created as one; an edit changes one occurrence or the rest of
  // its series through the scope choice, never the recurrence itself.
  const creatingSeries = model.isRecurring && !editing;
  const [step, setStep] = useState(initialStep === 'training' ? TRAINING : DETAILS);
  const [trainingErrors, setTrainingErrors] = useState<TrainingErrors>({});
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Focus is moved after the step it targets has rendered: to the first
  // refused field, or to the step's heading when the step changes.
  const [focusRequest, setFocusRequest] = useState<{ id: string; seq: number } | null>(null);
  const focusSeq = useRef(0);
  // Whether the banner lists field refusals and nothing else, so that it goes
  // once every one of them has been corrected rather than still asking for
  // fixes with nothing left marked.
  const fieldBanner = useRef(false);
  const requestFocus = (id: string) => {
    focusSeq.current += 1;
    setFocusRequest({ id, seq: focusSeq.current });
  };
  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  useEffect(() => {
    trainingService
      .getCourses()
      .then((list) => {
        setCourses(list);
        setCoursesLoaded(true);
      })
      .catch(() => {
        /* non-critical: the library choice offers nothing */
      });
  }, []);
  useEffect(() => {
    userService
      .getUsers()
      .then(setUsers)
      .catch(() => {
        /* non-critical: the lead instructor list is empty */
      });
  }, []);
  const members = useMemo<InstructorOption[]>(
    () =>
      users.map((user) => {
        const name = displayNameOf(user) || user.username;
        return { id: user.id, name, label: user.rank ? `${name} (${formatRank(user.rank)})` : name };
      }),
    [users, formatRank]
  );

  const linkageData = useTrainingLinkageData(training.program_id || undefined);
  const selectedCourse =
    training.course_mode === 'library' ? courses.find((c) => c.id === training.course_id) : undefined;
  const { formData, tz } = model;
  const durationHours = useMemo(
    () => scheduledHours(formData.start_datetime, formData.end_datetime, tz),
    [formData.start_datetime, formData.end_datetime, tz]
  );

  const prefill = useMandatoryTierPrefill(
    model,
    (id) => linkageData.requirements.find((r) => r.id === id)?.name ?? id,
    originalTraining?.attendance_requirement_ids
  );

  const updateTraining = (patch: Partial<TrainingDetailsForm>) => {
    setTraining((prev) => withCourseChoice({ ...prev, ...patch }));
    // Only the officer's ticks: loading an event's links never pre-fills.
    if (patch.attendance_requirement_ids) prefill.requirementsChanged(patch.attendance_requirement_ids);
    const touched = Object.keys(patch).map((key) => (key === 'instructor' ? 'instructor_id' : key));
    if (touched.some((key) => key in trainingErrors)) {
      setTrainingErrors((prev) => {
        const next = { ...prev };
        for (const key of touched) delete next[key as TrainingField];
        return next;
      });
    }
  };

  const pickCourse = (course: TrainingCourse | undefined) => {
    if (!course) {
      updateTraining({ course_id: '' });
      return;
    }
    setTraining((prev) =>
      applyLibraryCourse(
        prev,
        course,
        members,
        linkageData.programs.map((p) => p.id)
      )
    );
    setTrainingErrors(({ course_id: _picked, ...rest }) => rest);
    if (course.max_participants) model.update({ max_attendees: course.max_participants });
  };

  /** The refusals on one step, or on every step when `onStep` is omitted. */
  const collect = (onStep?: number): { event: EventErrors; training: TrainingErrors; messages: StepMessage[] } => {
    const event: EventErrors = {};
    for (const [field, message] of Object.entries(model.validate()) as [EventField, string][]) {
      if (onStep === undefined || EVENT_FIELD_STEP[field] === onStep) event[field] = message;
    }
    // Every series refusal is a field's now (a custom pattern with no day
    // is refused under Days of the Week), so nothing here is step-wide.
    const messages: StepMessage[] = [];
    // Locked fields are sent as stored or not at all, so a check the officer
    // could not act on would only block the save.
    const trainingInvalid =
      trainingAccess === 'edit' && (onStep === undefined || onStep === TRAINING)
        ? validateTrainingDetails(training, durationHours)
        : {};
    return { event, training: trainingInvalid, messages };
  };

  /**
   * Show refusals: each under its field, a summary in the step's banner, and
   * the wizard on the earliest step holding one, focused on its first field.
   * Returns false when there is nothing to show.
   */
  const showErrors = (
    eventErrors: EventErrors,
    trainingErrorsToShow: TrainingErrors,
    messages: StepMessage[],
    extra: string[] = []
  ): boolean => {
    // The type picker draws no message under itself, and Training Admin has
    // no picker at all, so a refusal of the type goes in the banner.
    const { event_type: typeMessage, ...rest } = eventErrors;
    const fieldErrors: EventErrors = rest;
    const allMessages = typeMessage ? [...messages, { step: DETAILS, message: typeMessage }] : messages;
    const steps = [
      ...Object.keys(fieldErrors).map((field) => EVENT_FIELD_STEP[field as EventField]),
      ...(Object.keys(trainingErrorsToShow).length ? [TRAINING] : []),
      ...allMessages.map((m) => m.step),
    ];
    if (steps.length === 0 && extra.length === 0) return false;
    const target = steps.length ? Math.min(...steps) : REVIEW;

    model.setFieldErrors(fieldErrors);
    setTrainingErrors(trainingErrorsToShow);
    // In the order the fields are drawn, so the list reads as the form does.
    const fieldMessages = [
      ...(Object.keys(EVENT_FIELD_IDS) as EventField[]).map((f) => fieldErrors[f]),
      ...(Object.keys(TRAINING_FIELDS) as TrainingField[]).map((f) => trainingErrorsToShow[f]),
    ].filter((message): message is string => Boolean(message));
    const summary =
      fieldMessages.length === 0
        ? ''
        : fieldMessages.length === 1
          ? (fieldMessages[0] ?? '')
          : `Fix the ${fieldMessages.length} fields marked below.\n${fieldMessages.join(' · ')}`;
    const others = [...allMessages.map((m) => m.message), ...extra];
    model.showFormError([summary, others.join(' ')].filter(Boolean).join('\n') || null);
    // A banner of field refusals only is cleared once the last is fixed.
    fieldBanner.current = others.length === 0 && fieldMessages.length > 0;
    setStep(target);

    const firstField =
      target === TRAINING
        ? (Object.keys(TRAINING_FIELDS) as TrainingField[]).find((f) => trainingErrorsToShow[f])
        : (Object.keys(EVENT_FIELD_IDS) as EventField[]).find((f) => fieldErrors[f] && EVENT_FIELD_STEP[f] === target);
    if (firstField && target === TRAINING) {
      requestFocus(TRAINING_FIELDS[firstField as TrainingField].id);
    } else if (firstField) {
      const field = firstField as EventField;
      // The "Other" location box and the fallback box share the field.
      requestFocus(
        field === 'location' && model.locations.length === 0 ? 'location-text-fallback' : EVENT_FIELD_IDS[field]
      );
    } else {
      requestFocus(STEP_HEADING_ID);
    }
    return true;
  };

  const clearAllErrors = () => {
    fieldBanner.current = false;
    model.clearErrors();
    setTrainingErrors({});
  };

  const { fieldErrors: eventFieldErrors, showFormError } = model;
  useEffect(() => {
    if (!fieldBanner.current) return;
    if (Object.keys(eventFieldErrors).length === 0 && Object.keys(trainingErrors).length === 0) {
      fieldBanner.current = false;
      showFormError(null);
    }
  }, [eventFieldErrors, trainingErrors, showFormError]);

  /** Cancel, asking first when something would be lost. */
  const requestCancel = async () => {
    if (!isDirty) {
      onCancel();
      return;
    }
    const discard = await confirm({
      title: editing ? 'Discard your changes?' : 'Discard this event?',
      message: editing ? 'Your changes to this event have not been saved.' : 'Nothing you entered has been saved.',
      confirmLabel: editing ? 'Discard changes' : 'Discard',
      cancelLabel: 'Keep editing',
      variant: 'warning',
    });
    if (discard) onCancel();
  };

  const goTo = (next: number) => {
    setStep(next);
    requestFocus(STEP_HEADING_ID);
  };

  const handleNext = () => {
    const { event, training: trainingInvalid, messages } = collect(step);
    if (showErrors(event, trainingInvalid, messages)) return;
    clearAllErrors();
    goTo(step + 1);
  };

  const handlePrevious = () => {
    clearAllErrors();
    goTo(Math.max(DETAILS, step - 1));
  };

  /** A refused save: a 422 under the fields it names, anything else in the banner. */
  const showSubmitError = (err: unknown, recurring: boolean) => {
    const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
    if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
      const eventErrors: EventErrors = {};
      const trainingErrorsFromServer: TrainingErrors = {};
      for (const [field, message] of Object.entries(mapped.fieldErrors) as [ServerField, string][]) {
        if (field in TRAINING_FIELDS) trainingErrorsFromServer[field as TrainingField] = message;
        else eventErrors[field as EventField] = message;
      }
      showErrors(eventErrors, trainingErrorsFromServer, [], mapped.unmatched);
      return;
    }
    fieldBanner.current = false;
    model.showFormError(
      mapped?.unmatched.join(' ') ||
        getErrorDetail(err) ||
        failureMessage ||
        (recurring ? 'Failed to create recurring events. Try again.' : 'Failed to create event. Try again.')
    );
    requestFocus(STEP_HEADING_ID);
  };

  /**
   * An edit's `training_details`: every field (pitfall #1), only the
   * attendance links on a finalized event, nothing for a reader.
   */
  const trainingUpdate = () => {
    if (trainingAccess === 'readonly') return undefined;
    const full = toUpdatePayload(training, durationHours);
    return trainingAccess === 'finalized' ? strippedForFinalized(full) : full;
  };

  const handleUpdate = async () => {
    if (!onSubmitUpdate) return;
    // The model's update payload: a blank sent as null, as the event form's.
    const { training_details: _none, ...eventFields } = model.buildSinglePayload();
    const details = trainingUpdate();
    const payload: EventUpdate = details ? { ...eventFields, training_details: details } : eventFields;
    setIsSubmitting(true);
    try {
      await onSubmitUpdate(payload);
    } catch (err: unknown) {
      showSubmitError(err, false);
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    const { event, training: trainingInvalid, messages } = collect();
    if (showErrors(event, trainingInvalid, messages)) return;
    clearAllErrors();
    if (editing) {
      await handleUpdate();
      return;
    }

    // Creates leave a blank out (pitfall #1). Always sent: the session is
    // what files the event's credit, under the title when there is no course.
    const single: EventCreate = {
      ...model.buildSinglePayload(),
      training_details: toAttachPayload(training, durationHours),
    };
    const recurring = creatingSeries && Boolean(onSubmitRecurring);
    setIsSubmitting(true);
    try {
      if (recurring && onSubmitRecurring) {
        const series = model.buildRecurringPayload(single);
        if ('error' in series) {
          showErrors({}, {}, [{ step: DETAILS, message: series.error }]);
          setIsSubmitting(false);
          return;
        }
        await onSubmitRecurring(series.recurring);
      } else {
        await onSubmit(single);
      }
    } catch (err: unknown) {
      showSubmitError(err, recurring);
      setIsSubmitting(false);
    }
  };

  const fullSubmitLabel = creatingSeries ? recurringSubmitLabel : submitLabel;
  const stepTitle = STEPS[step]?.title ?? '';

  // The session's fields are locked with the rest once attendance is
  // finalized, apart from Counts toward attendance; a training manager, who
  // cannot change it either, is not told they can.
  const lockBody = (
    <>
      <p id={model.lockNoticeId} className="text-theme-alert-warning-text text-sm">
        Its type, category, schedule, check-in rules and training details are locked because members&apos; credited
        hours were calculated from them.
        {trainingAccess === 'finalized' &&
          ' Counts toward attendance can still be changed: it changes how the session is graded, not members’ records.'}{' '}
        Title, description, location and directions, and the attendance, RSVP and notification settings, can still be
        edited.
      </p>
      <p className="text-theme-alert-warning-text text-sm">
        To change a locked setting, someone who can reopen attendance reopens it from the event page first.
        {model.initialRecurrence?.is_recurring &&
          ' To change these for later events in the series, edit one whose attendance is still open.'}
      </p>
    </>
  );

  return (
    <div className="space-y-8">
      {/* Above the steps, so every step opens under it. */}
      <NoticesSection model={model} show="lock" lockBody={lockBody} />

      {/* === Progress === */}
      <nav aria-label="Progress" className="card p-4 sm:p-6">
        <ol className="flex items-center justify-between">
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            const isActive = index === step;
            const isComplete = index < step;
            return (
              <React.Fragment key={item.title}>
                <li className="flex flex-col items-center" aria-current={isActive ? 'step' : undefined}>
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all sm:h-12 sm:w-12 ${
                      isComplete
                        ? 'border-green-700 bg-green-700'
                        : isActive
                          ? 'border-red-600 bg-red-800'
                          : 'bg-theme-input-bg border-theme-input-border'
                    }`}
                    aria-hidden="true"
                  >
                    {isComplete ? (
                      <CheckCircle className="h-6 w-6 text-white" />
                    ) : (
                      <Icon className={`h-6 w-6 ${isActive ? 'text-white' : 'text-theme-text-muted'}`} />
                    )}
                  </span>
                  <span
                    className={`mt-2 hidden text-sm font-medium sm:block ${
                      isActive ? 'text-theme-text-primary' : 'text-theme-text-muted'
                    }`}
                  >
                    {item.title}
                  </span>
                  <span className="sr-only">
                    {item.title}
                    {isComplete ? ' (completed)' : isActive ? ' (current step)' : ''}
                  </span>
                </li>
                {index < STEPS.length - 1 && (
                  <li aria-hidden="true" className="bg-theme-surface-hover mx-2 h-0.5 flex-1 sm:mx-4" />
                )}
              </React.Fragment>
            );
          })}
        </ol>
      </nav>

      {/* Under 768px the navigation is a bar fixed above the bottom nav, so
          the card leaves room for it to scroll clear. */}
      <div className="card space-y-8 p-4 max-md:pb-24 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <p id={STEP_HEADING_ID} tabIndex={-1} className="text-theme-text-muted text-sm focus:outline-hidden">
            Step {step + 1} of {STEPS.length} · {stepTitle}
          </p>
          {/* The phone's Cancel: the fixed bar holds only Previous and Next. */}
          <button
            type="button"
            onClick={() => {
              void requestCancel();
            }}
            className="touch-target-phone text-theme-text-secondary text-sm font-medium underline md:hidden"
          >
            Cancel
          </button>
        </div>

        <NoticesSection model={model} show="error" />

        {step === DETAILS && (
          <>
            <DetailsSection
              model={model}
              hideTypePicker={typeLocked}
              typeFirst
              typeHintId={TYPE_HINT_ID}
              typeHint={
                typeHint !== undefined ? (
                  typeHint
                ) : (
                  <p id={TYPE_HINT_ID} className="text-theme-text-muted mt-2 text-sm">
                    Training uses this step-by-step form. Pick another type to go back to the single-page form; your
                    entries carry over.
                  </p>
                )
              }
              beforeTitle={
                typeLocked && (
                  <div>
                    <span className="form-label">Event Type</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${getEventTypeBadgeColor(formData.event_type)}`}
                    >
                      Training
                    </span>
                    <p className="text-theme-text-muted mt-1 text-sm">{typeNote}</p>
                  </div>
                )
              }
              titlePlaceholder="e.g., CPR/AED Renewal Training"
              titleHint="Becomes the event title, and the course name when no course is chosen."
              categoryLabel="Event Category"
              categoryHint="The department's own event categories."
              markOptional
            />
            <hr className="border-theme-surface-border" />
            <ScheduleSection
              model={model}
              showRecurrence={!editing}
              rollingHint="Each new occurrence copies the training details and attendance links (set on the next step) from the latest one."
            />
            <hr className="border-theme-surface-border" />
            <LocationSection model={model} />
          </>
        )}

        {step === TRAINING && (
          <TrainingInfoStep
            value={training}
            onChange={updateTraining}
            onPickCourse={pickCourse}
            errors={trainingErrors}
            eventTitle={formData.title}
            durationHours={durationHours}
            courses={courses}
            members={members}
            linkageData={linkageData}
            membershipTypes={model.membershipTypes}
            isSeries={model.isRecurring}
            access={trainingAccess}
            readOnlyNotice={readOnlyNotice}
            storedCourseName={storedCourseName}
            coursesLoaded={coursesLoaded}
          />
        )}

        {step === SETTINGS && (
          <>
            <h2 className="text-theme-text-primary flex items-center space-x-2 text-xl font-bold">
              <SlidersHorizontal className="h-5 w-5 text-red-700" aria-hidden="true" />
              <span>Settings</span>
            </h2>
            {/* Opens on All members: ticking Mandatory with nothing narrower
                chosen means everyone, said on screen rather than refused,
                unless Counts toward attendance suggests who. */}
            <AttendanceSection
              model={prefill.attendanceModel}
              scopeOnTick="all"
              scopeNote={
                prefill.note && (
                  <MandatoryPrefillNote
                    note={prefill.note}
                    membershipTypes={model.membershipTypes}
                    mandatoryScope={model.mandatoryScope}
                  />
                )
              }
              scopeNotePlacement={prefill.note?.kind === 'not-filled' ? 'before' : 'after'}
            />
            <hr className="border-theme-surface-border" />
            <RsvpSection
              model={model}
              variant="steps"
              maxAttendeesFromCourse={
                Boolean(selectedCourse?.max_participants) && formData.max_attendees === selectedCourse?.max_participants
              }
            />
            <hr className="border-theme-surface-border" />
            <CheckInSection
              model={model}
              variant="steps"
              intro={
                <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                  <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-green-700" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-green-800 dark:text-green-300">QR Code Check-In</p>
                    <p className="text-theme-text-secondary text-sm">
                      A QR code will be automatically generated for this training. Members can scan it to check in and
                      verify their attendance.
                    </p>
                  </div>
                </div>
              }
            />
            <hr className="border-theme-surface-border" />
            <NotificationsSection model={model} />
          </>
        )}

        {step === REVIEW && (
          <>
            <TrainingReviewStep
              model={model}
              training={training}
              durationHours={durationHours}
              courses={courses}
              linkageData={linkageData}
              onEdit={(target) => {
                clearAllErrors();
                goTo(REVIEW_TARGET_STEP[target]);
              }}
              editing={editing}
              original={originalTraining}
              scopeChoice={scopeChoice}
              organizerNames={organizerNames}
              storedCourseName={storedCourseName}
              unmapped={formData.is_mandatory && prefill.note ? prefill.note.unmapped : []}
              seriesOccurrence={seriesOccurrence}
            />
            <AttachmentsSection existingAttachments={model.existingAttachments} />
            {model.existingAttachments.length > 0 && (
              <p className="text-theme-text-muted text-sm">Attachments are managed on the event page.</p>
            )}
            <div>
              <label className="text-theme-text-secondary mobile-touch-target inline-flex cursor-pointer items-center justify-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.is_draft || false}
                  onChange={(e) => model.setIsDraft(e.target.checked)}
                  aria-describedby="training-draft-hint"
                  className="form-checkbox"
                />
                Save as Draft
              </label>
              <p id="training-draft-hint" className="text-theme-text-muted text-sm">
                Members don&apos;t see a draft. Publish it later from the event page.
              </p>
            </div>
          </>
        )}

        {/* === Navigation === inside the card from 768px; under it, a bar
            fixed above the bottom nav (action-bar-safe clears it and the
            home indicator, pitfall #21), Previous one share and Next two. */}
        <div
          role="group"
          aria-label="Step navigation"
          className="border-theme-surface-border max-md:bg-theme-nav-bg max-md:action-bar-safe flex items-center gap-3 border-t pt-6 max-md:fixed max-md:right-0 max-md:bottom-0 max-md:left-[var(--side-nav-width,0px)] max-md:z-30 max-md:gap-2 max-md:px-4 max-md:shadow-[0_-4px_12px_rgb(0_0_0/0.08)]"
        >
          <button
            type="button"
            onClick={handlePrevious}
            disabled={step === DETAILS}
            className="btn-secondary flex items-center justify-center gap-1 px-5 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 max-md:min-w-0 max-md:flex-1 max-md:px-3"
          >
            <ChevronLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
            Previous
          </button>
          <div className="ml-auto flex gap-3 max-md:ml-0 max-md:min-w-0 max-md:flex-[2]">
            <button
              type="button"
              onClick={() => {
                void requestCancel();
              }}
              className="btn-secondary px-5 py-3 text-sm font-medium max-md:hidden"
            >
              Cancel
            </button>
            {step < REVIEW ? (
              <button
                type="button"
                onClick={handleNext}
                className="btn-primary flex items-center justify-center gap-1 px-6 py-3 text-sm font-medium max-md:w-full max-md:px-3"
              >
                Next
                <ChevronRight className="h-5 w-5 shrink-0" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void handleSubmit();
                }}
                disabled={isSubmitting}
                aria-label={isSubmitting ? submittingLabel : fullSubmitLabel}
                className="btn-primary flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium disabled:cursor-not-allowed max-md:w-full max-md:px-3"
              >
                {isSubmitting ? (
                  submittingLabel
                ) : creatingSeries ? (
                  <>
                    <span className="hidden min-[480px]:inline">{recurringSubmitLabel}</span>
                    <span className="min-[480px]:hidden">{recurringSubmitShortLabel}</span>
                  </>
                ) : (
                  submitLabel
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
