/**
 * TimeQuarterHour — Quarter-hour time picker with separate hour/minute selects
 *
 * Renders two side-by-side `<select>` dropdowns: one for hour (12-hour with
 * AM/PM) and one for minute (00, 15, 30, 45). Emits "HH:MM" in 24-hour format.
 */

import React, { useMemo } from 'react';

interface TimeQuarterHourProps {
  /** Time string in "HH:MM" 24-hour format, e.g. "09:30" */
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  className?: string;
  id?: string;
  required?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => {
  const hour12 = i === 0 ? 12 : i;
  return { display: String(hour12), value: i };
});

const MINUTE_OPTIONS = ['00', '15', '30', '45'] as const;

function parse24(time: string): { hour24: number; minute: number } | null {
  const parts = time.split(':');
  const h = parseInt(parts[0] ?? '', 10);
  const m = parseInt(parts[1] ?? '', 10);
  if (isNaN(h) || isNaN(m)) return null;
  return { hour24: h, minute: Math.floor(m / 15) * 15 };
}

function to24(hour12Index: number, period: 'AM' | 'PM'): number {
  // hour12Index: 0=12, 1=1, 2=2, …, 11=11
  if (period === 'AM') return hour12Index; // 0→0, 1→1, …, 11→11
  return hour12Index + 12; // 0→12, 1→13, …, 11→23
}

const TimeQuarterHour: React.FC<TimeQuarterHourProps> = ({
  value,
  onChange,
  className,
  id,
  required,
  placeholder,
  'aria-label': ariaLabel,
}) => {
  const parsed = useMemo(() => (value ? parse24(value) : null), [value]);

  const hour12Index = parsed ? parsed.hour24 % 12 : null;
  const minute = parsed ? parsed.minute : null;
  const period: 'AM' | 'PM' = parsed ? (parsed.hour24 < 12 ? 'AM' : 'PM') : 'AM';

  const emit = (h12: number, m: number, p: 'AM' | 'PM') => {
    const h24 = to24(h12, p);
    const val = `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    onChange({ target: { value: val } });
  };

  const handleHourChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newH = parseInt(e.target.value, 10);
    if (isNaN(newH)) return;
    emit(newH, minute ?? 0, period);
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newM = parseInt(e.target.value, 10);
    if (isNaN(newM)) return;
    emit(hour12Index ?? 0, newM, period);
  };

  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newP = e.target.value as 'AM' | 'PM';
    emit(hour12Index ?? 0, minute ?? 0, newP);
  };

  const label = ariaLabel || placeholder || 'Time';

  return (
    <div className="flex gap-1.5 items-center">
      <select
        id={id}
        value={hour12Index !== null ? String(hour12Index) : ''}
        onChange={handleHourChange}
        className={className}
        required={required}
        aria-label={`${label} hour`}
      >
        {hour12Index === null && (
          <option value="">--</option>
        )}
        {HOURS_12.map((h) => (
          <option key={h.value} value={String(h.value)}>
            {h.display}
          </option>
        ))}
      </select>

      <span className="text-theme-text-secondary font-medium select-none">:</span>

      <select
        value={minute !== null ? String(minute).padStart(2, '0') : ''}
        onChange={handleMinuteChange}
        className={className}
        required={required}
        aria-label={`${label} minute`}
      >
        {minute === null && (
          <option value="">--</option>
        )}
        {MINUTE_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <select
        value={period}
        onChange={handlePeriodChange}
        className={className}
        aria-label={`${label} AM/PM`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
};

export default TimeQuarterHour;
