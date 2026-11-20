/**
 * The catalogue fields of a document. Shared by the batch upload (entered once
 * for every file) and the edit page.
 */
import React, { useId } from 'react';
import { Link } from 'react-router';
import type { HistoryDocumentType, HistorySource } from '../types';
import type { DocumentCatalogueForm } from '../utils/documentCatalogue';
import { PartialDateInput } from './PartialDateInput';

interface DocumentCatalogueFieldsProps {
  value: DocumentCatalogueForm;
  onChange: (next: DocumentCatalogueForm) => void;
  sources: HistorySource[];
  types: HistoryDocumentType[];
  /** The batch form leaves the title optional: each file defaults to its name. */
  titleRequired: boolean;
  disabled?: boolean;
}

export const DocumentCatalogueFields: React.FC<DocumentCatalogueFieldsProps> = ({
  value,
  onChange,
  sources,
  types,
  titleRequired,
  disabled = false,
}) => {
  const titleHintId = useId();
  const transcriptionHintId = useId();
  const set = <K extends keyof DocumentCatalogueForm>(key: K, next: DocumentCatalogueForm[K]) =>
    onChange({ ...value, [key]: next });
  const text = (key: keyof DocumentCatalogueForm, label: string, maxLength: number) => (
    <label className="block">
      <span className="form-label">{label}</span>
      <input
        value={value[key] as string}
        onChange={(e) => set(key, e.target.value)}
        maxLength={maxLength}
        className="form-input"
        disabled={disabled}
      />
    </label>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="block">
          <span className="form-label">Title{titleRequired && <span aria-hidden="true"> *</span>}</span>
          <input
            value={value.title}
            onChange={(e) => set('title', e.target.value)}
            maxLength={200}
            required={titleRequired}
            aria-describedby={titleRequired ? undefined : titleHintId}
            className="form-input"
            disabled={disabled}
          />
        </label>
        {!titleRequired && (
          <p id={titleHintId} className="text-theme-text-secondary mt-1 text-xs">
            Leave blank and each file is titled with its own name.
          </p>
        )}
      </div>
      <label className="block">
        <span className="form-label">Type</span>
        <select
          value={value.document_type_id}
          onChange={(e) => set('document_type_id', e.target.value)}
          className="form-input"
          disabled={disabled}
        >
          <option value="">Not recorded</option>
          {types
            .filter((t) => !t.is_retired || t.id === value.document_type_id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </label>
      <div>
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
      {text('author', 'Author or sender', 255)}
      {text('recipient', 'Recipient', 255)}
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
        <label className="block">
          <span className="form-label">Transcription</span>
          <textarea
            value={value.transcription}
            onChange={(e) => set('transcription', e.target.value)}
            rows={8}
            maxLength={1_000_000}
            aria-describedby={transcriptionHintId}
            className="form-input font-mono text-sm"
            disabled={disabled}
          />
        </label>
        <p id={transcriptionHintId} className="text-theme-text-secondary mt-1 text-xs">
          The typed text of a handwritten or scanned page. It is searchable and shown to anyone who can read the
          document.
        </p>
      </div>
      {text('place', 'Place', 255)}
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
        <Link
          to="/history/settings"
          className="text-theme-text-secondary touch:min-h-11 mt-1 inline-flex items-center text-xs underline"
        >
          Manage the source and type lists
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
