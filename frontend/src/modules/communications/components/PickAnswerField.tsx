/**
 * Answer a pick question by choosing a member or a vehicle from the
 * department's list. The list is already in the browser; typing only narrows
 * it, so the name a member is reporting never goes over the network.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { PickOption } from '../types/suggestions';
import type { PickOptionsState } from '../hooks/usePickOptions';

// Enough to scan on a phone; the filter narrows a long roster quickly.
const MAX_SHOWN = 8;

interface PickAnswerFieldProps {
  inputId: string;
  labelId: string;
  helpId?: string | undefined;
  noun: string;
  emptyMessage: string;
  state: PickOptionsState;
  value: string;
  onChange: (value: string) => void;
}

const PickAnswerField: React.FC<PickAnswerFieldProps> = ({
  inputId,
  labelId,
  helpId,
  noun,
  emptyMessage,
  state,
  value,
  onChange,
}) => {
  const [filter, setFilter] = useState('');

  if (state.isLoading) {
    return <p className="text-theme-text-muted text-sm">Loading the list…</p>;
  }
  if (state.failed) {
    return (
      <p role="alert" className="text-theme-alert-danger-text text-sm">
        Unable to load the list. Reload the page to try again.
      </p>
    );
  }
  if (state.options.length === 0) {
    return <p className="text-theme-text-muted text-sm">{emptyMessage}</p>;
  }

  const chosen = state.options.find((o) => o.id === value);
  if (chosen) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-theme-text-primary text-sm font-medium">{chosen.name}</span>
        <button
          type="button"
          className="btn-icon"
          aria-label={`Choose a different ${noun}`}
          onClick={() => {
            setFilter('');
            onChange('');
          }}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  const needle = filter.trim().toLowerCase();
  const matches: PickOption[] = needle
    ? state.options.filter((o) => o.name.toLowerCase().includes(needle))
    : state.options;
  const shown = matches.slice(0, MAX_SHOWN);

  return (
    <div className="space-y-2">
      <input
        id={inputId}
        className="form-input"
        value={filter}
        placeholder={`Type to find a ${noun}`}
        aria-labelledby={labelId}
        aria-describedby={helpId}
        autoComplete="off"
        onChange={(e) => setFilter(e.target.value)}
      />
      {shown.length > 0 ? (
        <ul
          className="border-theme-surface-border divide-theme-surface-border divide-y rounded-md border"
          aria-labelledby={labelId}
        >
          {shown.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className="text-theme-text-primary hover:bg-theme-surface-secondary mobile-touch-target w-full px-3 py-2 text-left text-sm"
                onClick={() => onChange(option.id)}
              >
                {option.name}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-theme-text-muted text-sm">
          No {noun} matches “{filter.trim()}”.
        </p>
      )}
      {matches.length > shown.length && (
        <p className="text-theme-text-muted text-xs">
          Showing {shown.length} of {matches.length}. Keep typing to narrow the list.
        </p>
      )}
    </div>
  );
};

export default PickAnswerField;
