/**
 * The catalogue fields of a photo, recording or video. Shared by the batch
 * upload (entered once for every file) and the edit page.
 */
import React from 'react';
import { Link } from 'react-router';
import type { HistorySource } from '../types';
import type { CatalogueForm } from '../utils/mediaCatalogue';
import { PartialDateInput } from './PartialDateInput';

interface MediaCatalogueFieldsProps {
  value: CatalogueForm;
  onChange: (next: CatalogueForm) => void;
  sources: HistorySource[];
  /** The batch form leaves the title optional: each file defaults to its name. */
  titleRequired: boolean;
  disabled?: boolean;
}

export const MediaCatalogueFields: React.FC<MediaCatalogueFieldsProps> = ({
  value,
  onChange,
  sources,
  titleRequired,
  disabled = false,
}) => {
  const set = <K extends keyof CatalogueForm>(key: K, next: CatalogueForm[K]) => onChange({ ...value, [key]: next });
  const text = (key: keyof CatalogueForm, label: string, maxLength: number, hint?: string) => (
    <label className="block">
      <span className="form-label">{label}</span>
      <input
        value={value[key] as string}
        onChange={(e) => set(key, e.target.value)}
        maxLength={maxLength}
        className="form-input"
        disabled={disabled}
      />
      {hint && <span className="text-theme-text-secondary mt-1 block text-xs">{hint}</span>}
    </label>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block sm:col-span-2">
        <span className="form-label">Title{titleRequired && <span aria-hidden="true"> *</span>}</span>
        <input
          value={value.title}
          onChange={(e) => set('title', e.target.value)}
          maxLength={200}
          required={titleRequired}
          className="form-input"
          disabled={disabled}
        />
        {!titleRequired && (
          <span className="text-theme-text-secondary mt-1 block text-xs">
            Leave blank and each file is titled with its own name.
          </span>
        )}
      </label>
      <label className="block sm:col-span-2">
        <span className="form-label">Description</span>
        <textarea
          value={value.description}
          onChange={(e) => set('description', e.target.value)}
          rows={3}
          maxLength={20000}
          className="form-input"
          disabled={disabled}
        />
      </label>
      <div className="sm:col-span-2">
        <PartialDateInput
          label="Date"
          value={value.taken_date}
          precision={value.taken_date_precision}
          circa={value.taken_date_circa}
          disabled={disabled}
          onChange={(next) =>
            onChange({
              ...value,
              taken_date: next.value,
              taken_date_precision: next.precision,
              taken_date_circa: next.circa,
            })
          }
        />
      </div>
      {text('place', 'Place', 255)}
      {text('creator', 'Photographer or creator', 255)}
      <label className="block">
        <span className="form-label">Source or donor</span>
        <select
          value={value.source_id}
          onChange={(e) => set('source_id', e.target.value)}
          className="form-input"
          disabled={disabled}
        >
          <option value="">Not recorded</option>
          {sources
            .filter((s) => !s.is_retired || s.id === value.source_id)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <Link to="/history/settings" className="text-theme-text-secondary mt-1 inline-block text-xs underline">
          Manage the source list
        </Link>
      </label>
      {text('accession_number', 'Accession number', 100)}
      {text('original_location', 'Where the physical original is kept', 255)}
      <label className="block sm:col-span-2">
        <span className="form-label">Rights or copyright</span>
        <input
          value={value.rights_note}
          onChange={(e) => set('rights_note', e.target.value)}
          maxLength={2000}
          className="form-input"
          disabled={disabled}
        />
      </label>
      <label className="block sm:col-span-2">
        <span className="form-label">Research notes (Historian only)</span>
        <textarea
          value={value.research_notes}
          onChange={(e) => set('research_notes', e.target.value)}
          rows={3}
          maxLength={20000}
          className="form-input"
          disabled={disabled}
        />
      </label>
    </div>
  );
};
