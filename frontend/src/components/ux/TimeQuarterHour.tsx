/**
 * TimeQuarterHour — Quarter-hour time picker
 *
 * Replaces `<input type="time" step="900">` which browsers mostly ignore.
 * Renders a `<select>` dropdown whose options are locked to :00, :15, :30, :45.
 */

import React from 'react';

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

/** Pre-computed quarter-hour options: ["00:00","00:15",…,"23:45"]. */
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const val = `${hh}:${mm}`;

      const period = h < 12 ? 'AM' : 'PM';
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = `${displayH}:${mm} ${period}`;

      opts.push({ value: val, label });
    }
  }
  return opts;
})();

/**
 * Snap an arbitrary "HH:MM" string to the nearest quarter hour.
 * e.g. "14:23" → "14:15", "14:08" → "14:00", "14:47" → "14:45"
 */
function snapToQuarter(time: string): string {
  const parts = time.split(':');
  const h = parts[0] ?? '00';
  const rawM = parseInt(parts[1] ?? '0', 10);
  const snapped = Math.floor(rawM / 15) * 15;
  return `${h}:${String(snapped).padStart(2, '0')}`;
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
  const snappedValue = value ? snapToQuarter(value) : '';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ target: { value: e.target.value } });
  };

  return (
    <select
      id={id}
      value={snappedValue}
      onChange={handleChange}
      className={className}
      required={required}
      aria-label={ariaLabel || placeholder || 'Time'}
    >
      {!snappedValue && (
        <option value="">{placeholder || '--:--'}</option>
      )}
      {TIME_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
};

export default TimeQuarterHour;
