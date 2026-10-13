/**
 * A requirement's due date within a program, as the enrollment progress read
 * reports it. The date and the overdue verdict both come from the server —
 * counted on the department's calendar — so this only formats them.
 */
import React from 'react';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate } from '../../utils/dateFormatting';

interface Props {
  dueDate?: string | null | undefined;
  isOverdue?: boolean | undefined;
  /** A satisfied requirement keeps its date for reference but is never late. */
  done: boolean;
}

export const RequirementDueDate: React.FC<Props> = ({ dueDate, isOverdue, done }) => {
  const tz = useTimezone();
  if (!dueDate) return null;
  // A "YYYY-MM-DD" value is a calendar day; formatDate prints it as written.
  const day = formatDate(dueDate, tz);
  if (isOverdue && !done) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        Overdue — was due {day}
      </span>
    );
  }
  return (
    <span className="text-theme-text-secondary inline-flex items-center gap-1">
      <CalendarClock className="h-3 w-3" aria-hidden="true" />
      Due {day}
    </span>
  );
};
