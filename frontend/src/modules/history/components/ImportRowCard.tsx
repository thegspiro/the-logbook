/**
 * One line of an import under review: what the file says, what is wrong with
 * it, what the server suggests it is, and the Historian's decision.
 *
 * The suggestions come from the server and are only offered here; nothing is
 * decided until the Historian picks one.
 */
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Pencil, Search } from 'lucide-react';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import {
  IMPORT_DECISION_LABELS,
  IMPORT_FIELD_LABELS,
  type HistoricalMemberSummary,
  type ImportDecision,
  type ImportRow,
  type ImportRowUpdate,
} from '../types';

interface ImportRowCardProps {
  row: ImportRow;
  disabled: boolean;
  onUpdate: (rowId: string, payload: ImportRowUpdate) => Promise<void>;
}

const SUGGESTION_VERB: Record<string, string> = {
  match: 'Add to',
  map: 'Link to',
  same_as: 'Mark as',
};

function personName(values: Record<string, string>): string {
  const parts = [values.first_name, values.middle_name, values.last_name, values.suffix];
  return parts.filter(Boolean).join(' ') || 'No name';
}

function span(values: Record<string, string>): string | null {
  if (!values.joined && !values.left) return null;
  return `${values.joined ?? '?'}–${values.left ?? ''}`;
}

export const ImportRowCard: React.FC<ImportRowCardProps> = ({ row, disabled, onUpdate }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HistoricalMemberSummary[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const decided = row.decision !== null;
  const hasProblems = row.problems.length > 0 && row.decision !== 'skip';

  const startEditing = () => {
    setDraft(Object.fromEntries(Object.keys(IMPORT_FIELD_LABELS).map((key) => [key, row.values[key] ?? ''])));
    setEditing(true);
  };

  const saveEdits = async () => {
    await onUpdate(row.id, { edits: draft });
    setEditing(false);
  };

  const decide = (decision: ImportDecision | null, target: Partial<ImportRowUpdate> = {}) =>
    onUpdate(row.id, { decision, ...target });

  const search = async () => {
    setSearchError(null);
    try {
      const found = await historyService.listPeople({ search: query.trim() || undefined, limit: 10 });
      setResults(found.items);
    } catch (err: unknown) {
      setSearchError(getErrorMessage(err, 'Search failed.'));
    }
  };

  const years = span(row.values);

  return (
    <li className="p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-theme-text-primary font-medium">
            <span className="text-theme-text-secondary mr-2 text-sm font-normal">Line {row.line_number}</span>
            {personName(row.values)}
            {row.values.nickname && <> “{row.values.nickname}”</>}
          </p>
          <p className="text-theme-text-secondary text-sm">
            {[row.values.badge_number && `Badge ${row.values.badge_number}`, years, row.values.titles]
              .filter(Boolean)
              .join(' · ') || 'No dates or titles'}
            {row.edited_fields.length > 0 && <> · corrected</>}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 text-sm ${
            decided && !hasProblems ? 'text-theme-text-primary' : 'text-theme-text-secondary'
          }`}
        >
          {decided && !hasProblems ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          )}
          {decided ? IMPORT_DECISION_LABELS[row.decision ?? 'create'] : 'Needs a decision'}
        </span>
      </div>

      {row.target_label && <p className="text-theme-text-secondary mt-1 text-sm">→ {row.target_label}</p>}

      {hasProblems && (
        <ul className="alert-warning mt-2 list-inside list-disc rounded-md p-2 text-sm" aria-label="Problems">
          {row.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {row.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="Suggestions">
          {row.suggestions.map((s) => (
            <button
              key={`${s.kind}-${s.id}`}
              type="button"
              disabled={disabled}
              onClick={() =>
                void decide(
                  s.kind,
                  s.kind === 'match'
                    ? { target_member_id: s.id }
                    : s.kind === 'map'
                      ? { target_user_id: s.id }
                      : { target_row_id: s.id }
                )
              }
              className="btn-secondary touch-target-phone rounded-md px-2 py-1 text-sm"
            >
              {SUGGESTION_VERB[s.kind]} {s.label}
              {s.strength === 'weak' && <span className="text-theme-text-secondary"> (possible)</span>}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => void decide('create')}
          className="btn-secondary touch-target-phone rounded-md px-2 py-1 text-sm"
        >
          New record
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void decide('skip')}
          className="btn-secondary touch-target-phone rounded-md px-2 py-1 text-sm"
        >
          Skip
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setSearching((open) => !open)}
          aria-expanded={searching}
          className="btn-secondary touch-target-phone inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Another record…
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => (editing ? setEditing(false) : startEditing())}
          aria-expanded={editing}
          className="btn-secondary touch-target-phone inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Correct values
        </button>
        {decided && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void decide(null)}
            className="text-theme-text-secondary touch-target-phone rounded-md px-2 py-1 text-sm underline"
          >
            Undo decision
          </button>
        )}
      </div>

      {searching && (
        <div className="card-secondary mt-2 p-3">
          <label className="block">
            <span className="form-label">Find the record this row adds to</span>
            <div className="flex gap-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void search();
                  }
                }}
                className="form-input"
                placeholder="Name or badge number"
              />
              <button type="button" onClick={() => void search()} className="btn-secondary rounded-md px-3 text-sm">
                Search
              </button>
            </div>
          </label>
          {searchError && (
            <p role="alert" className="text-theme-text-primary mt-2 text-sm">
              {searchError}
            </p>
          )}
          {results.length > 0 && (
            <ul className="mt-2 space-y-1">
              {results.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      void decide('match', { target_member_id: person.id }).then(() => setSearching(false));
                    }}
                    className="touch-target-phone text-theme-text-primary text-left text-sm underline"
                  >
                    {person.display_name}
                    {person.service_years && <> ({person.service_years})</>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <form
          className="card-secondary mt-2 grid gap-2 p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveEdits();
          }}
        >
          {Object.entries(IMPORT_FIELD_LABELS).map(([key, label]) => (
            <label key={key} className={key === 'notes' || key === 'titles' ? 'sm:col-span-2' : ''}>
              <span className="form-label">{label}</span>
              <input
                value={draft[key] ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                className="form-input"
              />
            </label>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={disabled} className="btn-primary rounded-md px-3 py-2 text-sm">
              Save corrections
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn-secondary rounded-md px-3 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
};
