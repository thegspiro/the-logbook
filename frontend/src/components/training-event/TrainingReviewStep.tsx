/**
 * The training-event wizard's Review step: every value the save will send,
 * section by section, each with a way back to the step that sets it. Values
 * are read from the same model and training value the payload is built from,
 * so what is reviewed is what is saved.
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Award,
  Bell,
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  Link2,
  MapPin,
  Pencil,
  QrCode,
  Repeat,
  UserCheck,
  Users,
} from 'lucide-react';
import { SimpleMarkdown } from '../../utils/simpleMarkdown';
import type { MandatoryTiersUnmapped, TrainingCourse } from '../../types/training';
import type { TrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';
import { getEventTypeBadgeColor, getEventTypeLabel } from '../../utils/eventHelpers';
import { formatCalendarDate, formatDateCustom, localToUTC } from '../../utils/dateFormatting';
import type { EventFormModel } from '../event-form/useEventFormModel';
import { MONTHS, ORDINALS, RECURRENCE_PATTERNS, WEEKDAYS } from '../event-form/eventFormConstants';
import { linkedAttendanceLabel } from '../../hooks/useRetiredAttendanceRequirements';
import type { TrainingDetailsForm } from './trainingDetailsModel';
import { creditHoursFromCourse, effectiveCreditHours } from './trainingDetailsModel';

/** On a series edit: the occurrence being edited and its series' first, as ISO instants. */
export interface SeriesOccurrence {
  occurrenceStart?: string | undefined;
  seriesStart?: string | undefined;
  /**
   * The start of the nearest earlier occurrence whose attendance is
   * finalized: "This and all future events" leaves it alone.
   */
  finalizedBefore?: string | undefined;
}

const WEEKDAY_PLURALS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

type ReviewModel = Pick<
  EventFormModel,
  | 'tz'
  | 'formData'
  | 'showOrganizerPickers'
  | 'organizerOptions'
  | 'organizerId'
  | 'alternateId'
  | 'customCategories'
  | 'membershipTypes'
  | 'mandatoryForEveryone'
  | 'isRecurring'
  | 'recurrencePattern'
  | 'isRolling'
  | 'recurrenceEndDate'
  | 'recurrenceCustomDays'
  | 'recurrenceWeekOrdinal'
  | 'recurrenceWeekday'
  | 'recurrenceMonth'
  | 'recurrenceExceptions'
  | 'selectedLocation'
  | 'locationMode'
  | 'formatLocationLabel'
>;

/** The wizard's steps a section's Edit link can go back to. */
export type ReviewTarget = 'details' | 'training' | 'settings';

interface TrainingReviewStepProps {
  model: ReviewModel;
  training: TrainingDetailsForm;
  durationHours: number | null;
  courses: TrainingCourse[];
  linkageData: TrainingLinkageData;
  onEdit: (target: ReviewTarget) => void;
  /** An edit: the heading says so, and the recurrence is shown for reference only. */
  editing?: boolean | undefined;
  /** The training details as stored, so a changed value can say what it was. */
  original?: TrainingDetailsForm | undefined;
  /** Drawn first: on a series edit, which occurrences the save reaches. */
  scopeChoice?: React.ReactNode;
  /** On an edit, who runs the event; changed with Transfer on the event page. */
  organizerNames?: { organizer?: string | null | undefined; alternate?: string | null | undefined } | undefined;
  /** The stored session's course name, for a course the library no longer lists. */
  storedCourseName?: string | undefined;
  /** Ticked requirements the Mandatory-for pre-fill could not map, with why. */
  unmapped?: readonly MandatoryTiersUnmapped[] | undefined;
  seriesOccurrence?: SeriesOccurrence | undefined;
  /** Linked attendance requirements no longer offered, id to name. */
  retiredAttendanceNames?: Readonly<Record<string, string>> | undefined;
}

const hoursLabel = (hours: number | string) => `${hours} ${Number(hours) === 1 ? 'hour' : 'hours'}`;

const DATE_ONLY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
/** "Mon, Nov 16, 2026, 7:00 PM", as the approved Review reads. */
const DATE_TIME: Intl.DateTimeFormatOptions = { ...DATE_ONLY, hour: 'numeric', minute: '2-digit' };

const reminderLabel = (hours: number) =>
  hours >= 168
    ? `${Math.floor(hours / 168)} week${hours >= 336 ? 's' : ''} before`
    : hours >= 24
      ? `${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''} before`
      : `${hours} hour${hours !== 1 ? 's' : ''} before`;

