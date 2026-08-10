/**
 * CourseLibraryPicker
 *
 * Links a training requirement to specific courses from the department's course
 * library. Used anywhere a "Course completion" or "Certification" requirement is
 * defined — the create-pipeline wizard, the pipeline requirement modal, and the
 * department requirements page.
 *
 * Why a picker rather than free text: the compliance evaluator matches a
 * member's training records against these entries by **course id**. Typed-in
 * course names never match a record, so a requirement configured that way can
 * never be completed. Selecting from the library is what makes the link real.
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, BookOpen, Search, X } from 'lucide-react';
import type { TrainingCourse } from '../../types/training';
import { TRAINING_TYPE_LABELS } from '../../constants/enums';

/**
 * Which requirement type the picker is serving.
 *
 * - `courses`: the member must complete **every** linked course.
 * - `certification`: any one linked course earns the certification, so the list
 *   defaults to certification-type courses.
 */
export type CoursePickerVariant = 'courses' | 'certification';

interface CourseLibraryPickerProps {
  courses: TrainingCourse[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  variant?: CoursePickerVariant;
  loading?: boolean;
  error?: string;
  /** Prefix for generated DOM ids — must be unique per picker on the page. */
  idPrefix: string;
  /** Render a compact list (used inside modals). */
  compact?: boolean;
}

const COURSE_LIBRARY_PATH = '/training/admin?page=setup&tab=courses';

export const CourseLibraryPicker: React.FC<CourseLibraryPickerProps> = ({
  courses,
  selectedIds,
  onChange,
  variant = 'courses',
  loading = false,
  error = '',
  idPrefix,
  compact = false,
}) => {
  const [search, setSearch] = useState('');
  // A certification requirement is usually satisfied by a certification-type
  // course, so that is the default view — but departments file CPR under all
  // sorts of types, so the full catalog stays one click away.
  const [certOnly, setCertOnly] = useState(variant === 'certification');

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectedCourses = useMemo(
    () => selectedIds.map((id) => ({ id, course: courses.find((c) => c.id === id) })),
    [selectedIds, courses]
  );

  const visibleCourses = useMemo(() => {
    const term = search.trim().toLowerCase();
    return courses.filter((course) => {
      // An archived course stays visible while it is still linked, so the
      // officer can see what the requirement points at and unlink it.
      if (course.active === false && !selected.has(course.id)) return false;
      if (certOnly && course.training_type !== 'certification' && !selected.has(course.id)) {
        return false;
      }
      if (!term) return true;
      return course.name.toLowerCase().includes(term) || (course.code ?? '').toLowerCase().includes(term);
    });
  }, [courses, search, certOnly, selected]);

  const toggle = (courseId: string) => {
    if (selected.has(courseId)) {
      onChange(selectedIds.filter((id) => id !== courseId));
    } else {
      onChange([...selectedIds, courseId]);
    }
  };

  const searchId = `${idPrefix}-course-search`;
  const listId = `${idPrefix}-course-list`;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label className="form-label mb-0" htmlFor={searchId}>
          {variant === 'certification' ? 'Certification earned by' : 'Courses to complete'}
        </label>
        {selectedIds.length > 0 && <span className="text-theme-text-muted text-xs">{selectedIds.length} selected</span>}
      </div>

      <p className="text-theme-text-muted text-xs">
        {variant === 'certification' ? (
          <>
            Pick the library course that grants this certification. A member&apos;s completion of it marks the
            requirement earned — name and registry-code matching still apply as a fallback.
          </>
        ) : (
          <>Pick the library courses a member must complete. Progress fills in automatically as each one is recorded.</>
        )}
      </p>

      {/* Selected chips — the linked set at a glance, removable without hunting
          through the browse list. */}
      {selectedCourses.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selectedCourses.map(({ id, course }) => (
            <li key={id}>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                  course
                    ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                }`}
              >
                {course ? course.name : 'Course no longer in the library'}
                {course?.active === false && ' (archived)'}
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={`Remove ${course ? course.name : 'unavailable course'}`}
                  className="hover:text-theme-text-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <div className="text-theme-text-secondary flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : loading ? (
        <p className="text-theme-text-muted text-xs">Loading the course library…</p>
      ) : courses.length === 0 ? (
        <div className="card-secondary border-dashed p-3 text-center">
          <BookOpen className="text-theme-text-muted mx-auto mb-1 h-6 w-6" aria-hidden="true" />
          <p className="text-theme-text-muted text-xs">
            No courses in the library yet.{' '}
            <Link to={COURSE_LIBRARY_PATH} className="underline">
              Add one in the Course Library
            </Link>{' '}
            first.
          </p>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              className="text-theme-text-muted pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="form-input-sm pl-8"
              placeholder="Search by course name or code…"
              aria-controls={listId}
            />
          </div>

          <label className="text-theme-text-secondary flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={certOnly}
              onChange={(e) => setCertOnly(e.target.checked)}
              className="form-checkbox"
            />
            <span>Only show certification courses</span>
          </label>

          <ul
            id={listId}
            className={`divide-theme-surface-border border-theme-surface-border divide-y overflow-y-auto rounded-md border ${
              compact ? 'max-h-48' : 'max-h-64'
            }`}
          >
            {visibleCourses.length === 0 ? (
              <li className="text-theme-text-muted p-3 text-center text-xs">
                No courses match. Clear the search or uncheck the certification filter.
              </li>
            ) : (
              visibleCourses.map((course) => (
                <li key={course.id}>
                  <label className="hover:bg-theme-surface-hover flex cursor-pointer items-start gap-2 p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(course.id)}
                      onChange={() => toggle(course.id)}
                      className="form-checkbox mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="text-theme-text-primary block truncate text-sm">
                        {course.name}
                        {course.code ? <span className="text-theme-text-muted"> ({course.code})</span> : null}
                      </span>
                      <span className="text-theme-text-muted block text-xs">
                        {TRAINING_TYPE_LABELS[course.training_type] ?? course.training_type}
                        {course.credit_hours != null && ` · ${course.credit_hours} credit hrs`}
                        {course.active === false && ' · archived'}
                      </span>
                    </span>
                  </label>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      {selectedIds.length === 0 && !loading && !error && courses.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p className="text-theme-text-secondary text-xs">
            {variant === 'certification' ? (
              <>
                No course linked. This requirement will fall back to matching records by name and registry code, which
                can miss or over-match.
              </>
            ) : (
              <>No course linked. Members can&apos;t earn credit for this requirement until at least one is selected.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
};

export default CourseLibraryPicker;
