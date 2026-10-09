/**
 * Which column of the file feeds which import field, and the time zone the
 * file is read in.
 *
 * Detected from the header row at upload; corrected here for exports whose
 * headers the import does not recognise. Changing either re-reads every row
 * from the cells as uploaded, keeping any per-row edits.
 */

import React, { useEffect, useState } from 'react';
import type {
  HistoryImportDetail,
  HistoryImportSettingsUpdate,
} from '../../../../modules/scheduling/types/historyImport';
import { HISTORY_IMPORT_FIELD_LABELS } from '../../../../modules/scheduling/types/historyImport';
import { useTimezone } from '../../../../hooks/useTimezone';
import { timezoneOptions } from './historyImportTimezones';

interface ReviewColumnsProps {
  detail: HistoryImportDetail;
  busy: boolean;
  onSettings: (payload: HistoryImportSettingsUpdate) => void;
}

const ReviewColumns: React.FC<ReviewColumnsProps> = ({ detail, busy, onSettings }) => {
  const viewerZone = useTimezone();
  const [mapping, setMapping] = useState<Record<string, string>>(detail.column_mapping);

  useEffect(() => {
    setMapping(detail.column_mapping);
  }, [detail.column_mapping]);

  const dirty = JSON.stringify(mapping) !== JSON.stringify(detail.column_mapping);
  const used = new Set(Object.values(mapping));

  return (
    <section aria-labelledby="review-columns-heading" className="space-y-4">
      <div className="card p-4">
        <h2 id="review-columns-heading" className="text-theme-text-primary text-lg font-semibold">
          Time zone
        </h2>
        <p className="text-theme-text-secondary mb-3 text-sm">
          Every time in the file is read in this zone. If the hours look an hour or more off, the file was probably
          written in a different zone.
        </p>
        <div className="sm:w-80">
          <label htmlFor="review-timezone" className="form-label">
            Times in the file are in
          </label>
          <select
            id="review-timezone"
            className="form-input"
            value={detail.import.timezone}
            disabled={busy}
            onChange={(e) => onSettings({ timezone: e.target.value })}
          >
            {timezoneOptions(detail.import.timezone, viewerZone).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <form
        className="card p-4"
        aria-labelledby="review-columns-mapping-heading"
        onSubmit={(e) => {
          e.preventDefault();
          const payload: Record<string, string | null> = {};
          for (const field of detail.fields) payload[field] = mapping[field] || null;
          onSettings({ column_mapping: payload });
        }}
      >
        <h2 id="review-columns-mapping-heading" className="text-theme-text-primary text-lg font-semibold">
          Columns
        </h2>
        <p className="text-theme-text-secondary mb-4 text-sm">
          A member needs a name, ID, email or username; every row needs a unit, a start time and an end time, and a date
          unless the start time column carries one.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {detail.fields.map((field) => {
            const id = `column-${field}`;
            const current = mapping[field] ?? '';
            return (
              <div key={field}>
                <label htmlFor={id} className="form-label">
                  {HISTORY_IMPORT_FIELD_LABELS[field] ?? field}
                </label>
                <select
                  id={id}
                  className="form-input"
                  value={current}
                  disabled={busy}
                  onChange={(e) => {
                    const header = e.target.value;
                    const next = Object.fromEntries(Object.entries(mapping).filter(([key]) => key !== field));
                    setMapping(header ? { ...next, [field]: header } : next);
                  }}
                >
                  <option value="">Not in this file</option>
                  {detail.headers.map((header) => (
                    <option key={header} value={header} disabled={used.has(header) && header !== current}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!dirty || busy}
            onClick={() => setMapping(detail.column_mapping)}
          >
            Reset
          </button>
          <button type="submit" className="btn-primary" disabled={!dirty || busy}>
            Save columns
          </button>
        </div>
      </form>
    </section>
  );
};

export default ReviewColumns;