const Section: React.FC<{
  title: string;
  icon: LucideIcon;
  target: ReviewTarget;
  /** Absent for a section the form cannot change. */
  onEdit?: ((target: ReviewTarget) => void) | undefined;
  children: React.ReactNode;
}> = ({ title, icon: Icon, target, onEdit, children }) => (
  <section className="border-theme-surface-border rounded-lg border p-4 sm:p-5">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-theme-text-primary flex items-center gap-2 font-semibold">
        <Icon className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
        {title}
      </h3>
      {onEdit && (
        <button
          type="button"
          onClick={() => onEdit(target)}
          aria-label={`Edit ${title}`}
          className="btn-secondary touch:min-h-11 inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit
        </button>
      )}
    </div>
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,2fr)_3fr]">{children}</dl>
  </section>
);

const Row: React.FC<{
  label: string;
  children: React.ReactNode;
  was?: string | undefined;
  /** Rendered markdown keeps its own line breaks. */
  markdown?: boolean | undefined;
}> = ({ label, children, was, markdown = false }) => (
  <>
    <dt className="text-theme-text-muted">{label}</dt>
    <dd className={`text-theme-text-primary font-medium break-words ${markdown ? '' : 'whitespace-pre-line'}`}>
      {children}
      {was !== undefined && (
        <>
          {' '}
          <span className="badge bg-amber-500/15 text-xs text-amber-800 dark:text-amber-300">Changed</span>
          <span className="text-theme-text-muted block text-xs font-normal">was {was}</span>
        </>
      )}
    </dd>
  </>
);

