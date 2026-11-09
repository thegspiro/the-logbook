/**
 * A filterable checklist of positions or members — who reviews a box, or who
 * a single suggestion is forwarded to.
 */

import React, { useId } from 'react';
import type { ReviewerRef } from '../types/suggestions';

interface ReviewerChecklistProps {
  legend: string;
  items: ReviewerRef[];
  selected: string[];
  onChange: (selected: string[]) => void;
  filter?: string;
  /** A refusal about the selection, shown under the list and announced on the group. */
  error?: string | null | undefined;
  /** Lets a form focus the group when its refusal is the first one. */
  id?: string | undefined;
}

const ReviewerChecklist: React.FC<ReviewerChecklistProps> = ({
  legend,
  items,
  selected,
  onChange,
  filter = '',
  error,
  id,
}) => {
  const errorId = useId();
  const needle = filter.trim().toLowerCase();
  const visible = needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <fieldset
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="form-label">{legend}</legend>
      <div className="border-theme-surface-border max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {visible.length === 0 ? (
          <p className="text-theme-text-muted text-sm">None found.</p>
        ) : (
          visible.map((item) => (
            <label key={item.id} className="text-theme-text-primary touch:min-h-[44px] flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={selected.includes(item.id)}
                onChange={() => toggle(item.id)}
              />
              {item.name}
            </label>
          ))
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-sm text-red-800 dark:text-red-300">
          {error}
        </p>
      )}
    </fieldset>
  );
};

export default ReviewerChecklist;
