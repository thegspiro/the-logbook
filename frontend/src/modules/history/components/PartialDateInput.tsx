/**
 * A date that may be known only to the year or the month, with a "circa" box.
 *
 * The value is always an ISO date string ("1962-01-01" for a year-only date),
 * which is how the server stores it; the precision says how much of it is real.
 */
import React, { useId } from 'react';
import { DATE_PRECISION_LABELS, type DatePrecision } from '../types';

interface PartialDateInputProps {
  label: string;
  value: string | null;
  precision: DatePrecision;
  circa: boolean;
  onChange: (next: { value: string | null; precision: DatePrecision; circa: boolean }) => void;
  disabled?: boolean;
}

const toYear = (value: string | null) => (value ? value.slice(0, 4) : '');
const toMonth = (value: string | null) => (value ? value.slice(0, 7) : '');

export const PartialDateInput: React.FC<PartialDateInputProps> = ({
  label,
  value,
  precision,
  circa,
  onChange,
  disabled = false,
}) => {
  const id = useId();
  const setValue = (raw: string) => {
    let next: string | null;
    if (precision === 'year') next = /^\d{4}$/.test(raw) ? `${raw}-01-01` : null;
    else if (precision === 'month') next = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : null;
    else next = raw || null;
    onChange({ value: next, precision, circa });
  };

  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="form-label">{label}</legend>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`${label}: how much is known`}
          value={precision}
          onChange={(e) => onChange({ value, precision: e.target.value as DatePrecision, circa })}
          className="form-input w-auto"
        >
          {(Object.keys(DATE_PRECISION_LABELS) as DatePrecision[]).map((p) => (
            <option key={p} value={p}>
              {DATE_PRECISION_LABELS[p]}
            </option>
          ))}
        </select>
        {precision === 'year' && (
          <input
            id={id}
            aria-label={label}
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            placeholder="YYYY"
            defaultValue={toYear(value)}
            key={`year-${value ?? ''}`}
            onBlur={(e) => setValue(e.target.value.trim())}
            className="form-input w-24"
          />
        )}
        {precision === 'month' && (
          <input
            id={id}
            aria-label={label}
            type="month"
            value={toMonth(value)}
            onChange={(e) => setValue(e.target.value)}
            className="form-input w-auto"
          />
        )}
        {precision === 'day' && (
          <input
            id={id}
            aria-label={label}
            type="date"
            value={value ?? ''}
            onChange={(e) => setValue(e.target.value)}
            className="form-input w-auto"
          />
        )}
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={circa}
            onChange={(e) => onChange({ value, precision, circa: e.target.checked })}
          />
          <span className="text-theme-text-primary">Approximate</span>
        </label>
      </div>
    </fieldset>
  );
};
