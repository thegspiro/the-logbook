import React, { useEffect, useId, useState } from 'react';
import type { TrainingCourse } from '../../types/training';
import { trainingService } from '../../services/api';
import { useTrainingLinkageData } from '../../hooks/useTrainingLinkageData';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';
import { TrainingLinkageFields, type TrainingLinkageValue } from './TrainingLinkageFields';
import type { TrainingDetailsValue } from './trainingDetailsValue';

export type { TrainingDetailsValue } from './trainingDetailsValue';

interface TrainingDetailsFieldsProps {
  value: TrainingDetailsValue;
  onChange: (next: TrainingDetailsValue) => void;
  disabled?: boolean | undefined;
  /**
   * Drop the "Default (Continuing Education)" choice. For editing a session
   * that already has a type: the type cannot be cleared, so offering a blank
   * choice would promise a change that is never sent.
   */
  typeRequired?: boolean | undefined;
  /**
   * Name of the course the value already carries, for when that course is
   * not in the picker's list (retired since, or the list failed to load).
   * Without an option to match, the select would read "No course" while
   * still holding — and saving — the course.
   */
  currentCourseName?: string | undefined;
}

const toLinkage = (value: TrainingDetailsValue): TrainingLinkageValue => ({
  category_id: value.category_id || undefined,
  program_id: value.program_id || undefined,
  phase_id: value.phase_id || undefined,
  requirement_id: value.requirement_id || undefined,
});

/**
 * Course, training type and requirement/program pickers for a Training event.
 *
 * All of it is optional: a Training event with no details is still credited
 * when attendance is finalized, filed under the event's title as Continuing
 * Education. Shared by the Events form and the event page's card so both
 * describe the same choice the same way.
 */
export const TrainingDetailsFields: React.FC<TrainingDetailsFieldsProps> = ({
  value,
  onChange,
  disabled = false,
  typeRequired = false,
  currentCourseName,
}) => {
  const fieldId = useId();
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const linkageData = useTrainingLinkageData(value.program_id || undefined);

  useEffect(() => {
    let cancelled = false;
    trainingService
      .getCourses()
      .then((data) => {
        if (!cancelled) setCourses(data);
      })
      .catch(() => {
        // Non-critical: the course picker stays empty and the rest still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCourse = courses.find((c) => c.id === value.course_id);
  const courseUnlisted = Boolean(value.course_id) && !selectedCourse;

  // A course's own type, category and program are sensible defaults, but a
  // choice the officer already made outranks them — only blanks are filled.
  const handleCourseChange = (courseId: string) => {
    const next: TrainingDetailsValue = { ...value, course_id: courseId };
    const course = courses.find((c) => c.id === courseId);
    if (course) {
      if (!next.training_type && course.training_type) next.training_type = course.training_type;
      if (!next.category_id) next.category_id = course.category_ids?.[0] ?? '';
      if (!next.program_id && course.program_id) {
        next.program_id = course.program_id;
        next.phase_id = '';
      }
    }
    onChange(next);
  };

  const handleLinkageChange = (patch: Partial<TrainingLinkageValue>) => {
    const next: TrainingDetailsValue = { ...value };
    if ('category_id' in patch) next.category_id = patch.category_id ?? '';
    if ('program_id' in patch) next.program_id = patch.program_id ?? '';
    if ('phase_id' in patch) next.phase_id = patch.phase_id ?? '';
    if ('requirement_id' in patch) next.requirement_id = patch.requirement_id ?? '';
    onChange(next);
  };

  return (
    // A disabled fieldset disables every control inside it, including the
    // linkage pickers, which have no disabled prop of their own.
    <fieldset disabled={disabled} className="min-w-0 space-y-4 disabled:opacity-60">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={`${fieldId}-course`} className="text-theme-text-primary mb-2 block text-sm font-semibold">
            Course
          </label>
          <select
            id={`${fieldId}-course`}
            value={value.course_id}
            onChange={(e) => handleCourseChange(e.target.value)}
            className="form-input py-3"
          >
            <option value="">No course (filed under the event title)</option>
            {courseUnlisted && <option value={value.course_id}>{currentCourseName || 'Current course'}</option>}
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code ? `${course.code} - ` : ''}
                {course.name}
              </option>
            ))}
          </select>
          <p className="text-theme-text-muted mt-1 text-xs">Members&apos; records are filed under this course</p>
        </div>
        <div>
          <label htmlFor={`${fieldId}-type`} className="text-theme-text-primary mb-2 block text-sm font-semibold">
            Training Type
          </label>
          <select
            id={`${fieldId}-type`}
            value={value.training_type}
            onChange={(e) => onChange({ ...value, training_type: e.target.value })}
            className="form-input py-3"
          >
            {!typeRequired && <option value="">Default (Continuing Education)</option>}
            {Object.entries(TRAINING_TYPE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <TrainingLinkageFields
        data={linkageData}
        value={toLinkage(value)}
        onChange={handleLinkageChange}
        selectedCourse={selectedCourse}
      />
    </fieldset>
  );
};
