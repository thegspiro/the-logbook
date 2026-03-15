/**
 * DateTimeQuarterHour — Date + quarter-hour time picker
 *
 * Replaces `<input type="datetime-local" step="900">` which browsers
 * mostly ignore. Splits the input into a native date picker and a
 * `<select>` dropdown whose options are locked to :00, :15, :30, :45.
 */

import React, { useMemo } from 'react';

interface DateTimeQuarterHourProps {
  /** datetime-local string, e.g. "2026-03-14T09:30" */
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  required?: boolean;
}

/** Generate ["00:00","00:15",…,"23:45"] once. */
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const opts: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const val = `${hh}:${mm}`;

      // 12-hour display label
      const period = h < 12 ? 'AM' : 'PM';
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const label = `${displayH}:${mm} ${period}`;

      opts.push({ value: val, label });
    }
  }
  return opts;
})();

/**
 * Snap an arbitrary "HH:MM" string down to the nearest quarter hour.
 * e.g. "14:23" → "14:15", "14:08" → "14:00", "14:47" → "14:45"
 */
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
    // value is "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD HH:MM"
    const sep = value.includes('T') ? 'T' : ' ';
    const [d, t] = value.split(sep);
    return { datePart: d ?? '', timePart: snapToQuarter(t ?? '09:00') };
  }, [value]);

  const handleDateChange = (newDate: string) => {
    const time = timePart || '09:00';
    onChange(`${newDate}T${time}`);
  };

  const handleTimeChange = (newTime: string) => {
    const date = datePart || (new Date().toISOString().split('T')[0] ?? '');
    onChange(`${date}T${newTime}`);
  };

  return (
    <div className="flex gap-2">
      <input
        type="date"
        id={id}
        required={required}
        value={datePart}
        onChange={(e) => handleDateChange(e.target.value)}
        className={className}
        style={{ flex: '1 1 55%' }}
      />
      <select
        value={timePart}
        onChange={(e) => handleTimeChange(e.target.value)}
        className={className}
        style={{ flex: '1 1 45%' }}
        aria-label="Time"
      >
        {!timePart && <option value="">--:--</option>}
        {TIME_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default DateTimeQuarterHour;
