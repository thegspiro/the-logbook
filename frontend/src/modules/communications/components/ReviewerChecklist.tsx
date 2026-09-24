/**
 * A filterable checklist of positions or members — who reviews a box, or who
 * a single suggestion is forwarded to.
 */

import React from 'react';
import type { ReviewerRef } from '../types/suggestions';

interface ReviewerChecklistProps {
  legend: string;
  items: ReviewerRef[];
  selected: string[];
  onChange: (selected: string[]) => void;
  filter?: string;
}

const ReviewerChecklist: React.FC<ReviewerChecklistProps> = ({ legend, items, selected, onChange, filter = '' }) => {
  const needle = filter.trim().toLowerCase();
  const visible = needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <fieldset>
      <legend className="form-label">{legend}</legend>
      <div className="border-theme-surface-border max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
        {visible.length === 0 ? (
          <p className="text-theme-text-muted text-sm">None found.</p>
        ) : (
          visible.map((item) => (
            <label
              key={item.id}
              className="text-theme-text-primary flex items-center gap-2 text-sm max-md:min-h-[44px]"
            >
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
    </fieldset>
  );
};

export default ReviewerChecklist;
