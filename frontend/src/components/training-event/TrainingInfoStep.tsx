/**
 * The Training Info step: where the session's credit is filed (a library
 * course, a one-off name, or none — the event's title), its type, lead
 * instructor and credit hours, the requirement and program it feeds, the
 * attendance requirements it counts toward, certification, and how its
 * records are completed. Every session field sits on this one step.
 */

import React from 'react';
import { GraduationCap, Link2, Lock } from 'lucide-react';
import type { TrainingCourse, TrainingType } from '../../types/training';
import type { TrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';
import { FormField } from '../ux/FormField';
import { TrainingLinkageFields } from '../training/TrainingLinkageFields';
import type { TrainingLinkageValue } from '../training/TrainingLinkageFields';
import AttendanceRequirementChecklist from '../training/AttendanceRequirementChecklist';
import { attendanceRequirements } from '../../utils/attendanceRequirements';
import { TrainingSettingsFields } from './TrainingSettingsFields';
import type { CourseMode, InstructorOption, TrainingDetailsForm, TrainingField } from './trainingDetailsModel';
import {
  TRAINING_FIELDS,
  courseCreditHours,
  creditHoursFromCourse,
  effectiveCreditHours,
} from './trainingDetailsModel';

const TRAINING_TYPES = Object.keys(TRAINING_TYPE_LABELS) as TrainingType[];

const CREDIT_NOTE =
  'Each attendee is credited with the time they actually attended, from check-in to check-out or as corrected, not this figure.';

const hoursLabel = (hours: number | string) => `${hours} ${Number(hours) === 1 ? 'hour' : 'hours'}`;

const optional = <span className="text-theme-text-muted font-normal">(optional)</span>;

/**
 * Who may change what on this step of an edit. `finalized`: only Counts
 * toward attendance, which changes how the session is graded and no record it
 * wrote; the backend refuses (409) any other changed training field once
 * attendance is finalized. `readonly`: nothing, with the host's reason.
 */
export type TrainingInfoAccess = 'edit' | 'finalized' | 'readonly';

/** Why the step is read-only, shown above it. */
export interface TrainingReadOnlyNotice {
  title: string;
  detail: string;
}

interface TrainingInfoStepProps {
  value: TrainingDetailsForm;
  onChange: (patch: Partial<TrainingDetailsForm>) => void;
  /** Pick a library course: the host pre-fills from it, including the event's own fields. */
  onPickCourse: (course: TrainingCourse | undefined) => void;
  errors: Partial<Record<TrainingField, string>>;
  /** The event's title, which a session with no course is filed under. */
  eventTitle: string;
  /** The event's scheduled length, which Credit Hours follow until changed. */
  durationHours: number | null;
  courses: TrainingCourse[];
  members: InstructorOption[];
  linkageData: TrainingLinkageData;
  /** The department's member types, to say whom each attendance requirement applies to. */
  membershipTypes?: readonly { value: string; label: string }[] | undefined;
  /** A series: the attendance note speaks of every session in it. */
  isSeries: boolean;
  access?: TrainingInfoAccess | undefined;
  /** Required with `readonly` access. */
  readOnlyNotice?: TrainingReadOnlyNotice | undefined;
  /** The stored session's course name, for a course the library no longer lists. */
  storedCourseName?: string | undefined;
  /** Whether `courses` has loaded, so a course missing from it is really gone. */
  coursesLoaded?: boolean | undefined;
}

interface CourseOptionProps {
  mode: CourseMode;
  current: CourseMode;
  onSelect: (mode: CourseMode) => void;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
}

const CourseOption: React.FC<CourseOptionProps> = ({ mode, current, onSelect, title, description, children }) => {
  const selected = mode === current;
  return (
    <div
      className={`rounded-lg border p-4 ${
        selected
          ? 'bg-theme-surface-secondary border-l-4 border-red-700 dark:border-red-500'
          : 'border-theme-surface-border'
      }`}
    >
      <label className="flex cursor-pointer items-start gap-3">
        {/* The whole option, title and description, is the tap target. */}
        <input
          type="radio"
          name="training-course-mode"
          value={mode}
          checked={selected}
          onChange={() => onSelect(mode)}
          className="form-checkbox mt-1 shrink-0"
        />
        <span>
          <span className="text-theme-text-primary block font-semibold">{title}</span>
          <span className="text-theme-text-secondary block text-sm">{description}</span>
        </span>
      </label>
      {selected && children && (
        <div className="mt-4 space-y-4 border-l-2 border-red-500/30 pl-4 sm:ml-8">{children}</div>
      )}
    </div>
  );
};

export const TrainingInfoStep: React.FC<TrainingInfoStepProps> = ({
  value,
  onChange,
  onPickCourse,
  errors,
  eventTitle,
  durationHours,
  courses,
  members,
  linkageData,
  membershipTypes = [],
  isSeries,
  access = 'edit',
  readOnlyNotice,
  storedCourseName,
  coursesLoaded = false,
}) => {
  const locked = access !== 'edit';
  const checklistLocked = access === 'readonly';
  // A stored course the library no longer lists (archived, or inactive) stays
  // selected, named and marked, rather than reading as no choice at all.
  const unlistedCourse =
    coursesLoaded && value.course_mode === 'library' && value.course_id
      ? !courses.some((c) => c.id === value.course_id)
      : false;
  const selectedCourse = value.course_mode === 'library' ? courses.find((c) => c.id === value.course_id) : undefined;
  const courseHours = courseCreditHours(selectedCourse);
  const creditHours = effectiveCreditHours(value, durationHours);
  const instructorIsMember = Boolean(value.instructor_id) && members.some((m) => m.id === value.instructor_id);
  const freeTextInstructor = !value.instructor_id && value.instructor.trim() ? value.instructor.trim() : null;
  const categoryName = linkageData.categories.find((c) => c.id === selectedCourse?.category_ids?.[0])?.name;
  const programName = linkageData.programs.find((p) => p.id === selectedCourse?.program_id)?.name;

  const creditHint = (() => {
    if (value.credit_hours_source === 'duration' && locked) {
      return durationHours === null ? CREDIT_NOTE : `The event's length (${hoursLabel(durationHours)}). ${CREDIT_NOTE}`;
    }
    if (value.credit_hours_source === 'duration') {
      return durationHours === null
        ? `Follows the event's length until you change it. ${CREDIT_NOTE}`
        : `Follows the event's length (${hoursLabel(durationHours)}) until you change it. ${CREDIT_NOTE}`;
    }
    if (creditHoursFromCourse(value, selectedCourse) && courseHours !== undefined) {
      return `From the course (${hoursLabel(courseHours)}). ${CREDIT_NOTE}`;
    }
    return CREDIT_NOTE;
  })();

  // A stored session can hold a name typed elsewhere, not from any course.
  // Left blank under a library course, the save stores the course's.
  const courseInstructor = selectedCourse?.instructor?.trim();
  const instructorHint =
    !value.instructor_id && !freeTextInstructor && courseInstructor
      ? `Left blank, the course's instructor (${courseInstructor}) is used.`
      : freeTextInstructor
        ? selectedCourse
          ? `From the course: ${freeTextInstructor}, not a member`
          : `${freeTextInstructor}, not a member`
        : selectedCourse?.instructor && instructorIsMember && value.instructor === selectedCourse.instructor.trim()
          ? 'From the course.'
          : undefined;

  const linkageValue: TrainingLinkageValue = {
    category_id: value.category_id || undefined,
    program_id: value.program_id || undefined,
    phase_id: value.phase_id || undefined,
    requirement_id: value.requirement_id || undefined,
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-theme-text-primary flex flex-wrap items-center gap-2 text-xl font-bold">
          <GraduationCap className="h-5 w-5 text-red-700" aria-hidden="true" />
          <span>Training Information</span>
          {locked && (
            <span className="badge bg-theme-surface-secondary text-theme-text-secondary inline-flex items-center gap-1 text-xs font-medium">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              {access === 'finalized' ? 'Locked except Counts toward attendance' : 'Read-only'}
            </span>
          )}
        </h2>
        {locked && (
          <p className="text-theme-text-muted mt-1 text-sm">
            Members&apos; training records are written with these details each time attendance is finalized.
          </p>
        )}
      </div>

      {access === 'readonly' && readOnlyNotice && (
        <div className="alert-info flex items-start gap-3" role="note">
          <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">{readOnlyNotice.title}</p>
            <p className="text-sm">{readOnlyNotice.detail}</p>
          </div>
        </div>
      )}

      {/* === Course === */}
      <fieldset className="space-y-3" disabled={locked}>
        <legend className="form-label">Course</legend>
        <CourseOption
          mode="none"
          current={value.course_mode}
          onSelect={(mode) => onChange({ course_mode: mode })}
          title="No course yet (filed under the event title)"
          description={
            <>
              Members&apos; records are filed under{' '}
              {eventTitle.trim() ? <>&ldquo;{eventTitle.trim()}&rdquo;</> : 'the event title'} with the training type
              below.
            </>
          }
        />
        <CourseOption
          mode="library"
          current={value.course_mode}
          onSelect={(mode) => onChange({ course_mode: mode })}
          title="From the Course Library"
          description="Pre-fills name, code, type, credit hours, instructor and expiry."
        >
          <FormField id={TRAINING_FIELDS.course_id.id} label="Course" required error={errors.course_id}>
            {(field) => (
              <select
                {...field}
                value={value.course_id}
                onChange={(e) => onPickCourse(courses.find((c) => c.id === e.target.value))}
                className="form-input py-3"
              >
                <option value="">Select a course...</option>
                {unlistedCourse && (
                  <option value={value.course_id}>
                    {storedCourseName || 'Current course'} (no longer in the Course Library)
                  </option>
                )}
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code ? `${course.code} - ` : ''}
                    {course.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {unlistedCourse && (
            <p className="text-theme-text-secondary text-sm">
              No longer in the Course Library. It stays on this session until someone picks another course.
            </p>
          )}
          {selectedCourse && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
              <p className="text-theme-text-primary text-sm font-medium">{selectedCourse.name}</p>
              {selectedCourse.description && (
                <p className="text-theme-text-secondary mt-1 text-sm">{selectedCourse.description}</p>
              )}
              <p className="text-theme-text-muted mt-2 text-xs">
                {[
                  selectedCourse.code ? `Code: ${selectedCourse.code}` : null,
                  `Type: ${TRAINING_TYPE_LABELS[selectedCourse.training_type] ?? selectedCourse.training_type}`,
                  courseHours !== undefined && courseHours !== null ? `Credits: ${courseHours}h` : null,
                  selectedCourse.expiration_months ? `Expires: ${selectedCourse.expiration_months} months` : null,
                  selectedCourse.instructor ? `Instructor: ${selectedCourse.instructor}` : null,
                  selectedCourse.max_participants ? `Max participants: ${selectedCourse.max_participants}` : null,
                  categoryName ? `Category: ${categoryName}` : null,
                  programName ? `Program: ${programName}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {!locked && (
                <p className="text-theme-text-secondary mt-2 text-sm">
                  Type, hours, instructor and expiry are filled from the course; change them below.
                </p>
              )}
            </div>
          )}
        </CourseOption>
        <CourseOption
          mode="oneoff"
          current={value.course_mode}
          onSelect={(mode) => onChange({ course_mode: mode })}
          title="One-off course name (not added to the Course Library)"
          description="Records are filed under this name for this session only."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              id={TRAINING_FIELDS.course_name.id}
              label="Course Name"
              required
              error={errors.course_name}
              maxLength={TRAINING_FIELDS.course_name.maxLength}
              count={value.course_name.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  autoComplete="off"
                  value={value.course_name}
                  onChange={(e) => onChange({ course_name: e.target.value })}
                  placeholder="e.g., CPR/AED Renewal"
                  className="form-input py-3"
                />
              )}
            </FormField>
            <FormField
              id={TRAINING_FIELDS.course_code.id}
              label="Course Code"
              optional
              error={errors.course_code}
              maxLength={TRAINING_FIELDS.course_code.maxLength}
              count={value.course_code.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  autoComplete="off"
                  value={value.course_code}
                  onChange={(e) => onChange({ course_code: e.target.value })}
                  placeholder="e.g., CPR-HCP"
                  className="form-input py-3"
                />
              )}
            </FormField>
          </div>
        </CourseOption>
      </fieldset>

      {/* === Type, instructor and hours: offered in every course mode === */}
      <fieldset disabled={locked} className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          id={TRAINING_FIELDS.training_type.id}
          label="Training Type"
          required
          error={errors.training_type}
          hint={
            selectedCourse && value.training_type === selectedCourse.training_type
              ? locked
                ? 'From the course.'
                : 'From the course; you can change it.'
              : undefined
          }
        >
          {(field) => (
            <select
              {...field}
              value={value.training_type}
              onChange={(e) => onChange({ training_type: e.target.value as TrainingType })}
              className="form-input py-3"
            >
              {TRAINING_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TRAINING_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          id={TRAINING_FIELDS.instructor_id.id}
          label={<>Lead Instructor {optional}</>}
          error={errors.instructor_id}
          hint={instructorHint}
        >
          {(field) => (
            <select
              {...field}
              value={instructorIsMember ? value.instructor_id : ''}
              onChange={(e) => {
                const member = members.find((m) => m.id === e.target.value);
                // Picking a member replaces a course's free-text name; leaving
                // the picker on its placeholder keeps that name.
                if (member) onChange({ instructor_id: member.id, instructor: member.name });
                else onChange({ instructor_id: '', instructor: freeTextInstructor ?? '' });
              }}
              className="form-input py-3"
            >
              <option value="">Select instructor...</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          id={TRAINING_FIELDS.credit_hours.id}
          label="Credit Hours"
          required
          error={errors.credit_hours}
          hint={creditHint}
        >
          {(field) => (
            <input
              {...field}
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              value={creditHours}
              onChange={(e) => onChange({ credit_hours: e.target.value, credit_hours_source: 'manual' })}
              placeholder="0"
              className="form-input py-3"
            />
          )}
        </FormField>
      </fieldset>

      {/* === Requirement & Program Linkage === */}
      <div className="border-theme-surface-border space-y-4 border-t pt-6">
        <div>
          <h3 className="text-theme-text-primary flex items-center gap-2 font-semibold">
            <Link2 className="h-5 w-5 text-red-700" aria-hidden="true" />
            Connect to Requirements &amp; Programs
          </h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            Optional: link this session so attendance automatically counts toward department requirements and training
            pipeline progress.
          </p>
        </div>

        <fieldset disabled={locked} className="min-w-0">
          <TrainingLinkageFields
            data={linkageData}
            value={linkageValue}
            onChange={(patch) => {
              const next: Partial<TrainingDetailsForm> = {};
              if ('category_id' in patch) next.category_id = patch.category_id ?? '';
              if ('program_id' in patch) next.program_id = patch.program_id ?? '';
              if ('phase_id' in patch) next.phase_id = patch.phase_id ?? '';
              if ('requirement_id' in patch) next.requirement_id = patch.requirement_id ?? '';
              onChange(next);
            }}
            selectedCourse={selectedCourse}
          />
        </fieldset>

        {attendanceRequirements(linkageData.requirements).length > 0 && (
          <fieldset aria-describedby="training-attendance-note">
            <legend className="text-theme-text-primary text-sm font-semibold">Counts toward attendance</legend>
            <p id="training-attendance-note" className="text-theme-text-muted mt-1 mb-3 text-sm">
              Attendance at {isSeries ? 'each session in the series' : 'this session'} counts toward the ticked
              requirements&apos; percentages. It does not make attending mandatory; that is set under Mandatory
              attendance on the Settings step, which uses these ticks to suggest who. An approved attendance waiver
              leaves the session out of that member&apos;s percentage. Leave all unticked and this session counts toward
              no attendance requirement.
            </p>
            <AttendanceRequirementChecklist
              membershipTypes={membershipTypes}
              requirements={linkageData.requirements}
              value={value.attendance_requirement_ids}
              onChange={(next) => onChange({ attendance_requirement_ids: next })}
              disabled={checklistLocked}
            />
            {access === 'finalized' && (
              <p className="text-theme-text-muted mt-3 text-sm">
                Saving re-grades this session against the ticked requirements. Members&apos; training records and hours
                do not change.
              </p>
            )}
            {checklistLocked && value.attendance_requirement_ids.length > 0 && (
              <p className="text-theme-text-muted mt-3 text-sm">Linked by an event manager.</p>
            )}
          </fieldset>
        )}
      </div>

      {/* === Certification === */}
      <fieldset disabled={locked} className="border-theme-surface-border min-w-0 space-y-4 border-t pt-6">
        <label className="mobile-touch-target flex cursor-pointer items-center justify-start gap-3">
          <input
            type="checkbox"
            id="training-issues-certification"
            checked={value.issues_certification}
            onChange={(e) => onChange({ issues_certification: e.target.checked })}
            className="form-checkbox shrink-0"
          />
          <span className="text-theme-text-primary font-semibold">This training issues a certification</span>
        </label>

        {value.issues_certification && (
          <div className="space-y-4 border-l-2 border-red-500/30 pl-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField
                id={TRAINING_FIELDS.issuing_agency.id}
                label="Issuing Agency"
                optional
                error={errors.issuing_agency}
                maxLength={TRAINING_FIELDS.issuing_agency.maxLength}
                count={value.issuing_agency.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={value.issuing_agency}
                    onChange={(e) => onChange({ issuing_agency: e.target.value })}
                    placeholder="e.g., AHA"
                    className="form-input py-3"
                  />
                )}
              </FormField>
              <FormField
                id={TRAINING_FIELDS.certification_number_prefix.id}
                label="Cert Number Prefix"
                optional
                error={errors.certification_number_prefix}
                maxLength={TRAINING_FIELDS.certification_number_prefix.maxLength}
                count={value.certification_number_prefix.length}
              >
                {(field) => (
                  <input
                    {...field}
                    type="text"
                    value={value.certification_number_prefix}
                    onChange={(e) => onChange({ certification_number_prefix: e.target.value })}
                    placeholder="e.g., AHA-CPR-"
                    className="form-input py-3"
                  />
                )}
              </FormField>
              <FormField
                id={TRAINING_FIELDS.expiration_months.id}
                label="Expiration (months)"
                optional
                error={errors.expiration_months}
                hint={
                  !selectedCourse?.expiration_months
                    ? undefined
                    : value.expiration_months === String(selectedCourse.expiration_months)
                      ? 'From the course.'
                      : !value.expiration_months.trim()
                        ? `Left blank, the course's ${selectedCourse.expiration_months} months is used.`
                        : undefined
                }
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={value.expiration_months}
                    onChange={(e) => onChange({ expiration_months: e.target.value })}
                    placeholder="e.g., 24 (for 2 years)"
                    className="form-input py-3"
                  />
                )}
              </FormField>
            </div>
          </div>
        )}
      </fieldset>

      {/* === Training completion === */}
      <fieldset disabled={locked} className="border-theme-surface-border min-w-0 space-y-4 border-t pt-6">
        <div>
          <h3 className="text-theme-text-primary font-semibold">Training completion</h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            How members&apos; training records are created and signed off.
          </p>
        </div>
        <TrainingSettingsFields value={value} onChange={onChange} errors={errors} disabled={locked} />
      </fieldset>
    </section>
  );
};
