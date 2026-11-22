/**
 * Apparatus a photo, document or event is linked to, picked from the
 * archive's historical apparatus. A truck not yet in the archive is added
 * from the apparatus pages first.
 */
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { historyApparatusService } from '../services/api';
import type { ApparatusSummary, ApparatusTag } from '../types';

interface ApparatusPickerProps {
  value: ApparatusTag[];
  onChange: (next: ApparatusTag[]) => void;
  disabled?: boolean;
}

const describe = (item: ApparatusSummary): string =>
  [item.designations.join(', '), item.service_span].filter(Boolean).join(' · ');

export const ApparatusPicker: React.FC<ApparatusPickerProps> = ({ value, onChange, disabled = false }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ApparatusSummary[]>([]);

  useEffect(() => {
    if (query.trim().length < 1) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      historyApparatusService
        .listApparatus({ search: query.trim(), limit: 10 })
        .then((list) => {
          if (!cancelled) setResults(list.items);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const chosen = new Set(value.map((a) => a.apparatus_id));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Linked apparatus">
          {value.map((item) => (
            <li
              key={item.apparatus_id}
              className="bg-theme-surface-secondary text-theme-text-primary inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm"
            >
              {item.name}
              <button
                type="button"
                className="btn-icon-sm touch-target-phone"
                aria-label={`Remove ${item.name}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((a) => a.apparatus_id !== item.apparatus_id))}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="block">
        <span className="form-label">Add an apparatus</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, unit number or year"
          className="form-input"
          disabled={disabled}
        />
      </label>
      {results.length > 0 && (
        <ul className="space-y-1">
          {results
            .filter((item) => !chosen.has(item.id))
            .map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...value, { apparatus_id: item.id, name: item.name }]);
                    setQuery('');
                    setResults([]);
                  }}
                  className="touch-target-phone text-theme-text-primary text-left text-sm underline"
                >
                  {item.name}
                  {describe(item) && <> ({describe(item)})</>}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
};
