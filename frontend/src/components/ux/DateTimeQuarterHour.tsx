/**
 * DateTimeQuarterHour — Date + quarter-hour time picker
 *
 * Combines a native date picker with the TimeQuarterHour component
 * (separate hour/minute/AM-PM selects limited to 15-minute increments).
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
}

function snapToQuarter(time: string): string {
  const parts = time.split(':');
  const h = parts[0] ?? '00';
  const rawM = parseInt(parts[1] ?? '0', 10);
  const snapped = Math.floor(rawM / 15) * 15;
  return `${h}:${String(snapped).padStart(2, '0')}`;
}

const DateTimeQuarterHour: React.FC<DateTimeQuarterHourProps> = ({
  value,
  onChange,
  className,
  id,
  required,
}) => {
  const { datePart, timePart } = useMemo(() => {
    if (!value) return { datePart: '', timePart: '' };
    const sep = value.includes('T') ? 'T' : ' ';
    const [d, t] = value.split(sep);
    return { datePart: d ?? '', timePart: snapToQuarter(t ?? '09:00') };
  }, [value]);

  const handleDateChange = (newDate: string) => {
    const time = timePart || '09:00';
    onChange(`${newDate}T${time}`);
  };

  const handleTimeChange = (newTime: string) => {
    const date = datePart || getTodayLocalDate();
    onChange(`${date}T${newTime}`);
  };

  return (
    <div className="flex gap-2 items-center">
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
        {...(className ? { className } : {})}
      />
    </div>
  );
};

export default DateTimeQuarterHour;
