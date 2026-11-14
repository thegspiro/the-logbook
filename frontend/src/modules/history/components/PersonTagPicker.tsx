/**
 * Who is shown or heard in an item, picked from the archive's people.
 *
 * Each chosen person's photo-use answer is shown beside them when the server
 * has given one — a warning for the Historian, never a refusal (owner
 * decision). A person not yet in the archive is added from the roster first.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { historyService } from '../services/api';
import { CONSENT_STATE_LABELS, type ConsentState, type HistoricalMemberSummary } from '../types';

export interface PickedPerson {
  member_id: string;
  display_name: string;
  consent?: ConsentState | undefined;
}

interface PersonTagPickerProps {
  value: PickedPerson[];
  onChange: (next: PickedPerson[]) => void;
  disabled?: boolean;
}

export const PersonTagPicker: React.FC<PersonTagPickerProps> = ({ value, onChange, disabled = false }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HistoricalMemberSummary[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      historyService
        .listPeople({ search: query.trim(), limit: 10 })
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

  const chosen = new Set(value.map((p) => p.member_id));

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-1" aria-label="Tagged people">
          {value.map((person) => {
            const warn = person.consent === 'declined' || person.consent === 'not_answered';
            return (
              <li key={person.member_id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-theme-text-primary font-medium">{person.display_name}</span>
                {person.consent && (
                  <span
                    className={`inline-flex items-center gap-1 text-xs ${
                      warn ? 'alert-warning rounded px-1.5 py-0.5' : 'text-theme-text-secondary'
                    }`}
                  >
                    {warn && <AlertTriangle className="h-3 w-3" aria-hidden="true" />}
                    {CONSENT_STATE_LABELS[person.consent]}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onChange(value.filter((p) => p.member_id !== person.member_id))}
                  disabled={disabled}
                  className="btn-icon touch-target-phone"
                  aria-label={`Remove ${person.display_name}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <label className="block">
        <span className="form-label">Add a person</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name or badge number"
          className="form-input"
          disabled={disabled}
        />
      </label>
      {results.length > 0 && (
        <ul className="space-y-1">
          {results
            .filter((p) => !chosen.has(p.id))
            .map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...value, { member_id: p.id, display_name: p.display_name }]);
                    setQuery('');
                    setResults([]);
                  }}
                  className="touch-target-phone text-theme-text-primary text-left text-sm underline"
                >
                  {p.display_name}
                  {p.service_years && <> ({p.service_years})</>}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
};
