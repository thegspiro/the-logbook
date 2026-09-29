/**
 * DateTimeQuarterHour — Date + quarter-hour time picker
 *
 * Combines a native date picker with the TimeQuarterHour component
 * (separate hour/minute/AM-PM selects offering 15-minute increments).
 *
 * A value already carrying an off-quarter minute (a recorded check-in at 9:07)
 * is shown as it is rather than floored. Flooring changed only what was on
 * screen: the parent kept, and submitted, 9:07 — Edit Times showed 9:00–1:00
 * and saved 233 minutes.
 */

import React, { useMemo } from 'react';
import TimeQuarterHour from './TimeQuarterHour';
import { getTodayLocalDate } from '../../utils/dateFormatting';

interface DateTimeQuarterHourProps {
  /** datetime-local string, e.g. "2026-03-14T09:30" */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  required?: boolean;
  /**
   * Department timezone. Without it, a member who picks a time before picking
   * a date gets the *browser's* today, which is a day out either side of
   * midnight for anyone not in the department's own timezone.
   */
  timezone?: string | undefined;
  /**
   * Names the time selects ("Start time" → "Start time hour", …). Without it
   * every picker on a form announces "Time hour", so a start and an end are
   * indistinguishable to a screen reader.
   */
  timeLabel?: string | undefined;
}

const DateTimeQuarterHour: React.FC<DateTimeQuarterHourProps> = ({
  value,
  onChange,
  className,
  id,
  required,
  timezone,
  timeLabel,
}) => {
  const { datePart, timePart } = useMemo(() => {
    if (!value) return { datePart: '', timePart: '' };
    const sep = value.includes('T') ? 'T' : ' ';
    const [d, t] = value.split(sep);
    return { datePart: d ?? '', timePart: (t ?? '09:00').slice(0, 5) };
  }, [value]);

  const handleDateChange = (newDate: string) => {
    const time = timePart || '09:00';
    onChange(`${newDate}T${time}`);
  };

  const handleTimeChange = (newTime: string) => {
    const date = datePart || getTodayLocalDate(timezone);
    onChange(`${date}T${newTime}`);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        id={id}
        required={required}
        value={datePart}
        onChange={(e) => handleDateChange(e.target.value)}
        className={className}
        style={{ flex: '1 1 40%' }}
      />
      <TimeQuarterHour
        value={timePart}
        onChange={(e) => handleTimeChange(e.target.value)}
        preserveOffQuarterMinute
        {...(className ? { className } : {})}
        {...(timeLabel ? { 'aria-label': timeLabel } : {})}
      />
    </div>
  );
};

export default DateTimeQuarterHour;
