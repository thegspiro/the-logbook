/**
 * A choice from one of the department's managed lists. A keeper may add an
 * entry from here, but only by a deliberate "Add", so a typo cannot quietly
 * become a new station; the settings page corrects or merges one afterwards.
 */
import React, { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyListService, type ManagedListPath } from '../services/api';
import type { HistoryListEntry } from '../types';

interface ListEntrySelectProps {
  label: string;
  path: ManagedListPath;
  entries: HistoryListEntry[];
  value: string;
  onChange: (id: string) => void;
  /** Called with a new entry, so the caller adds it to its list. */
  onAdded?: ((entry: HistoryListEntry) => void) | undefined;
  /** "station", "event type": how the add control names an entry. */
  noun: string;
  disabled?: boolean;
}

export const ListEntrySelect: React.FC<ListEntrySelectProps> = ({
  label,
  path,
  entries,
  value,
  onChange,
  onAdded,
  noun,
  disabled = false,
}) => {
  const inputId = useId();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const created = await historyListService.create(path, name);
      onAdded?.(created);
      onChange(created.id);
      setName('');
      setAdding(false);
      toast.success(`Added "${created.name}"`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, `Could not add this ${noun}`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label className="block">
        <span className="form-label">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className="form-input" disabled={disabled}>
          <option value="">Not recorded</option>
          {entries
            .filter((entry) => !entry.is_retired || entry.id === value)
            .map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
        </select>
      </label>
      {onAdded &&
        (adding ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-[1_1_10rem]" htmlFor={inputId}>
              <span className="form-label">New {noun}</span>
              <input
                id={inputId}
                value={name}
                maxLength={150}
                onChange={(e) => setName(e.target.value)}
                className="form-input"
              />
            </label>
            <button
              type="button"
              className="btn-secondary btn-sm rounded-md"
              disabled={saving || !name.trim()}
              onClick={() => void add()}
            >
              Add
            </button>
            <button type="button" className="btn-secondary btn-sm rounded-md" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="text-theme-text-secondary touch-target-phone mt-1 text-xs underline"
            onClick={() => setAdding(true)}
            disabled={disabled}
          >
            Add a {noun} to the list
          </button>
        ))}
    </div>
  );
};
