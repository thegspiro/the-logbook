/**
 * The courses a `courses` requirement is made of, behind a toggle like the
 * monthly hours breakdown: the card's "0/4 courses" said how many, and
 * nothing said which.
 *
 * Each entry is ticked by the server's own test (`course_checklist`), so the
 * ticks always add up to the figure on the card (CLAUDE.md pitfall 29).
 */

import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Circle } from 'lucide-react';
import { formatDate } from '../../utils/dateFormatting';
import type { RequirementCourseEntry, RequirementDetail } from '../../types/training';

interface RequirementCourseListProps {
  requirement: RequirementDetail;
  timezone: string;
}

const CourseRow: React.FC<{ course: RequirementCourseEntry; timezone: string }> = ({ course, timezone }) => (
  <li className="flex items-start gap-2 py-1.5">
    {course.completed ? (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" />
    ) : (
      <Circle className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    )}
    <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-start sm:gap-3">
      <div className="min-w-0 flex-1 break-words">
        <span className={`text-sm ${course.name ? 'text-theme-text-primary' : 'text-theme-text-muted italic'}`}>
          {course.name ?? 'Course no longer in the library'}
        </span>
        {course.code && <span className="text-theme-text-muted ml-2 text-xs whitespace-nowrap">{course.code}</span>}
      </div>
      <span
        className={`text-xs sm:shrink-0 ${course.completed ? 'text-green-700 dark:text-green-400' : 'text-theme-text-muted'}`}
      >
        {course.completed
          ? course.completed_on
            ? `Completed ${formatDate(course.completed_on, timezone)}`
            : 'Completed'
          : 'Not yet completed'}
      </span>
    </div>
  </li>
);

export const RequirementCourseList: React.FC<RequirementCourseListProps> = ({ requirement, timezone }) => {
  const [open, setOpen] = useState(false);
  const courses = requirement.course_checklist;
  if (!courses || courses.length === 0) return null;
  const panelId = `required-courses-${requirement.id}`;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="text-theme-text-secondary mobile-touch-target flex items-center gap-1 text-xs font-medium hover:underline"
      >
        {open ? (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{open ? 'Hide required courses' : `Show required courses (${courses.length})`}</span>
      </button>
      {open && (
        <ul id={panelId} aria-label="Required courses" className="divide-theme-surface-border mt-1 divide-y">
          {courses.map((course) => (
            <CourseRow key={course.course_id} course={course} timezone={timezone} />
          ))}
        </ul>
      )}
    </div>
  );
};
