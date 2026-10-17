/**
 * Finds a file in the Documents library to link from an agenda item.
 *
 * The library applies its own folder rules to the search, so a member is only
 * offered files they can open, and the server checks the same again when the
 * agenda is saved. The name shown on the minutes is the library's, not
 * anything typed here.
 */

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { documentsService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { AgendaDocument } from '../../../services/api';

interface AgendaDocumentPickerProps {
  id: string;
  /** Ids already linked, so they are not offered twice. */
  linked: ReadonlySet<string>;
  onPick: (document: AgendaDocument) => void;
}

const RESULT_LIMIT = 8;

export const AgendaDocumentPicker: React.FC<AgendaDocumentPickerProps> = ({ id, linked, onPick }) => {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<AgendaDocument[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const query = term.trim();
    if (!query) return;
    setSearching(true);
    setError(null);
    try {
      const found = await documentsService.getDocuments({ search: query, limit: RESULT_LIMIT });
      setResults(found.documents.map((d) => ({ id: d.id, name: d.name })));
    } catch (err: unknown) {
      setResults(null);
      setError(getErrorMessage(err, 'Failed to search the library'));
    } finally {
      setSearching(false);
    }
  };

  const offered = (results ?? []).filter((r) => !linked.has(r.id));

  return (
    <div>
      <label htmlFor={id} className="form-label">
        Link a document
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="search"
          value={term}
          placeholder="Search the Documents library"
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          className="form-input"
        />
        <button
          type="button"
          onClick={() => {
            void search();
          }}
          disabled={searching || !term.trim()}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && (
        <p className="alert-danger mt-2 text-sm" role="alert">
          {error}
        </p>
      )}
      {results && !error && (
        <ul className="border-theme-surface-border mt-2 divide-y rounded-md border" aria-label="Matching documents">
          {offered.length === 0 && <li className="text-theme-text-muted p-2 text-sm">No matching documents.</li>}
          {offered.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <span className="text-theme-text-primary min-w-0 truncate">{doc.name}</span>
              <button
                type="button"
                className="text-sm text-blue-700 hover:text-blue-900 dark:text-blue-400"
                onClick={() => {
                  onPick(doc);
                  setResults(null);
                  setTerm('');
                }}
                aria-label={`Link ${doc.name}`}
              >
                Link
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AgendaDocumentPicker;
