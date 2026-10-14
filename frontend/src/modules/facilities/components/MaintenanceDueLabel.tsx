import React from 'react';
import type { MaintenanceRecord } from '../types';
import { formatCalendarDate } from '../../../utils/dateFormatting';

/** Numeric, like the dashboard's "Due: 10/6/2026" and the rest of Facilities. */
const NUMERIC_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };
const day = (value: string) => formatCalendarDate(value, NUMERIC_DATE);

interface MaintenanceDueLabelProps {
  record: Pick<MaintenanceRecord, 'isCompleted' | 'isOverdue' | 'dueDate' | 'completedDate'>;
}

/**
 * Where a maintenance record stands, in words.
 *
 * The row's icon carried this alone, by colour, and the due date that decides
 * "overdue" was never shown — a record the dashboard counted as overdue read
 * here as a description and a type. `isOverdue` is the server's verdict and is
 * reported as given rather than recomputed from the date. The dates are
 * calendar dates, so they are formatted without a timezone shift.
 */
const MaintenanceDueLabel: React.FC<MaintenanceDueLabelProps> = ({ record }) => {
  if (record.isCompleted) {
    return <span>{record.completedDate ? `Completed ${day(record.completedDate)}` : 'Completed'}</span>;
  }
  if (record.isOverdue) {
    return (
      <span className="font-medium text-red-800 dark:text-red-300">
        {record.dueDate ? `Overdue · due ${day(record.dueDate)}` : 'Overdue'}
      </span>
    );
  }
  if (record.dueDate) return <span>Due {day(record.dueDate)}</span>;
  return null;
};

export default MaintenanceDueLabel;
