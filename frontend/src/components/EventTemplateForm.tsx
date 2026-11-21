/**
 * Event Template Form
 *
 * Form component for creating and editing event templates.
 * Includes all configurable template fields organized in collapsible sections.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { EventTemplate, EventTemplateCreate } from '../types/event';
import type { TrainingCourse } from '../types/training';
import type { User } from '../types/user';
import { EventType, isActiveAccount } from '../constants/enums';
import { getEventTypeLabel } from '../utils/eventHelpers';
import { displayNameOf } from '../utils/memberName';
import { trainingService, userService } from '../services/api';
import { useRanks } from '../hooks/useRanks';
import { FIELD_ERROR_CLASS, FormField } from './ux/FormField';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../hooks/useFieldErrors';
import type { TrainingLinkageData } from '../hooks/useTrainingLinkageData';
import { TrainingInfoStep } from './training-event/TrainingInfoStep';
import {
  DEFAULT_TRAINING_DETAILS,
  TRAINING_FIELDS,
  applyLibraryCourse,
  fromTemplateTrainingDetails,
  reconcileTemplateTraining,
  toTemplateTrainingDetails,
  withCourseChoice,
  type InstructorOption,
  type TrainingDetailsForm,
  type TrainingField,
} from './training-event/trainingDetailsModel';

interface EventTemplateFormProps {
  initialData?: EventTemplate | undefined;
  onSubmit: (data: EventTemplateCreate) => void | Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: EventType.BUSINESS_MEETING, label: getEventTypeLabel(EventType.BUSINESS_MEETING) },
  { value: EventType.PUBLIC_EDUCATION, label: getEventTypeLabel(EventType.PUBLIC_EDUCATION) },
  { value: EventType.TRAINING, label: getEventTypeLabel(EventType.TRAINING) },
  { value: EventType.SOCIAL, label: getEventTypeLabel(EventType.SOCIAL) },
  { value: EventType.FUNDRAISER, label: getEventTypeLabel(EventType.FUNDRAISER) },
  { value: EventType.CEREMONY, label: getEventTypeLabel(EventType.CEREMONY) },
  { value: EventType.RECRUITMENT, label: getEventTypeLabel(EventType.RECRUITMENT) },
  { value: EventType.OTHER, label: getEventTypeLabel(EventType.OTHER) },
];

const CHECK_IN_WINDOW_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'flexible', label: 'Flexible' },
  { value: 'strict', label: 'Strict' },
  { value: 'window', label: 'Window' },
];

/** The training fields a template carries, drawn by TrainingInfoStep's template variant. */
const TEMPLATE_TRAINING_FIELDS = [
  'course_id',
  'course_name',
  'course_code',
  'training_type',
  'credit_hours',
  'instructor_id',
  'issuing_agency',
  'certification_number_prefix',
  'expiration_months',
] as const satisfies readonly TrainingField[];
type TemplateTrainingField = (typeof TEMPLATE_TRAINING_FIELDS)[number];

type TemplateField =
  'name' | 'description' | 'default_title' | 'default_description' | 'default_location' | TemplateTrainingField;

const trainingSpec = (field: TemplateTrainingField) => {
  const spec = TRAINING_FIELDS[field];
  return { id: spec.id, label: spec.label, apiKeys: typeof spec.api === 'string' ? [spec.api] : spec.api };
};

// EventTemplateCreate has no alias generator, so a 422 names the snake_case
// request keys, which are these field names; a training detail's is
// `training_details.<field>`, the same paths the training form maps.
const TEMPLATE_FIELDS: FieldSpecs<TemplateField> = {
  name: { id: 'template-name', label: 'Template Name' },
  description: { id: 'template-description', label: 'Description' },
  ...Object.fromEntries(TEMPLATE_TRAINING_FIELDS.map((field) => [field, trainingSpec(field)])),
  default_title: { id: 'template-default-title', label: 'Default Title' },
  default_description: { id: 'template-default-description', label: 'Default Description' },
  default_location: { id: 'template-default-location', label: 'Default Location' },
} as FieldSpecs<TemplateField>;