export const TrainingReviewStep: React.FC<TrainingReviewStepProps> = ({
  model,
  training,
  durationHours,
  courses,
  linkageData,
  onEdit,
  editing = false,
  original,
  scopeChoice,
  organizerNames,
  storedCourseName,
  unmapped = [],
  seriesOccurrence,
  retiredAttendanceNames = {},
}) => {
  const { tz, formData } = model;
  const nameOf = (id: string) => model.organizerOptions.options.find((o) => o.id === id)?.name ?? 'Selected member';
  const { categories, requirements, programs, phases } = linkageData;
  const nameIn = (list: { id: string; name: string }[], id: string) =>
    id ? (list.find((item) => item.id === id)?.name ?? 'Selected') : 'None';
  // A session-attendance requirement is graded through Counts toward
  // attendance now; one linked here before that is kept, and marked as the
  // event page's card marks it.
  const requirementLabel = (id: string): string => {
    const requirement = requirements.find((r) => r.id === id);
    if (!requirement) return nameIn(requirements, id);
    return requirement.requirement_type === 'session_attendance'
      ? `${requirement.name} (currently linked, no longer offered)`
      : requirement.name;
  };
  const courseOf = (value: TrainingDetailsForm) =>
    value.course_mode === 'library' ? courses.find((c) => c.id === value.course_id) : undefined;
  const selectedCourse = courseOf(training);

  const recurrenceLabel = (() => {
    const base = RECURRENCE_PATTERNS.find((p) => p.value === model.recurrencePattern)?.label ?? model.recurrencePattern;
    if (model.recurrencePattern === 'custom') {
      const days = [...model.recurrenceCustomDays].sort((a, b) => a - b).map((d) => WEEKDAYS[d] ?? '');
      return days.length ? `${base}: ${days.join(', ')}` : base;
    }
    if (model.recurrencePattern === 'monthly_weekday' || model.recurrencePattern === 'annually_weekday') {
      const ordinal = ORDINALS.find((o) => o.value === model.recurrenceWeekOrdinal)?.label ?? '';
      const weekday = WEEKDAYS[model.recurrenceWeekday] ?? '';
      const month =
        model.recurrencePattern === 'annually_weekday' ? ` of ${MONTHS[model.recurrenceMonth - 1] ?? ''}` : '';
      return `${base}: ${ordinal} ${weekday}${month}`;
    }
    if (model.recurrencePattern === 'weekly' || model.recurrencePattern === 'biweekly') {
      // The day the series repeats on is the start's, as the backend reads it.
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(formData.start_datetime);
      if (!match) return base;
      const sundayFirst = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
      return `${base} on ${WEEKDAY_PLURALS[(sundayFirst + 6) % 7] ?? ''}`;
    }
    return base;
  })();

  const courseLabel = (value: TrainingDetailsForm): string => {
    if (value.course_mode === 'library') {
      const course = courses.find((c) => c.id === value.course_id);
      if (course) return `${course.code ? `${course.code} - ` : ''}${course.name} (Course Library)`;
      return value.course_id && storedCourseName
        ? `${storedCourseName} (no longer in the Course Library)`
        : 'None chosen';
    }
    if (value.course_mode === 'oneoff') {
      const code = value.course_code.trim();
      return `${value.course_name.trim() || 'None entered'}${code ? ` (${code})` : ''} (one-off)`;
    }
    return `No course yet: filed under “${formData.title.trim() || 'the event title'}”`;
  };

  // Under a library course the backend fills a blank instructor or expiry
  // from the course, so Review says what the save will store, not "None".
  const instructorLabel = (value: TrainingDetailsForm): string => {
    if (value.instructor_id) return value.instructor || 'Selected member';
    if (value.instructor.trim()) {
      return `${value.instructor.trim()} (${value.course_mode === 'library' ? 'from the course, ' : ''}not a member)`;
    }
    const fromCourse = courseOf(value)?.instructor?.trim();
    return fromCourse ? `${fromCourse} (from the course, not a member)` : 'None';
  };

  const expiryLabel = (value: TrainingDetailsForm): string => {
    if (value.expiration_months.trim()) return `${value.expiration_months.trim()} months`;
    const fromCourse = courseOf(value)?.expiration_months;
    return fromCourse ? `${fromCourse} months (from the course)` : '—';
  };

  const creditLabel = (value: TrainingDetailsForm, hours = effectiveCreditHours(value, durationHours)): string => {
    if (!hours) return '—';
    return `${hoursLabel(hours)}${
      creditHoursFromCourse(value, courseOf(value))
        ? ' (from the course)'
        : value.credit_hours_source === 'duration'
          ? " (the event's length)"
          : ''
    }`;
  };

  const typeLabel = (value: TrainingDetailsForm): string =>
    TRAINING_TYPE_LABELS[value.training_type] ?? value.training_type;

  /** What a training row read before this edit, when the edit changed it. */
  const was = (
    label: (value: TrainingDetailsForm) => string,
    labelBefore: (value: TrainingDetailsForm) => string = label
  ): string | undefined => {
    if (!original) return undefined;
    const before = labelBefore(original);
    return before === label(training) ? undefined : before;
  };

  // The hours as stored (fromSession keeps them even where they follow the
  // length), not the stored source read at today's length: hours that follow
  // the length travel as null, so moving the event moves the credit with it.
  // A Training event with no session has none stored, and reads as before.
  const storedCreditLabel = (value: TrainingDetailsForm): string =>
    creditLabel(value, value.credit_hours.trim() || effectiveCreditHours(value, durationHours));

  const attendanceNames = training.attendance_requirement_ids.map((id) =>
    linkedAttendanceLabel(id, requirements, retiredAttendanceNames)
  );

  const mandatoryFor = (() => {
    if (model.mandatoryForEveryone) return 'All members';
    const types = formData.mandatory_membership_types ?? [];
    if (!types.length) return 'None chosen';
    return types.map((value) => model.membershipTypes.find((t) => t.value === value)?.label ?? value).join(', ');
  })();

  const locationLabel =
    model.locationMode === 'select'
      ? model.selectedLocation
        ? model.formatLocationLabel(model.selectedLocation, 'comma')
        : 'None'
      : formData.location?.trim() || 'None';

  const checkInWindow = (() => {
    const before = formData.check_in_minutes_before ?? 60;
    if (formData.check_in_window_type === 'strict') return 'Strict, open only while the event runs';
    if (formData.check_in_window_type === 'window') {
      return `Custom window, opens ${before} minutes before the start and closes ${formData.check_in_minutes_after ?? 15} minutes after the end`;
    }
    return `Flexible, opens ${before} minutes before the start`;
  })();

  const reminderTarget = !formData.send_reminders
    ? 'No reminders'
    : formData.reminder_target === 'all'
      ? 'All active members'
      : formData.reminder_target === 'none'
        ? 'No reminders'
        : 'Members who sign up';

  const statusNames: Record<string, string> = { going: 'Going', not_going: 'Not Going', maybe: 'Maybe' };

  return (
    <section className="space-y-6">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-xl font-bold">
        <ClipboardCheck className="h-5 w-5 text-red-700" aria-hidden="true" />
        <span>{editing ? 'Review changes' : 'Review'}</span>
      </h2>

      {scopeChoice}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Section title="Event Details" icon={CalendarDays} target="details" onEdit={onEdit}>
          <Row label="Event Type">
            <span className={`badge ${getEventTypeBadgeColor(formData.event_type)}`}>
              {getEventTypeLabel(formData.event_type)}
            </span>
          </Row>
          <Row label="Title">{formData.title.trim() || '—'}</Row>
          {/* Rendered as the event page renders it, so **bold** reads as bold. */}
          {formData.description?.trim() && (
            <Row label="Description" markdown>
              <SimpleMarkdown text={formData.description.trim()} />
            </Row>
          )}
          {(model.customCategories.length > 0 || formData.custom_category) && (
            <Row label="Event category">
              {formData.custom_category
                ? (model.customCategories.find((c) => c.value === formData.custom_category)?.label ??
                  formData.custom_category)
                : 'None'}
            </Row>
          )}
          {model.showOrganizerPickers && (
            <>
              <Row label="Organizer">{model.organizerId ? nameOf(model.organizerId) : 'You'}</Row>
              <Row label="Alternate">{model.alternateId ? nameOf(model.alternateId) : 'None'}</Row>
            </>
          )}
          {organizerNames?.organizer && (
            <Row label="Organizer">{`${organizerNames.organizer} · change it with Transfer on the event page`}</Row>
          )}
          {organizerNames?.alternate && (
            <Row label="Alternate">{`${organizerNames.alternate} · change it with Transfer on the event page`}</Row>
          )}
          {/* The form holds local wall-clock strings; formatDateTime reads its
              input as UTC, so they are converted first, as the save does. */}
          <Row label="Starts">{formatDateCustom(localToUTC(formData.start_datetime, tz), DATE_TIME, tz)}</Row>
          <Row label="Ends">{formatDateCustom(localToUTC(formData.end_datetime, tz), DATE_TIME, tz)}</Row>
        </Section>

        {model.isRecurring && (
          <Section title="Recurrence" icon={Repeat} target="details" onEdit={editing ? undefined : onEdit}>
            <Row label="Pattern">{recurrenceLabel}</Row>
            {editing && seriesOccurrence?.occurrenceStart && (
              <Row label="This occurrence">
                {formatDateCustom(seriesOccurrence.occurrenceStart, DATE_ONLY, tz)}
                {seriesOccurrence.seriesStart
                  ? `, in a series running since ${formatDateCustom(seriesOccurrence.seriesStart, DATE_ONLY, tz)}.`
                  : seriesOccurrence.finalizedBefore
                    ? '.'
                    : ''}
                {seriesOccurrence.finalizedBefore &&
                  ` ${formatDateCustom(seriesOccurrence.finalizedBefore, DATE_ONLY, tz)}, before it, has finalized attendance.`}
              </Row>
            )}
            <Row label="Duration">
              {model.isRolling
                ? 'Rolling 12-month cycle'
                : model.recurrenceEndDate
                  ? `Until ${formatCalendarDate(model.recurrenceEndDate, DATE_ONLY)}`
                  : '—'}
            </Row>
            <Row label="Skipped dates">
              {model.recurrenceExceptions.length
                ? [...model.recurrenceExceptions]
                    .sort()
                    .map((d) => formatCalendarDate(d, DATE_ONLY))
                    .join('\n')
                : 'None'}
            </Row>
            {editing && (
              <Row label="Changing the recurrence">
                Can&apos;t be changed when editing; create a new series to change the pattern, duration or skipped
                dates.
              </Row>
            )}
          </Section>
        )}

        <Section title="Location" icon={MapPin} target="details" onEdit={onEdit}>
          <Row label="Location">{locationLabel}</Row>
          <Row label="Additional directions">{formData.location_details?.trim() || '—'}</Row>
        </Section>

        <Section title="Training Details" icon={GraduationCap} target="training" onEdit={onEdit}>
          <Row label="Course" was={was(courseLabel)}>
            {courseLabel(training)}
          </Row>
          <Row label="Training Type" was={was(typeLabel)}>
            {typeLabel(training)}
          </Row>
          <Row label="Lead Instructor" was={was(instructorLabel)}>
            {instructorLabel(training)}
          </Row>
          <Row label="Credit Hours" was={was(creditLabel, storedCreditLabel)}>
            {creditLabel(training)}
          </Row>
          <Row label="Certification">
            {training.issues_certification
              ? training.issuing_agency.trim()
                ? `Issued by ${training.issuing_agency.trim()}`
                : 'Issued'
              : 'None'}
          </Row>
          {training.issues_certification && (
            <>
              <Row label="Cert number prefix">{training.certification_number_prefix.trim() || '—'}</Row>
              <Row label="Expires after" was={was(expiryLabel)}>
                {expiryLabel(training)}
              </Row>
            </>
          )}
        </Section>

        <Section title="Requirement & Program Links" icon={Link2} target="training" onEdit={onEdit}>
          <Row label="Training category">{nameIn(categories, training.category_id)}</Row>
          <Row label="Requirement">{requirementLabel(training.requirement_id)}</Row>
          <Row label="Program">{nameIn(programs, training.program_id)}</Row>
          {training.program_id && (
            <Row label="Phase">
              {training.phase_id
                ? (() => {
                    const phase = phases.find((p) => p.id === training.phase_id);
                    return phase ? `Phase ${phase.phase_number}: ${phase.name}` : 'Selected';
                  })()
                : 'Any phase'}
            </Row>
          )}
          <Row label="Counts toward attendance">
            {attendanceNames.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {attendanceNames.map((name, index) => (
                  <li
                    key={training.attendance_requirement_ids[index] ?? name}
                    className="badge bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300"
                  >
                    {name}
                  </li>
                ))}
              </ul>
            ) : (
              'None'
            )}
          </Row>
        </Section>

        <Section title="Training completion" icon={Award} target="training" onEdit={onEdit}>
          <Row label="Counts toward certification">{training.counts_toward_certification ? 'Yes' : 'No'}</Row>
          <Row label="Auto-create records">{training.auto_create_records ? 'Yes, at check-in' : 'No'}</Row>
          <Row label="Sign-off">
            {training.require_completion_confirmation
              ? `Required: the instructor or a training officer, within ${training.approval_deadline_days.trim() || '7'} days`
              : 'Not required'}
          </Row>
        </Section>

        <Section title="Attendance" icon={UserCheck} target="settings" onEdit={onEdit}>
          <Row label="Mandatory">{formData.is_mandatory ? 'Yes' : 'No'}</Row>
          {formData.is_mandatory && <Row label="Mandatory for">{mandatoryFor}</Row>}
          {formData.is_mandatory && unmapped.length > 0 && (
            <Row label="Not mapped">{unmapped.map((u) => `${u.name} (${u.reason})`).join('\n')}</Row>
          )}
        </Section>

        <Section title="RSVP" icon={Users} target="settings" onEdit={onEdit}>
          <Row label="Require RSVP">{formData.requires_rsvp ? 'Yes' : 'No'}</Row>
          <Row label="RSVP deadline">
            {formData.requires_rsvp && formData.rsvp_deadline
              ? formatDateCustom(localToUTC(formData.rsvp_deadline, tz), DATE_TIME, tz)
              : '—'}
          </Row>
          <Row label="Max attendees">
            {formData.max_attendees
              ? `${formData.max_attendees}${
                  selectedCourse?.max_participants && formData.max_attendees === selectedCourse.max_participants
                    ? ' (from the course)'
                    : ''
                }`
              : 'Unlimited'}
          </Row>
          <Row label="Guests">{formData.allow_guests ? 'Allowed' : 'Not allowed'}</Row>
          <Row label="Status options">
            {(formData.allowed_rsvp_statuses ?? []).map((s) => statusNames[s] ?? s).join(', ') || '—'}
          </Row>
          <Row label="Who can see who's going">
            {formData.attendee_visibility === 'members'
              ? 'Everyone in the department'
              : formData.attendee_visibility === 'managers'
                ? 'Only event managers'
                : 'Organization default'}
          </Row>
        </Section>

        <Section title="Check-In" icon={QrCode} target="settings" onEdit={onEdit}>
          <Row label="QR Code Check-In">Enabled</Row>
          <Row label="Window">{checkInWindow}</Row>
          <Row label="Manual check-out">{formData.require_checkout ? 'Required' : 'Not required'}</Row>
          <Row label="Guest sign-in">
            {formData.allow_guest_check_in
              ? formData.guest_check_in_creates_prospect
                ? 'On, adding guests to the prospective members pipeline'
                : 'On'
              : 'Off'}
          </Row>
        </Section>

        <Section title="Notifications" icon={Bell} target="settings" onEdit={onEdit}>
          <Row label="Reminders to">{reminderTarget}</Row>
          {formData.send_reminders && (
            <Row label="Schedule">
              {[...(formData.reminder_schedule ?? [24])]
                .sort((a, b) => b - a)
                .map(reminderLabel)
                .join(', ') || 'None'}
            </Row>
          )}
        </Section>
      </div>
    </section>
  );
};
