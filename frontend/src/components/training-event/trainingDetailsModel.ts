/**
 * The training details of a Training event, as the training-event wizard holds
 * them, and the two payloads they become: `training_details` on a create
 * (`TrainingSessionAttach`) and on an edit (`TrainingSessionDetailsUpdate`).
 *
 * Every text field is a string and `''` means "not entered", so the value can
 * back plain inputs and selects; the payload helpers turn it into wire shape —
 * a create omits a blank (`||`), an edit sends it as `null` (CLAUDE.md
 * pitfall #1).
 */

import type { EventTemplateTrainingDetails, EventTrainingDetails, EventTrainingDetailsUpdate } from '../../types/event';
import type { TrainingCourse, TrainingType } from '../../types/training';
import type { TrainingSessionResponse } from '../../services/api';
import type { TrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';
import { localToUTC } from '../../utils/dateFormatting';
import { blankToNull, numberOrNull } from '../../utils/formValues';
import type { ServerFieldSpec } from '../../utils/serverFieldErrors';

/**
 * Where the session's course comes from. With none it is filed under the
 * event's title; a one-off name is stored on the session only and never added
 * to the Course Library (owner decision, 2026-11-10).
 */
export type CourseMode = 'none' | 'library' | 'oneoff';

/**
 * Why Credit Hours holds what it holds. `duration` follows the event's
 * scheduled length until the officer types a figure; `course` came from a
 * library course; `manual` was typed.
 */
export type CreditHoursSource = 'duration' | 'course' | 'manual';

export interface TrainingDetailsForm {
  course_mode: CourseMode;
  course_id: string;
  course_name: string;
  course_code: string;
  training_type: TrainingType;
  /** Ignored while `credit_hours_source` is `duration`: the scheduled length is used. */
  credit_hours: string;
  credit_hours_source: CreditHoursSource;
  /** The member teaching it, when the lead instructor is a member. */
  instructor_id: string;
  /** The instructor's name: the picked member's, or a library course's free text. */
  instructor: string;
  category_id: string;
  program_id: string;
  phase_id: string;
  requirement_id: string;
  attendance_requirement_ids: string[];
  issues_certification: boolean;
  certification_number_prefix: string;
  issuing_agency: string;
  expiration_months: string;
  counts_toward_certification: boolean;
  auto_create_records: boolean;
  require_completion_confirmation: boolean;
  approval_deadline_days: string;
}

/** The backend's own defaults for a new session (`TrainingSessionAttach`). */
export const DEFAULT_TRAINING_DETAILS: TrainingDetailsForm = {
  course_mode: 'none',
  course_id: '',
  course_name: '',
  course_code: '',
  training_type: 'continuing_education',
  credit_hours: '',
  credit_hours_source: 'duration',
  instructor_id: '',
  instructor: '',
  category_id: '',
  program_id: '',
  phase_id: '',
  requirement_id: '',
  attendance_requirement_ids: [],
  issues_certification: false,
  certification_number_prefix: '',
  issuing_agency: '',
  expiration_months: '',
  counts_toward_certification: true,
  auto_create_records: true,
  require_completion_confirmation: false,
  approval_deadline_days: '7',
};

/** Hours to two places, so a 90-minute class reads 1.5 rather than 1.4999…. */
const roundHours = (hours: number): number => Math.round(hours * 100) / 100;

/**
 * The scheduled length in hours of a start and end held as the form holds
 * them (local wall-clock strings in `tz`), or null while either is missing or
 * the end is not after the start.
 */
export const scheduledHours = (startLocal: string, endLocal: string, tz: string): number | null => {
  if (!startLocal || !endLocal) return null;
  const ms = new Date(localToUTC(endLocal, tz)).getTime() - new Date(localToUTC(startLocal, tz)).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return roundHours(ms / 3_600_000);
};

/** The Credit Hours figure the form shows and saves. */
export const effectiveCreditHours = (value: TrainingDetailsForm, durationHours: number | null): string => {
  if (value.credit_hours_source !== 'duration') return value.credit_hours;
  return durationHours === null ? '' : String(durationHours);
};

/** A member the lead instructor can be, as the wizard lists them. */
export interface InstructorOption {
  id: string;
  /** The name saved as the session's instructor. */
  name: string;
  /** The name with the member's rank, as the picker lists them. */
  label: string;
  /**
   * No longer a current member. Kept so a session that already names them
   * still shows them, but never offered or matched as a new instructor.
   */
  former?: boolean | undefined;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Pre-fill from a library course, as the Training Admin wizard always has:
 * type, hours, instructor and expiry replace what is there, since picking the
 * course is the officer saying "this is that course"; its category and program
 * fill only links not chosen yet. A course with an expiry ticks "issues a
 * certification". Every value stays editable.
 *
 * A course's instructor is free text. When it names a member, that member is
 * picked; otherwise the name is kept as text and the member picker is left
 * empty, so a name nobody can be credited as is never passed off as a member.
 */
export const applyLibraryCourse = (
  value: TrainingDetailsForm,
  course: TrainingCourse,
  members: readonly InstructorOption[],
  /**
   * The programs the Program picker offers (active ones). A course's program
   * outside it is not filled in: the picker would read "No program" while
   * the save carried it.
   */
  listedProgramIds?: readonly string[],
  /**
   * The library course this one replaces. What it filled in and the officer
   * left alone describes that course, not this one, so a value this course
   * does not replace is cleared rather than saved under it.
   */
  previousCourse?: TrainingCourse
): TrainingDetailsForm => {
  const courseProgram =
    course.program_id && (listedProgramIds === undefined || listedProgramIds.includes(course.program_id))
      ? course.program_id
      : undefined;
  // Credit Hours is what a course is worth; Duration is how long it runs. A
  // course saved with only a duration is worth its duration, the same
  // fallback a submission uses. Without it the session saved 0 and every
  // attendee was credited nothing.
  const courseHours = course.credit_hours ?? course.duration_hours;
  const next: TrainingDetailsForm = {
    ...value,
    course_mode: 'library',
    course_id: course.id,
    training_type: course.training_type || value.training_type,
    category_id: value.category_id || course.category_ids?.[0] || '',
    program_id: value.program_id || courseProgram || '',
    // A program the course brought in has its own phases.
    phase_id: value.program_id || !courseProgram ? value.phase_id : '',
  };
  if (courseHours !== undefined && courseHours !== null) {
    next.credit_hours = String(courseHours);
    next.credit_hours_source = 'course';
  } else if (value.credit_hours_source === 'course' || creditHoursFromCourse(value, previousCourse)) {
    // The scheduled length is what a course-less figure falls back to, here
    // and in the backend's own fallback for a course without hours.
    next.credit_hours_source = 'duration';
  }
  const previousInstructor = previousCourse?.instructor?.trim();
  if (course.instructor?.trim()) {
    const member = members.find((m) => sameName(m.name, course.instructor ?? ''));
    next.instructor_id = member?.id ?? '';
    next.instructor = member?.name ?? course.instructor.trim();
  } else if (previousInstructor && sameName(value.instructor, previousInstructor)) {
    next.instructor_id = '';
    next.instructor = '';
  }
  if (course.expiration_months) {
    next.expiration_months = String(course.expiration_months);
    next.issues_certification = true;
  } else if (
    previousCourse?.expiration_months &&
    value.expiration_months === String(previousCourse.expiration_months)
  ) {
    next.expiration_months = '';
    // The previous course's expiry is what ticked it. Left ticked only when
    // the officer has since given the certification details of their own.
    if (!value.issuing_agency.trim() && !value.certification_number_prefix.trim()) {
      next.issues_certification = false;
    }
  }
  return next;
};

/** What a library course's hours are worth: its credit hours, or else its duration. */
export const courseCreditHours = (course: TrainingCourse | undefined): number | undefined =>
  course ? (course.credit_hours ?? course.duration_hours ?? undefined) : undefined;

/**
 * Whether Credit Hours hold the library course's figure: pre-filled from it,
 * or, on an edit, stored equal to it.
 */
export const creditHoursFromCourse = (value: TrainingDetailsForm, course: TrainingCourse | undefined): boolean => {
  const hours = courseCreditHours(course);
  if (value.course_mode !== 'library' || hours === undefined) return false;
  if (value.credit_hours_source === 'course') return true;
  return (
    value.credit_hours_source === 'manual' && value.credit_hours.trim() !== '' && Number(value.credit_hours) === hours
  );
};

const inLibrary = (value: TrainingDetailsForm) => value.course_mode === 'library' && Boolean(value.course_id);

/**
 * A change of course choice. Hours that came from a library course no longer
 * describe the session once it has none, so they go back to following the
 * event's length, the default a course-less session starts on. Coming back
 * to the library with the course still chosen puts its hours back: the
 * course reads as picked, and nothing else would re-apply it, since the
 * course-mode choice does not pass through the course picker.
 *
 * `previous` is the value before the change and its library course. An edit
 * loads a library session's hours as typed ('manual'), since only the course
 * list tells they are the course's figure, so it is the move away from the
 * library, judged against the course the session had, that sends hours the
 * form shows as the course's back to the length. Only that move: hours typed
 * later are left alone even when they equal a course picked earlier.
 */
export const withCourseChoice = (
  value: TrainingDetailsForm,
  course?: TrainingCourse,
  previous?: { value: TrainingDetailsForm; course: TrainingCourse | undefined }
): TrainingDetailsForm => {
  if (value.credit_hours_source === 'course' && !inLibrary(value)) {
    return { ...value, credit_hours_source: 'duration' };
  }
  if (
    previous &&
    inLibrary(previous.value) &&
    !inLibrary(value) &&
    value.credit_hours === previous.value.credit_hours &&
    value.credit_hours_source === previous.value.credit_hours_source &&
    creditHoursFromCourse(previous.value, previous.course)
  ) {
    return { ...value, credit_hours_source: 'duration' };
  }
  const hours = courseCreditHours(course);
  if (
    value.credit_hours_source === 'duration' &&
    value.course_mode === 'library' &&
    course !== undefined &&
    course.id === value.course_id &&
    hours !== undefined
  ) {
    return { ...value, credit_hours: String(hours), credit_hours_source: 'course' };
  }
  return value;
};

/**
 * Whether a course-less session holds a one-off course rather than being
 * filed under the event's title. A stored code marks one even when its name
 * equals the title: a session filed under the title carries no code, and
 * reading it as No course yet would clear the code on the next save. The
 * event page's training card reads the session the same way.
 */
export const isOneOffCourse = (
  session: Pick<TrainingSessionResponse, 'course_id' | 'course_name' | 'course_code'>,
  eventTitle: string
): boolean =>
  !session.course_id &&
  Boolean(session.course_name) &&
  (session.course_name !== eventTitle || Boolean(session.course_code?.trim()));

/** The ISO instants' length in hours, for a stored event. */
const storedHours = (startIso: string, endIso: string): number | null => {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Number.isFinite(ms) && ms > 0 ? roundHours(ms / 3_600_000) : null;
};

/**
 * The form value for an event's stored session. Credit Hours count as
 * untouched — still following the length — when they equal the stored length,
 * so moving the event's times keeps them in step as it did on create. A
 * library session's are read as typed until the Course Library has loaded
 * (`withLoadedCourseHours`).
 */
export const fromSession = (
  session: TrainingSessionResponse,
  event: { title: string; start_datetime: string; end_datetime: string }
): TrainingDetailsForm => {
  const length = storedHours(event.start_datetime, event.end_datetime);
  const courseMode: CourseMode = session.course_id
    ? 'library'
    : isOneOffCourse(session, event.title)
      ? 'oneoff'
      : 'none';
  const followsLength = !session.course_id && length !== null && roundHours(session.credit_hours) === length;
  return {
    course_mode: courseMode,
    course_id: session.course_id ?? '',
    course_name: courseMode === 'oneoff' ? session.course_name : '',
    course_code: courseMode === 'oneoff' ? (session.course_code ?? '') : '',
    training_type: (session.training_type as TrainingType) || DEFAULT_TRAINING_DETAILS.training_type,
    credit_hours: String(session.credit_hours),
    credit_hours_source: followsLength ? 'duration' : 'manual',
    instructor_id: session.instructor_id ?? '',
    instructor: session.instructor ?? '',
    category_id: session.category_id ?? '',
    program_id: session.program_id ?? '',
    phase_id: session.phase_id ?? '',
    requirement_id: session.requirement_id ?? '',
    attendance_requirement_ids: session.attendance_requirement_ids ?? [],
    issues_certification: session.issues_certification,
    certification_number_prefix: session.certification_number_prefix ?? '',
    issuing_agency: session.issuing_agency ?? '',
    expiration_months: session.expiration_months ? String(session.expiration_months) : '',
    counts_toward_certification: session.counts_toward_certification,
    auto_create_records: session.auto_create_records,
    require_completion_confirmation: session.require_completion_confirmation,
    approval_deadline_days: String(session.approval_deadline_days),
  };
};

/**
 * An edited library session's Credit Hours, read again once the Course
 * Library has loaded. `fromSession` reads a library session's hours as typed,
 * since only the course list tells whether the course has hours. A course
 * with none is credited the event's scheduled length on create (the payload
 * leaves the hours out and the backend falls back to the length), so stored
 * hours equal to the stored length are that length, read as a course-less
 * session's are: they follow the event's times again, and the hint says so.
 * A course with hours of its own, one the list no longer holds, or hours
 * unlike the length are left as they are.
 */
export const withLoadedCourseHours = (
  value: TrainingDetailsForm,
  courses: readonly TrainingCourse[],
  storedLength: number | null
): TrainingDetailsForm => {
  if (value.course_mode !== 'library' || value.credit_hours_source !== 'manual' || storedLength === null) {
    return value;
  }
  const course = courses.find((c) => c.id === value.course_id);
  if (!course || courseCreditHours(course) !== undefined) return value;
  if (value.credit_hours.trim() === '' || roundHours(Number(value.credit_hours)) !== storedLength) return value;
  return { ...value, credit_hours_source: 'duration' };
};

const toNumber = (text: string): number | undefined => {
  if (!text.trim()) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * `training_details` for a create. A blank is omitted, never sent as `''`.
 * Only the chosen course mode's fields go: the backend refuses a library
 * course together with a one-off name. Certification fields go only while
 * "issues a certification" is ticked, and the approval deadline only with
 * sign-off, since those are the only times the form shows them.
 */
export const toAttachPayload = (value: TrainingDetailsForm, durationHours: number | null): EventTrainingDetails => {
  const payload: EventTrainingDetails = {
    category_id: value.category_id || undefined,
    program_id: value.program_id || undefined,
    phase_id: value.phase_id || undefined,
    requirement_id: value.requirement_id || undefined,
    training_type: value.training_type,
    // Left out while the hours follow the event's length, as an edit sends
    // null: the backend credits each event its own scheduled length
    // (build_session_for_event), so a series' occurrences each get theirs
    // rather than this one's figure written to all of them.
    credit_hours:
      value.credit_hours_source === 'duration' ? undefined : toNumber(effectiveCreditHours(value, durationHours)),
    instructor: value.instructor.trim() || undefined,
    instructor_id: value.instructor_id || undefined,
    issues_certification: value.issues_certification,
    counts_toward_certification: value.counts_toward_certification,
    auto_create_records: value.auto_create_records,
    require_completion_confirmation: value.require_completion_confirmation,
    attendance_requirement_ids: value.attendance_requirement_ids,
  };
  if (value.course_mode === 'library') payload.course_id = value.course_id || undefined;
  if (value.course_mode === 'oneoff') {
    payload.course_name = value.course_name.trim() || undefined;
    payload.course_code = value.course_code.trim() || undefined;
  }
  if (value.issues_certification) {
    payload.certification_number_prefix = value.certification_number_prefix.trim() || undefined;
    payload.issuing_agency = value.issuing_agency.trim() || undefined;
    payload.expiration_months = toNumber(value.expiration_months);
  }
  if (value.require_completion_confirmation) payload.approval_deadline_days = toNumber(value.approval_deadline_days);
  return payload;
};

/**
 * `training_details` for an edit: every field the form owns, a blank as
 * `null`, so emptying a box clears it rather than leaving the stored value in
 * place behind a success message (pitfall #1). Fields of the course modes not
 * chosen are cleared, as are the certification fields when no certification
 * is issued. `training_type` and the completion settings cannot be null.
 *
 * The one field left out when unchanged is Requirement, given the details as
 * stored (`original`): on "This and all future events" every field sent is
 * written to each later occurrence, and a session-attendance requirement
 * linked there before Counts toward attendance existed may be kept but not
 * given to an occurrence that stores another, or none, so re-sending it
 * refused an edit that never touched Requirement. Omitted, each occurrence
 * keeps its own; a change, or a clear (null), is still sent.
 */
export const toUpdatePayload = (
  value: TrainingDetailsForm,
  durationHours: number | null,
  original?: TrainingDetailsForm
): EventTrainingDetailsUpdate => ({
  course_id: value.course_mode === 'library' ? value.course_id || null : null,
  course_name: value.course_mode === 'oneoff' ? blankToNull(value.course_name) : null,
  course_code: value.course_mode === 'oneoff' ? blankToNull(value.course_code) : null,
  category_id: value.category_id || null,
  program_id: value.program_id || null,
  phase_id: value.phase_id || null,
  ...(original && (value.requirement_id || null) === (original.requirement_id || null)
    ? {}
    : { requirement_id: value.requirement_id || null }),
  training_type: value.training_type,
  // Following the length is null, which the backend reads as each event's
  // own scheduled length; a figure would be written to every later occurrence
  // of a series whatever its length, and leave the session holding a typed-
  // looking number. 'duration' never holds a library course's hours.
  credit_hours:
    value.credit_hours_source === 'duration' ? null : numberOrNull(effectiveCreditHours(value, durationHours)),
  instructor: blankToNull(value.instructor),
  instructor_id: value.instructor_id || null,
  issues_certification: value.issues_certification,
  certification_number_prefix: value.issues_certification ? blankToNull(value.certification_number_prefix) : null,
  issuing_agency: value.issues_certification ? blankToNull(value.issuing_agency) : null,
  expiration_months: value.issues_certification ? numberOrNull(value.expiration_months) : null,
  counts_toward_certification: value.counts_toward_certification,
  auto_create_records: value.auto_create_records,
  require_completion_confirmation: value.require_completion_confirmation,
  // Sent only with sign-off, the only time the box is shown and checked: a
  // value left behind an unticked box would come back as a 422 on a field
  // nobody can see. Left out, the stored deadline is untouched. Not nullable:
  // a box left empty keeps the backend's default rather than failing the save.
  ...(value.require_completion_confirmation
    ? { approval_deadline_days: toNumber(value.approval_deadline_days) ?? 7 }
    : {}),
  attendance_requirement_ids: value.attendance_requirement_ids,
});

/**
 * The training details a Training template saves: the course, training type,
 * credit hours and their source, lead instructor and certification settings
 * (owner decision 2026-11-20), and since 2026-11-23 the category, program and
 * phase, the requirement link, Counts toward attendance and the completion and
 * sign-off settings.
 *
 * The backend's EventTemplateTrainingDetails (schemas/event.py) settles the
 * same shape and is the authority: this builds the request the same way, and
 * must not refuse anything that accepts. 'course' hours keep the figure the
 * form holds, so the template can still be saved, and applied, without the
 * Course Library. The approval deadline goes only with sign-off, as the
 * backend settles it, so the default is sent without.
 */
export const toTemplateTrainingDetails = (value: TrainingDetailsForm): EventTemplateTrainingDetails => {
  const hours = value.credit_hours_source === 'duration' ? undefined : toNumber(value.credit_hours);
  return {
    course_mode: value.course_mode,
    course_id: value.course_mode === 'library' ? value.course_id || null : null,
    course_name: value.course_mode === 'oneoff' ? value.course_name.trim() || null : null,
    course_code: value.course_mode === 'oneoff' ? value.course_code.trim() || null : null,
    training_type: value.training_type,
    credit_hours: hours ?? null,
    credit_hours_source: value.credit_hours_source,
    instructor_id: value.instructor_id || null,
    instructor: value.instructor.trim() || null,
    issues_certification: value.issues_certification,
    certification_number_prefix: value.issues_certification ? value.certification_number_prefix.trim() || null : null,
    issuing_agency: value.issues_certification ? value.issuing_agency.trim() || null : null,
    expiration_months: value.issues_certification ? (toNumber(value.expiration_months) ?? null) : null,
    category_id: value.category_id || null,
    program_id: value.program_id || null,
    phase_id: value.phase_id || null,
    requirement_id: value.requirement_id || null,
    attendance_requirement_ids: [...new Set(value.attendance_requirement_ids)],
    counts_toward_certification: value.counts_toward_certification,
    auto_create_records: value.auto_create_records,
    require_completion_confirmation: value.require_completion_confirmation,
    approval_deadline_days: value.require_completion_confirmation
      ? (toNumber(value.approval_deadline_days) ?? DEFAULT_APPROVAL_DEADLINE_DAYS)
      : DEFAULT_APPROVAL_DEADLINE_DAYS,
  };
};

/** The backend's default sign-off deadline (`TrainingSessionAttach`). */
const DEFAULT_APPROVAL_DEADLINE_DAYS = 7;

const COURSE_MODES: readonly CourseMode[] = ['none', 'library', 'oneoff'];
const HOURS_SOURCES: readonly CreditHoursSource[] = ['duration', 'course', 'manual'];

/**
 * Training Info for a template's saved details: they are laid onto the
 * defaults, so every field the template does not carry starts where a new
 * session does. A value the form cannot hold falls back to its default
 * rather than failing (pitfall #19): the template is read, not refused.
 */
export const fromTemplateTrainingDetails = (details: EventTemplateTrainingDetails): TrainingDetailsForm => {
  const mode = COURSE_MODES.includes(details.course_mode) ? details.course_mode : 'none';
  const signOff = details.require_completion_confirmation === true;
  const deadline = details.approval_deadline_days;
  const source = HOURS_SOURCES.includes(details.credit_hours_source) ? details.credit_hours_source : 'duration';
  const hours = typeof details.credit_hours === 'number' ? String(details.credit_hours) : '';
  const issues = details.issues_certification === true;
  return {
    ...DEFAULT_TRAINING_DETAILS,
    course_mode: mode,
    course_id: mode === 'library' ? (details.course_id ?? '') : '',
    course_name: mode === 'oneoff' ? (details.course_name ?? '') : '',
    course_code: mode === 'oneoff' ? (details.course_code ?? '') : '',
    training_type:
      details.training_type in TRAINING_TYPE_LABELS
        ? (details.training_type as TrainingType)
        : DEFAULT_TRAINING_DETAILS.training_type,
    // Hours the form would have to show without a figure follow the length.
    credit_hours: source === 'duration' ? '' : hours,
    credit_hours_source: source !== 'duration' && !hours ? 'duration' : source,
    instructor_id: details.instructor_id ?? '',
    instructor: details.instructor ?? '',
    issues_certification: issues,
    certification_number_prefix: issues ? (details.certification_number_prefix ?? '') : '',
    issuing_agency: issues ? (details.issuing_agency ?? '') : '',
    expiration_months: issues && details.expiration_months ? String(details.expiration_months) : '',
    // Absent from a template saved before 2026-11-23: the session defaults.
    category_id: details.category_id ?? '',
    program_id: details.program_id ?? '',
    phase_id: details.phase_id ?? '',
    requirement_id: details.requirement_id ?? '',
    attendance_requirement_ids: Array.isArray(details.attendance_requirement_ids)
      ? details.attendance_requirement_ids.filter((id): id is string => typeof id === 'string')
      : [],
    counts_toward_certification: details.counts_toward_certification !== false,
    auto_create_records: details.auto_create_records !== false,
    require_completion_confirmation: signOff,
    approval_deadline_days:
      signOff && typeof deadline === 'number' ? String(deadline) : DEFAULT_TRAINING_DETAILS.approval_deadline_days,
  };
};

export const TEMPLATE_COURSE_GONE_NOTE =
  "This template's course is no longer in the Course Library, so the session starts on No course yet.";
export const TEMPLATE_INSTRUCTOR_GONE_NOTE =
  "This template's lead instructor is no longer a current member, so Lead instructor starts empty.";
export const TEMPLATE_CATEGORY_GONE_NOTE = "This template's category is no longer offered, so Category starts empty.";
export const TEMPLATE_PROGRAM_GONE_NOTE =
  "This template's program is no longer active, so Program and Phase start empty.";
export const TEMPLATE_PHASE_GONE_NOTE = "This template's phase is no longer in its program, so Phase starts empty.";
export const TEMPLATE_REQUIREMENT_GONE_NOTE =
  "This template's requirement is no longer active, so Requirement starts empty.";
export const templateAttendanceGoneNote = (count: number): string =>
  count === 1
    ? "One of this template's Counts toward attendance requirements is no longer active, so it is left unticked."
    : `${count} of this template's Counts toward attendance requirements are no longer active, so they are left unticked.`;

/**
 * What the department still offers, for the links a template names: active
 * categories, active programs, the template program's phases and active
 * requirements. A list left undefined failed to load and is skipped.
 */
export interface TemplateLinkageLists {
  categories?: readonly { id: string }[] | undefined;
  programs?: readonly { id: string }[] | undefined;
  /** The phases of the template's program. */
  phases?: readonly { id: string }[] | undefined;
  requirements?: readonly { id: string }[] | undefined;
}

const listed = (list: readonly { id: string }[], id: string): boolean => list.some((item) => item.id === id);

/**
 * The lists `useTrainingLinkageData` loaded for *programId*, each left
 * undefined unless its request succeeded: a failed load is empty, and taking
 * it as "nothing is offered" would drop every link a template names.
 */
export const templateLinkageLists = (data: TrainingLinkageData, programId: string): TemplateLinkageLists => {
  const loaded = data.loaded;
  if (!loaded) return {};
  return {
    categories: loaded.categories ? data.categories : undefined,
    programs: loaded.programs ? data.programs : undefined,
    phases: programId && loaded.phasesFor === programId ? data.phases : undefined,
    requirements: loaded.requirements ? data.requirements : undefined,
  };
};

/**
 * The links a template names, checked against what is still offered (owner
 * decision 2026-11-23). None carries a foreign key, so a category or
 * requirement can be deactivated, a program retired and a phase removed
 * after the template was saved; each is dropped with a note rather than
 * sent to a create that would refuse it. Only a link still as seeded is
 * touched, as for the course.
 */
const reconcileTemplateLinks = (
  value: TrainingDetailsForm,
  seeded: TrainingDetailsForm,
  lists: TemplateLinkageLists
): { value: TrainingDetailsForm; notes: string[] } => {
  let next = value;
  const notes: string[] = [];
  const untouched = (key: 'category_id' | 'program_id' | 'phase_id' | 'requirement_id') =>
    seeded[key] !== '' && value[key] === seeded[key];

  if (lists.categories && untouched('category_id') && !listed(lists.categories, value.category_id)) {
    next = { ...next, category_id: '' };
    notes.push(TEMPLATE_CATEGORY_GONE_NOTE);
  }
  let programGone = false;
  if (lists.programs && untouched('program_id') && !listed(lists.programs, value.program_id)) {
    programGone = true;
    next = { ...next, program_id: '', ...(untouched('phase_id') ? { phase_id: '' } : {}) };
    notes.push(TEMPLATE_PROGRAM_GONE_NOTE);
  }
  if (!programGone && lists.phases && untouched('phase_id') && !listed(lists.phases, value.phase_id)) {
    next = { ...next, phase_id: '' };
    notes.push(TEMPLATE_PHASE_GONE_NOTE);
  }
  if (lists.requirements && untouched('requirement_id') && !listed(lists.requirements, value.requirement_id)) {
    next = { ...next, requirement_id: '' };
    notes.push(TEMPLATE_REQUIREMENT_GONE_NOTE);
  }
  const attendanceUntouched =
    value.attendance_requirement_ids.length === seeded.attendance_requirement_ids.length &&
    value.attendance_requirement_ids.every((id, i) => id === seeded.attendance_requirement_ids[i]);
  if (lists.requirements && attendanceUntouched) {
    const requirements = lists.requirements;
    const kept = value.attendance_requirement_ids.filter((id) => listed(requirements, id));
    const dropped = value.attendance_requirement_ids.length - kept.length;
    if (dropped > 0) {
      next = { ...next, attendance_requirement_ids: kept };
      notes.push(templateAttendanceGoneNote(dropped));
    }
  }
  return { value: next, notes };
};

/**
 * A template's training details checked against the Course Library and the
 * member list once they have loaded. Neither is tied to the template by a
 * foreign key, so a course can be deactivated or removed and an instructor
 * can leave:
 *
 * - a library course the library no longer lists starts on No course yet,
 *   with a note — the same course the wizard marks as no longer listed;
 * - a listed course whose hours follow it gets its current figure, or follows
 *   the event's length if it has none;
 * - an instructor who names no current member is cleared, with a note; a
 *   current one's name is refreshed. A name with no member id is kept;
 * - a category, program, phase or requirement no longer offered is dropped,
 *   with a note (`linkage`, see reconcileTemplateLinks).
 *
 * `courses`, `members` or a `linkage` list undefined means that list failed
 * to load: that part
 * is skipped, so a network blip never drops the template's choice (event
 * create still refuses a former instructor, under Lead instructor).
 *
 * Only a field that still equals what the template seeded (`seeded`) is
 * touched: an officer who typed before the lists arrived keeps what they
 * typed.
 */
export const reconcileTemplateTraining = (
  value: TrainingDetailsForm,
  seeded: TrainingDetailsForm,
  courses: readonly TrainingCourse[] | undefined,
  members: readonly InstructorOption[] | undefined,
  linkage: TemplateLinkageLists = {}
): { value: TrainingDetailsForm; notes: string[] } => {
  let next = value;
  const notes: string[] = [];
  const courseUntouched =
    seeded.course_mode === 'library' &&
    value.course_mode === seeded.course_mode &&
    value.course_id === seeded.course_id &&
    value.course_id !== '';
  const hoursUntouched =
    value.credit_hours_source === seeded.credit_hours_source && value.credit_hours === seeded.credit_hours;
  if (courses && courseUntouched) {
    const course = courses.find((c) => c.id === value.course_id);
    if (!course) {
      next = {
        ...next,
        course_mode: 'none',
        course_id: '',
        ...(hoursUntouched && value.credit_hours_source === 'course'
          ? { credit_hours: '', credit_hours_source: 'duration' as const }
          : {}),
      };
      notes.push(TEMPLATE_COURSE_GONE_NOTE);
    } else if (hoursUntouched && value.credit_hours_source === 'course') {
      const hours = courseCreditHours(course);
      next =
        hours === undefined
          ? { ...next, credit_hours: '', credit_hours_source: 'duration' }
          : { ...next, credit_hours: String(hours) };
    }
  }
  if (
    members &&
    seeded.instructor_id &&
    value.instructor_id === seeded.instructor_id &&
    value.instructor === seeded.instructor
  ) {
    const member = members.find((m) => m.id === value.instructor_id);
    if (!member || member.former) {
      next = { ...next, instructor_id: '', instructor: '' };
      notes.push(TEMPLATE_INSTRUCTOR_GONE_NOTE);
    } else if (member.name !== value.instructor) {
      next = { ...next, instructor: member.name };
    }
  }
  const links = reconcileTemplateLinks(next, seeded, linkage);
  return { value: links.value, notes: [...notes, ...links.notes] };
};

/**
 * An edit of a finalized event changes only which attendance requirements the
 * session counts toward: they decide how it is graded, not any record it
 * wrote, and the backend refuses (409) every other changed training field.
 */
export const strippedForFinalized = (payload: EventTrainingDetailsUpdate): EventTrainingDetailsUpdate =>
  payload.attendance_requirement_ids === undefined
    ? {}
    : { attendance_requirement_ids: payload.attendance_requirement_ids };

/**
 * The session settings Training Admin's old create path also wrote to the
 * event's custom_fields, and the old Events form wrote there only. Nothing
 * reads them for credit: the session's own columns decide. The event page
 * lists a copy that says otherwise as never applied
 * (TrainingSessionLinkageCard), so a save that sets the session's settings
 * drops the copies with it: kept, a copy of the value just replaced would be
 * offered back as one the officer never got.
 */
export const SESSION_SETTING_COPIES = [
  'instructor',
  'issues_certification',
  'issuing_agency',
  'expiration_months',
  'auto_create_records',
] as const;

export type SessionSettingCopy = (typeof SESSION_SETTING_COPIES)[number];

/**
 * The event's custom_fields without those copies; everything else is kept,
 * including any copy named in `keep`.
 */
export const withoutSessionSettingCopies = <T>(
  customFields: Record<string, T>,
  keep: readonly SessionSettingCopy[] = []
): Record<string, T> => {
  const kept = { ...customFields };
  for (const key of SESSION_SETTING_COPIES) if (!keep.includes(key)) delete kept[key];
  return kept;
};

type CustomFieldValue = string | number | boolean | null | undefined;

const copyText = (value: CustomFieldValue): string =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';

/**
 * Whether custom_fields holds any copy of a session setting: an event the old
 * Events form saved as Training, which a re-type away has left them on.
 */
export const hasSettingCopies = (customFields: Record<string, CustomFieldValue> | null | undefined): boolean =>
  SESSION_SETTING_COPIES.some((key) => {
    const value = customFields?.[key];
    return typeof value === 'boolean' || copyText(value) !== '';
  });

/**
 * Training Info for a Training event with no session, opened on the copies
 * of its settings: the old Events form wrote them to custom_fields only, and
 * the event page shows them as the event's, so they are what the officer
 * last saw. The save then writes them to the session it attaches, and
 * dropping the copies loses nothing. `hidden` names the copies the form has
 * nowhere to show — an agency or expiry without a certification, since those
 * boxes appear only once one is issued — which a save must keep, as it can
 * neither show nor carry them.
 */
export const fromSettingCopies = (
  customFields: Record<string, CustomFieldValue> | null | undefined
): { value: TrainingDetailsForm; hidden: SessionSettingCopy[] } => {
  const fields = customFields ?? {};
  const issues = fields.issues_certification === true;
  const value: TrainingDetailsForm = {
    ...DEFAULT_TRAINING_DETAILS,
    instructor: copyText(fields.instructor),
    issues_certification: issues,
    issuing_agency: issues ? copyText(fields.issuing_agency) : '',
    expiration_months: issues ? copyText(fields.expiration_months) : '',
    auto_create_records:
      typeof fields.auto_create_records === 'boolean'
        ? fields.auto_create_records
        : DEFAULT_TRAINING_DETAILS.auto_create_records,
  };
  const hidden = issues
    ? []
    : (['issuing_agency', 'expiration_months'] as const).filter((key) => copyText(fields[key]) !== '');
  return { value, hidden };
};

/**
 * The training fields a refusal can land on, with the control it focuses and
 * the label a 422 is reworded in. `api` is the path the backend's validation
 * handler reports (`training_details.<field>`); the bare `training_details`
 * path is a model-level refusal, such as a library course and a one-off name
 * sent together, which belongs to the course choice.
 */
export const TRAINING_FIELDS = {
  course_id: {
    id: 'training-course',
    label: 'Course',
    api: ['training_details.course_id', 'training_details'],
  },
  course_name: {
    id: 'training-course-name',
    label: 'Course name',
    maxLength: 255,
    api: 'training_details.course_name',
  },
  course_code: {
    id: 'training-course-code',
    label: 'Course code',
    maxLength: 50,
    api: 'training_details.course_code',
  },
  training_type: { id: 'training-type', label: 'Training type', api: 'training_details.training_type' },
  instructor_id: {
    id: 'training-instructor',
    label: 'Lead instructor',
    api: ['training_details.instructor_id', 'training_details.instructor'],
  },
  credit_hours: { id: 'training-credit-hours', label: 'Credit hours', api: 'training_details.credit_hours' },
  issuing_agency: {
    id: 'training-issuing-agency',
    label: 'Issuing agency',
    maxLength: 255,
    api: 'training_details.issuing_agency',
  },
  certification_number_prefix: {
    id: 'training-cert-prefix',
    label: 'Cert number prefix',
    maxLength: 50,
    api: 'training_details.certification_number_prefix',
  },
  expiration_months: {
    id: 'training-expiration-months',
    label: 'Expiration (months)',
    api: 'training_details.expiration_months',
  },
  approval_deadline_days: {
    id: 'training-approval-days',
    label: 'Approval deadline (days)',
    api: 'training_details.approval_deadline_days',
  },
} satisfies Record<string, ServerFieldSpec & { id: string }>;
export type TrainingField = keyof typeof TRAINING_FIELDS;

const isWholeNumber = (text: string) => /^\d+$/.test(text.trim());

/** Every training-field check, collected so all show at once. */
export const validateTrainingDetails = (
  value: TrainingDetailsForm,
  durationHours: number | null
): Partial<Record<TrainingField, string>> => {
  const invalid: Partial<Record<TrainingField, string>> = {};
  if (value.course_mode === 'library' && !value.course_id) {
    invalid.course_id = 'Choose a course from the Course Library.';
  }
  if (value.course_mode === 'oneoff' && !value.course_name.trim()) {
    invalid.course_name = 'Enter a course name.';
  }
  const hours = effectiveCreditHours(value, durationHours).trim();
  if (!hours) {
    invalid.credit_hours =
      value.credit_hours_source === 'duration'
        ? "Set the event's start and end, or enter the credit hours."
        : 'Enter the credit hours.';
  } else if (!(Number(hours) >= 0)) {
    invalid.credit_hours = 'Credit hours must be 0 or more.';
  }
  if (value.issues_certification && value.expiration_months.trim()) {
    if (!isWholeNumber(value.expiration_months) || Number(value.expiration_months) < 1) {
      invalid.expiration_months = 'Enter a whole number of months, or leave it blank.';
    }
  }
  if (value.require_completion_confirmation) {
    const days = Number(value.approval_deadline_days);
    if (!isWholeNumber(value.approval_deadline_days) || days < 1 || days > 30) {
      invalid.approval_deadline_days = 'Enter between 1 and 30 days.';
    }
  }
  return invalid;
};
