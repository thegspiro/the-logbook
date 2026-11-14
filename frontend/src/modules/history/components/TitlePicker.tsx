/**
 * Choose titles from the department's list. A title that is not on the list is
 * added only by a deliberate "Add … to the list", so a typo cannot quietly
 * become a new title.
 */
import React, { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import type { HistoryTitle } from '../types';

interface TitlePickerProps {
  titles: HistoryTitle[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onTitleAdded: (title: HistoryTitle) => void;
  label: string;
}

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

export const TitlePicker: React.FC<TitlePickerProps> = ({ titles, selectedIds, onChange, onTitleAdded, label }) => {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const byId = useMemo(() => new Map(titles.map((t) => [t.id, t])), [titles]);
  const typed = normalize(query);
  const matches = titles.filter(
    (t) => !t.is_retired && !selectedIds.includes(t.id) && (!typed || t.name.toLowerCase().includes(typed))
  );
  const exact = titles.find((t) => normalize(t.name) === typed);

  const add = (id: string) => {
    onChange([...selectedIds, id]);
    setQuery('');
  };

  const addToList = async () => {
    setAdding(true);
    try {
      const created = await historyService.createTitle(query);
      onTitleAdded(created);
      add(created.id);
      toast.success(`Added "${created.name}" to the title list`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not add the title'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <span className="form-label">{label}</span>
      <ul className="mb-2 flex flex-wrap gap-2" aria-label="Chosen titles">
        {selectedIds.map((id) => (
          <li
            key={id}
            className="bg-theme-surface-secondary text-theme-text-primary inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm"
          >
            {byId.get(id)?.name ?? 'Unknown title'}
            <button
              type="button"
              className="btn-icon-sm"
              aria-label={`Remove ${byId.get(id)?.name ?? 'title'}`}
              onClick={() => onChange(selectedIds.filter((s) => s !== id))}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a title"
        aria-label={`${label}: find a title`}
        className="form-input"
      />
      {(typed || matches.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {matches.slice(0, 12).map((t) => (
            <button key={t.id} type="button" className="btn-secondary btn-sm rounded-md" onClick={() => add(t.id)}>
              {t.name}
            </button>
          ))}
          {typed && !exact && (
            <button
              type="button"
              className="btn-info btn-sm inline-flex items-center gap-1 rounded-md"
              disabled={adding}
              onClick={() => void addToList()}
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              Add &ldquo;{query.trim()}&rdquo; to the list
            </button>
          )}
        </div>
      )}
    </div>
  );
};