/** A template carries no requirement or program links, so the step's pickers have nothing to offer. */
const NO_LINKAGE: TrainingLinkageData = { categories: [], requirements: [], programs: [], phases: [] };

/**
 * The refusals the backend's EventTemplateTrainingDetails makes, checked here
 * so each lands on its field rather than on the course choice a model-level
 * 422 is reported against. Nothing the backend accepts is refused: hours that
 * follow the event's length need no figure on a template, which has no date.
 */
const checkTemplateTraining = (value: TrainingDetailsForm): FieldErrors<TemplateField> => {
  const problems: FieldErrors<TemplateField> = {};
  if (value.course_mode === 'library' && !value.course_id) {
    problems.course_id = 'Choose a course from the Course Library.';
  }
  if (value.course_mode === 'oneoff' && !value.course_name.trim()) {
    problems.course_name = 'Enter a course name.';
  }
  if (value.credit_hours_source === 'manual') {
    const hours = value.credit_hours.trim();
    if (!hours) problems.credit_hours = "Enter the credit hours, or let them follow the event's length.";
    else if (!(Number(hours) >= 0)) problems.credit_hours = 'Credit hours must be 0 or more.';
  }
  if (value.issues_certification && value.expiration_months.trim()) {
    const months = value.expiration_months.trim();
    if (!/^\d+$/.test(months) || Number(months) < 1) {
      problems.expiration_months = 'Enter a whole number of months, or leave it blank.';
    }
  }
  return problems;
};

const inputClass = 'form-input px-3 text-sm';
const selectClass = 'form-input px-3 text-sm';
const labelClass = 'form-label';
const checkboxClass = 'form-checkbox';

interface TemplateTrainingSectionProps {
  value: TrainingDetailsForm;
  setValue: React.Dispatch<React.SetStateAction<TrainingDetailsForm>>;
  /** The stored details, until they have been checked against the lists. */
  seeded: TrainingDetailsForm | undefined;
  onSeededRead: (notes: string[]) => void;
  notes: readonly string[];
  errors: Partial<Record<TrainingField, string>>;
  clearErrors: (keys: string[]) => void;
  eventTitle: string;
  durationHours: number | null;
}

/**
 * The editor's Training Details: TrainingInfoStep's template variant, with
 * the Course Library and member list it picks from.
 */
const TemplateTrainingSection: React.FC<TemplateTrainingSectionProps> = ({
  value,
  setValue,
  seeded,
  onSeededRead,
  notes,
  errors,
  clearErrors,
  eventTitle,
  durationHours,
}) => {
  const { formatRank } = useRanks(false);
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [coursesSettled, setCoursesSettled] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersSettled, setUsersSettled] = useState(false);

  useEffect(() => {
    trainingService
      .getCourses()
      .then((list) => {
        setCourses(list);
        setCoursesLoaded(true);
      })
      .catch(() => {
        /* non-critical: the library choice offers nothing */
      })
      .finally(() => setCoursesSettled(true));
    userService
      .getUsers()
      .then((list) => {
        setUsers(list);
        setUsersLoaded(true);
      })
      .catch(() => {
        /* non-critical: the lead instructor list is empty */
      })
      .finally(() => setUsersSettled(true));
  }, []);

  const members = useMemo<InstructorOption[]>(
    () =>
      users.map((user) => {
        const memberName = displayNameOf(user) || user.username;
        return {
          id: user.id,
          name: memberName,
          label: user.rank ? `${memberName} (${formatRank(user.rank)})` : memberName,
          former: !isActiveAccount(user.status),
        };
      }),
    [users, formatRank]
  );

  // The stored details checked once against the lists they name, as applying
  // the template does, so the editor shows what picking it would fill. A
  // list that failed to load is skipped rather than taken as empty.
  useEffect(() => {
    if (!seeded || !coursesSettled || !usersSettled) return;
    const listedCourses = coursesLoaded ? courses : undefined;
    const listedMembers = usersLoaded ? members : undefined;
    onSeededRead(reconcileTemplateTraining(value, seeded, listedCourses, listedMembers).notes);
    setValue((prev) => reconcileTemplateTraining(prev, seeded, listedCourses, listedMembers).value);
  }, [
    seeded,
    coursesSettled,
    usersSettled,
    coursesLoaded,
    usersLoaded,
    courses,
    members,
    value,
    onSeededRead,
    setValue,
  ]);

  const update = (patch: Partial<TrainingDetailsForm>) => {
    setValue((prev) => {
      const next = { ...prev, ...patch };
      const courseOf = (v: TrainingDetailsForm) => courses.find((c) => c.id === v.course_id);
      return withCourseChoice(next, courseOf(next), { value: prev, course: courseOf(prev) });
    });
    clearErrors(Object.keys(patch));
  };
  // Pre-fills type, hours, instructor and expiry as the training form does.
  // A course's participant limit is not copied into Max Attendees: the
  // template's own is authoritative, and the category and program it fills
  // are not saved on a template.
  const pickCourse = (course: TrainingCourse | undefined) => {
    if (!course) {
      update({ course_id: '' });
      return;
    }
    const picked = applyLibraryCourse(
      value,
      course,
      members.filter((m) => !m.former),
      undefined,
      value.course_mode === 'library' ? courses.find((c) => c.id === value.course_id) : undefined
    );
    setValue(picked);
    clearErrors([
      'course_id',
      ...(Object.keys(picked) as (keyof TrainingDetailsForm)[]).filter((key) => picked[key] !== value[key]),
    ]);
  };

  return (
    <TrainingInfoStep
      variant="template"
      value={value}
      onChange={update}
      onPickCourse={pickCourse}
      errors={errors}
      eventTitle={eventTitle}
      durationHours={durationHours}
      courses={courses}
      members={members}
      linkageData={NO_LINKAGE}
      isSeries={false}
      coursesLoaded={coursesLoaded}
      templateNotes={notes}
    />
  );
};

