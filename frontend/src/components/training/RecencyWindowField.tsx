/**
 * RecencyWindowField
 *
 * "Must have been completed within the last N days" — a freshness window on a
 * training requirement. Shared by the create-pipeline wizard, the pipeline
 * requirement modal, and the department requirements page so the three agree on
 * wording and on what an empty value means.
 *
 * Distinct from the requirement's frequency, which sets a recurring obligation
 * ("redo it every year"). This constrains how old an individual completion may
 * be and still count — a recruit school can demand CPR within the last 180 days
 * while the department's own CPR requirement stays a one-time item. Off by
 * default: any completion counts, however old.
 */

import React from 'react';
import { History } from 'lucide-react';

interface RecencyWindowFieldProps {
  /** Days, or undefined when no window is set. */
  value: number | undefined;
  onChange: (days: number | undefined) => void;
  /** Prefix for generated DOM ids — must be unique per field on the page. */
  idPrefix: string;
}

// Windows officers reach for most often, so the common cases are one click.
const PRESETS: { days: number; label: string }[] = [
  { days: 90, label: '90 days' },
  { days: 180, label: '180 days' },
  { days: 365, label: '1 year' },
  { days: 730, label: '2 years' },
];

export const RecencyWindowField: React.FC<RecencyWindowFieldProps> = ({ value, onChange, idPrefix }) => {
  const enabled = value != null;
  const toggleId = `${idPrefix}-recency-enabled`;
  const daysId = `${idPrefix}-recency-days`;

  return (
    <div className="border-theme-surface-border space-y-2 rounded-md border p-3">
      <label className="text-theme-text-primary flex items-center gap-2 text-sm font-medium" htmlFor={toggleId}>
        <input
          id={toggleId}
          type="checkbox"
          className="form-checkbox"
          checked={enabled}
          // Default to the 180-day case the field was built for, rather than an
          // empty box that fails validation the moment it's ticked.
          onChange={(e) => onChange(e.target.checked ? 180 : undefined)}
        />
        <History className="h-4 w-4" aria-hidden="true" />
        <span>Require a recent completion</span>
      </label>

      <p className="text-theme-text-muted text-xs">
        {enabled ? (
          <>
            Only completions from the last <strong>{value}</strong> days count. An older one — even a valid
            certification — leaves this requirement unmet, and an officer can&apos;t credit a record from outside the
            window.
          </>
        ) : (
          <>Off: a completion counts however long ago it happened. Turn this on to require recent training.</>
        )}
      </p>

      {enabled && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              id={daysId}
              type="number"
              min={1}
              max={3650}
              className="form-input-sm w-28"
              value={value}
              onChange={(e) => {
                const next = Number(e.target.value);
                onChange(Number.isFinite(next) && next > 0 ? next : undefined);
              }}
            />
            <label className="text-theme-text-secondary text-sm" htmlFor={daysId}>
              days
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                onClick={() => onChange(preset.days)}
                aria-pressed={value === preset.days}
                className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
                  value === preset.days
                    ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                    : 'bg-theme-surface text-theme-text-muted hover:bg-theme-surface-hover'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecencyWindowField;