export const EventTemplateForm: React.FC<EventTemplateFormProps> = ({
  initialData,
  onSubmit,
  onCancel,
  isSubmitting = false,
  submitLabel = 'Save Template',
}) => {
  // Basic fields
  const [name, setName] = useState(initialData?.name ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [eventType, setEventType] = useState(initialData?.event_type ?? EventType.BUSINESS_MEETING);
  const [defaultTitle, setDefaultTitle] = useState(initialData?.default_title ?? '');
  const [defaultDescription, setDefaultDescription] = useState(initialData?.default_description ?? '');

  // Location & Duration
  const [defaultLocation, setDefaultLocation] = useState(initialData?.default_location ?? '');
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(
    initialData?.default_duration_minutes?.toString() ?? ''
  );

  // RSVP & Attendance
  const [requiresRsvp, setRequiresRsvp] = useState(initialData?.requires_rsvp ?? false);
  const [maxAttendees, setMaxAttendees] = useState(initialData?.max_attendees?.toString() ?? '');
  const [isMandatory, setIsMandatory] = useState(initialData?.is_mandatory ?? false);
  const [allowGuests, setAllowGuests] = useState(initialData?.allow_guests ?? false);
  // null is the "inherit the org default" state and is a real choice, so it is
  // held as null rather than coerced to a string.
  const [attendeeVisibility, setAttendeeVisibility] = useState<'members' | 'managers' | null>(
    initialData?.attendee_visibility ?? null
  );

  // Reminders
  const [sendReminders, setSendReminders] = useState(initialData?.send_reminders ?? false);
  // A template saved with reminders off persists reminder_target 'none', but
  // the audience select only offers 'going'/'all' — coerce so the select never
  // shows one value while state holds another, and so re-enabling reminders
  // can never submit 'none' (an audience the scheduler silently skips).
  const [reminderTarget, setReminderTarget] = useState<'going' | 'all' | 'none'>(
    initialData?.reminder_target === 'none' ? 'going' : (initialData?.reminder_target ?? 'going')
  );
  const reminderAudienceEdited = useRef(initialData?.reminder_target !== undefined);
  const [reminderSchedule, setReminderSchedule] = useState(initialData?.reminder_schedule?.join(', ') ?? '');

  // Check-in settings
  const [checkInWindowType, setCheckInWindowType] = useState(initialData?.check_in_window_type ?? '');
  const [checkInMinutesBefore, setCheckInMinutesBefore] = useState(
    initialData?.check_in_minutes_before?.toString() ?? ''
  );
  const [checkInMinutesAfter, setCheckInMinutesAfter] = useState(initialData?.check_in_minutes_after?.toString() ?? '');
  const [requireCheckout, setRequireCheckout] = useState(initialData?.require_checkout ?? false);

  // Collapsible sections
  const [showRsvpSection, setShowRsvpSection] = useState(
    !!(initialData?.requires_rsvp || initialData?.is_mandatory || initialData?.allow_guests)
  );
  const [showCheckInSection, setShowCheckInSection] = useState(
    !!(initialData?.check_in_window_type || initialData?.require_checkout)
  );
  const [showReminderSection, setShowReminderSection] = useState(!!initialData?.send_reminders);

  const fieldErrors = useFieldErrors(TEMPLATE_FIELDS);

  // Training details (owner decision 2026-11-20): Training templates only.
  // Held here so they survive a change of type and back, as typed values do;
  // the section that loads the Course Library and member list mounts only
  // while the type is Training, so a template of any other type makes no
  // such request.
  const isTraining = eventType === EventType.TRAINING;
  const [seededTraining, setSeededTraining] = useState<TrainingDetailsForm | undefined>(() =>
    initialData?.event_type === EventType.TRAINING && initialData.training_details
      ? fromTemplateTrainingDetails(initialData.training_details)
      : undefined
  );
  const [training, setTraining] = useState<TrainingDetailsForm>(seededTraining ?? DEFAULT_TRAINING_DETAILS);
  const [trainingNotes, setTrainingNotes] = useState<string[]>([]);
  const onSeededTrainingRead = useCallback((notes: string[]) => {
    setTrainingNotes(notes);
    setSeededTraining(undefined);
  }, []);
  const clearTrainingErrors = (keys: string[]) => {
    for (const key of keys) {
      if ((TEMPLATE_TRAINING_FIELDS as readonly string[]).includes(key)) {
        fieldErrors.setError(key as TemplateTrainingField, null);
      }
    }
  };
  const trainingErrors: Partial<Record<TrainingField, string>> = Object.fromEntries(
    TEMPLATE_TRAINING_FIELDS.flatMap((field) => {
      const message = fieldErrors.errors[field];
      return message ? [[field, message]] : [];
    })
  );
  const durationMinutes = parseInt(defaultDurationMinutes, 10);
  const templateHours = durationMinutes > 0 ? Math.round((durationMinutes / 60) * 100) / 100 : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Checked here rather than by the browser's required bubble, which
    // vanished after a few seconds and was tied to no field (forms review F-3).
    const problems: FieldErrors<TemplateField> = isTraining ? checkTemplateTraining(training) : {};
    if (!name.trim()) problems.name = 'Enter a name for the template.';
    fieldErrors.setFormError(null);
    fieldErrors.setErrors(problems);
    if (Object.keys(problems).length > 0) {
      fieldErrors.focusFirst(problems);
      return;
    }

    // Parse reminder schedule: comma-separated numbers (hours before event)
    const parsedReminders = reminderSchedule
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    const data: EventTemplateCreate = {
      name: name.trim(),
      event_type: eventType,
      requires_rsvp: requiresRsvp,
      is_mandatory: isMandatory,
      allow_guests: allowGuests,
      // Always sent, including as null: a template that had an override and
      // goes back to inheriting must persist that, and an omitted key means
      // "leave alone" on the update path.
      attendee_visibility: attendeeVisibility,
      send_reminders: sendReminders,
      reminder_target: sendReminders ? reminderTarget : 'none',
      require_checkout: requireCheckout,
    };

    // A create omits blank optional fields; an edit sends them as null, because
    // an omitted key means "leave alone" on the update path and a cleared field
    // came back unchanged after Save (workflow review W21, CLAUDE.md pitfall 1).
    const isEdit = initialData !== undefined;
    const trimmedDescription = description.trim();
    if (trimmedDescription) data.description = trimmedDescription;
    else if (isEdit) data.description = null;
    const trimmedDefaultTitle = defaultTitle.trim();
    if (trimmedDefaultTitle) data.default_title = trimmedDefaultTitle;
    else if (isEdit) data.default_title = null;
    const trimmedDefaultDescription = defaultDescription.trim();
    if (trimmedDefaultDescription) data.default_description = trimmedDefaultDescription;
    else if (isEdit) data.default_description = null;
    const trimmedDefaultLocation = defaultLocation.trim();
    if (trimmedDefaultLocation) data.default_location = trimmedDefaultLocation;
    else if (isEdit) data.default_location = null;
    const parsedDuration = parseInt(defaultDurationMinutes, 10);
    if (parsedDuration > 0) data.default_duration_minutes = parsedDuration;
    else if (isEdit) data.default_duration_minutes = null;
    const parsedMaxAttendees = parseInt(maxAttendees, 10);
    if (parsedMaxAttendees > 0) data.max_attendees = parsedMaxAttendees;
    else if (isEdit) data.max_attendees = null;
    // [] rather than null: the column is NOT NULL JSON. An event created from a
    // template with no schedule falls back to the organization's event-reminder
    // rule at send time, exactly as a create that omitted the field does.
    if (parsedReminders.length > 0) data.reminder_schedule = parsedReminders;
    else if (isEdit) data.reminder_schedule = [];
    if (checkInWindowType) data.check_in_window_type = checkInWindowType as 'flexible' | 'strict' | 'window';
    else if (isEdit) data.check_in_window_type = null;
    const parsedMinsBefore = parseInt(checkInMinutesBefore, 10);
    if (checkInMinutesBefore.trim() && parsedMinsBefore >= 0) data.check_in_minutes_before = parsedMinsBefore;
    else if (isEdit) data.check_in_minutes_before = null;
    const parsedMinsAfter = parseInt(checkInMinutesAfter, 10);
    if (checkInMinutesAfter.trim() && parsedMinsAfter >= 0) data.check_in_minutes_after = parsedMinsAfter;
    else if (isEdit) data.check_in_minutes_after = null;
    // Training: the whole object on every save, so a cleared field is stored
    // cleared (pitfall #1). Another type: null on an edit, which drops what a
    // Training template stored; left out on a create.
    if (isTraining) data.training_details = toTemplateTrainingDetails(training);
    else if (isEdit) data.training_details = null;

    // A caller that lets a failed save reject has its 422 shown on the field
    // it names, and anything else inside the form rather than lost.
    try {
      await onSubmit(data);
    } catch (err: unknown) {
      fieldErrors.focusFirst(fieldErrors.setFromApiError(err, 'Could not save the template. Try again.'));
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
      {fieldErrors.formError && (
        <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
          {fieldErrors.formError}
        </p>
      )}
      {/* Basic Information */}
      <div className="space-y-4">
        <h3 className="text-theme-text-primary text-sm font-semibold tracking-wider uppercase">Basic Information</h3>

        <FormField
          id={TEMPLATE_FIELDS.name.id}
          label="Template Name"
          required
          error={fieldErrors.errors.name}
          labelClassName={labelClass}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              maxLength={200}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                fieldErrors.setError('name', null);
              }}
              className={`${inputClass} ${fieldErrors.errors.name ? 'border-red-500' : ''}`}
              placeholder="e.g., Monthly Business Meeting"
            />
          )}
        </FormField>

        <FormField
          id={TEMPLATE_FIELDS.description.id}
          label="Description"
          error={fieldErrors.errors.description}
          labelClassName={labelClass}
        >
          {(field) => (
            <textarea
              {...field}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                fieldErrors.setError('description', null);
              }}
              className={inputClass}
              rows={2}
              placeholder="Brief description of what this template is for"
            />
          )}
        </FormField>

        <div>
          <label htmlFor="template-event-type" className={labelClass}>
            Event Type
          </label>
          <select
            id="template-event-type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as typeof eventType)}
            className={selectClass}
          >
            {EVENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isTraining && (
        <TemplateTrainingSection
          value={training}
          setValue={setTraining}
          seeded={seededTraining}
          onSeededRead={onSeededTrainingRead}
          notes={trainingNotes}
          errors={trainingErrors}
          clearErrors={clearTrainingErrors}
          eventTitle={defaultTitle}
          durationHours={templateHours}
        />
      )}

      {/* Default Event Values */}
      <div className="space-y-4">
        <h3 className="text-theme-text-primary text-sm font-semibold tracking-wider uppercase">Default Event Values</h3>

        <FormField
          id={TEMPLATE_FIELDS.default_title.id}
          label="Default Title"
          error={fieldErrors.errors.default_title}
          labelClassName={labelClass}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              maxLength={200}
              value={defaultTitle}
              onChange={(e) => {
                setDefaultTitle(e.target.value);
                fieldErrors.setError('default_title', null);
              }}
              className={inputClass}
              placeholder="Pre-filled event title"
            />
          )}
        </FormField>

        <FormField
          id={TEMPLATE_FIELDS.default_description.id}
          label="Default Description"
          error={fieldErrors.errors.default_description}
          labelClassName={labelClass}
        >
          {(field) => (
            <textarea
              {...field}
              value={defaultDescription}
              onChange={(e) => {
                setDefaultDescription(e.target.value);
                fieldErrors.setError('default_description', null);
              }}
              className={inputClass}
              rows={3}
              placeholder="Pre-filled event description"
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            id={TEMPLATE_FIELDS.default_location.id}
            label="Default Location"
            error={fieldErrors.errors.default_location}
            labelClassName={labelClass}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                maxLength={300}
                value={defaultLocation}
                onChange={(e) => {
                  setDefaultLocation(e.target.value);
                  fieldErrors.setError('default_location', null);
                }}
                className={inputClass}
                placeholder="e.g., Station 1 Meeting Room"
              />
            )}
          </FormField>
          <div>
            <label htmlFor="template-default-duration" className={labelClass}>
              Default Duration (minutes)
            </label>
            <input
              id="template-default-duration"
              type="number"
              min={1}
              value={defaultDurationMinutes}
              onChange={(e) => setDefaultDurationMinutes(e.target.value)}
              className={inputClass}
              placeholder="60"
            />
          </div>
        </div>
      </div>

      {/* RSVP & Attendance (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowRsvpSection((prev) => !prev)}
          className="text-theme-text-primary hover:text-theme-text-secondary flex w-full items-center gap-2 text-sm font-semibold tracking-wider uppercase transition-colors"
        >
          {showRsvpSection ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          RSVP & Attendance
        </button>
        {showRsvpSection && (
          <div className="mt-4 space-y-4 pl-6">
            <div className="flex items-center gap-3">
              <input
                id="template-requires-rsvp"
                type="checkbox"
                checked={requiresRsvp}
                onChange={(e) => setRequiresRsvp(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="template-requires-rsvp" className="text-theme-text-primary text-sm">
                Requires RSVP
              </label>
            </div>

            {requiresRsvp && (
              <div>
                <label htmlFor="template-max-attendees" className={labelClass}>
                  Max Attendees
                </label>
                <input
                  id="template-max-attendees"
                  type="number"
                  min={1}
                  value={maxAttendees}
                  onChange={(e) => setMaxAttendees(e.target.value)}
                  className={`${inputClass} max-w-xs`}
                  placeholder="Unlimited"
                />
              </div>
            )}

            <div className="flex items-center gap-3">
              <input
                id="template-is-mandatory"
                type="checkbox"
                checked={isMandatory}
                onChange={(e) => {
                  const mandatory = e.target.checked;
                  setIsMandatory(mandatory);
                  if (!reminderAudienceEdited.current) {
                    setReminderTarget(mandatory ? 'all' : 'going');
                    setSendReminders(true);
                  }
                }}
                className={checkboxClass}
              />
              <label htmlFor="template-is-mandatory" className="text-theme-text-primary text-sm">
                Mandatory attendance
              </label>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="template-allow-guests"
                type="checkbox"
                checked={allowGuests}
                onChange={(e) => setAllowGuests(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="template-allow-guests" className="text-theme-text-primary text-sm">
                Allow guests
              </label>
            </div>

            <div>
              <label htmlFor="template-attendee-visibility" className={labelClass}>
                Who can see who&apos;s going
              </label>
              <select
                id="template-attendee-visibility"
                value={attendeeVisibility ?? ''}
                onChange={(e) => setAttendeeVisibility((e.target.value || null) as 'members' | 'managers' | null)}
                className={selectClass}
              >
                <option value="">Use organization default</option>
                <option value="members">Everyone in the department</option>
                <option value="managers">Only event managers</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Reminders (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowReminderSection((prev) => !prev)}
          className="text-theme-text-primary hover:text-theme-text-secondary flex w-full items-center gap-2 text-sm font-semibold tracking-wider uppercase transition-colors"
        >
          {showReminderSection ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          Reminders
        </button>
        {showReminderSection && (
          <div className="mt-4 space-y-4 pl-6">
            <div className="flex items-center gap-3">
              <input
                id="template-send-reminders"
                type="checkbox"
                checked={sendReminders}
                onChange={(e) => {
                  // Enabling reminders does not choose an audience. Keep the
                  // mandatory-template default available until the user picks
                  // an audience, while still respecting an explicit disable.
                  if (!e.target.checked) {
                    reminderAudienceEdited.current = true;
                  }
                  setSendReminders(e.target.checked);
                  // Belt-and-braces with the state initializer above: turning
                  // reminders on must never leave 'none' as the audience.
                  if (e.target.checked && reminderTarget === 'none') {
                    setReminderTarget('going');
                  }
                }}
                className={checkboxClass}
              />
              <label htmlFor="template-send-reminders" className="text-theme-text-primary text-sm">
                Send reminders
              </label>
            </div>

            {sendReminders && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="template-reminder-target" className={labelClass}>
                    Who should receive reminders?
                  </label>
                  <select
                    id="template-reminder-target"
                    value={reminderTarget}
                    onChange={(e) => {
                      reminderAudienceEdited.current = true;
                      setReminderTarget(e.target.value as 'going' | 'all' | 'none');
                    }}
                    className={inputClass}
                  >
                    <option value="going">Members who sign up</option>
                    <option value="all">All active members</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="template-reminder-schedule" className={labelClass}>
                    Reminder Schedule (hours before event, comma-separated)
                  </label>
                  <input
                    id="template-reminder-schedule"
                    type="text"
                    value={reminderSchedule}
                    onChange={(e) => setReminderSchedule(e.target.value)}
                    className={inputClass}
                    placeholder="24, 2"
                  />
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Enter hours before the event when reminders should be sent.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Check-in Settings (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowCheckInSection((prev) => !prev)}
          className="text-theme-text-primary hover:text-theme-text-secondary flex w-full items-center gap-2 text-sm font-semibold tracking-wider uppercase transition-colors"
        >
          {showCheckInSection ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          Check-in Settings
        </button>
        {showCheckInSection && (
          <div className="mt-4 space-y-4 pl-6">
            <div>
              <label htmlFor="template-checkin-window" className={labelClass}>
                Check-in Window Type
              </label>
              <select
                id="template-checkin-window"
                value={checkInWindowType}
                onChange={(e) => setCheckInWindowType(e.target.value)}
                className={`${selectClass} max-w-xs`}
              >
                {CHECK_IN_WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {checkInWindowType === 'window' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="template-checkin-before" className={labelClass}>
                    Minutes Before Start
                  </label>
                  <input
                    id="template-checkin-before"
                    type="number"
                    min={0}
                    value={checkInMinutesBefore}
                    onChange={(e) => setCheckInMinutesBefore(e.target.value)}
                    className={inputClass}
                    placeholder="15"
                  />
                </div>
                <div>
                  <label htmlFor="template-checkin-after" className={labelClass}>
                    Minutes After End
                  </label>
                  <input
                    id="template-checkin-after"
                    type="number"
                    min={0}
                    value={checkInMinutesAfter}
                    onChange={(e) => setCheckInMinutesAfter(e.target.value)}
                    className={inputClass}
                    placeholder="30"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <input
                id="template-require-checkout"
                type="checkbox"
                checked={requireCheckout}
                onChange={(e) => setRequireCheckout(e.target.checked)}
                className={checkboxClass}
              />
              <label htmlFor="template-require-checkout" className="text-theme-text-primary text-sm">
                Require checkout
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Form Actions */}
      <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="btn-secondary text-theme-text-secondary text-sm font-medium"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
};
