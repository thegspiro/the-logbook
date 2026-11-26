/**
 * Card-mode sort control.
 *
 * A reflowing table (`rwd-table`) hides its `<thead>` when it shows as cards,
 * and the column headers are where `SortableHeader` puts sorting, so on a
 * phone, or in a card too narrow for the table, the rows could not be sorted
 * at all. This is the same sort, as a labelled select and a direction button,
 * shown only while the headers are hidden.
 *
 * Visibility is CSS, not JavaScript, so it switches at exactly the width the
 * table does: `.rwd-card-sort` in index.css shows below a 768px viewport, and
 * with `tier` it also shows inside a `rwd-table-container` narrower than that
 * tier. Pass the same tier as the table's `rwd-table-<tier>` class and render
 * the control inside the same container, before the table. While hidden it is
 * `display: none`, so it is out of the tab order and the accessibility tree.
 */

import React, { useId } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SortDirection } from './SortableHeader';

export interface CardSortOption {
  field: string;
  label: string;
}

interface CardSortControlProps {
  /** The table's sortable columns, labelled as their headers are. */
  options: CardSortOption[];
  currentSort: string | null;
  currentDirection: SortDirection;
  /** The handler the table's `SortableHeader`s already call. */
  onSort: (field: string, direction: SortDirection) => void;
  /** The table's container tier; omit for a table on the base reflow only. */
  tier?: 'narrow' | 'wide' | 'xwide' | '2xwide';
  /**
   * Offer "Default order". False for a table that is always sorted by some
   * column, such as one sorted on the server with a default column, where
   * clearing the sort has no meaning.
   */
  allowDefault?: boolean;
  className?: string;
}

export const CardSortControl: React.FC<CardSortControlProps> = ({
  options,
  currentSort,
  currentDirection,
  onSort,
  tier,
  allowDefault = true,
  className = '',
}) => {
  const selectId = useId();
  const active = currentSort !== null && currentDirection !== null;
  const descending = active && currentDirection === 'desc';

  const handleField = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const field = e.target.value;
    if (!field) {
      onSort(currentSort ?? '', null);
      return;
    }
    // Picking a column keeps the direction already chosen, so switching from
    // "Hours, highest first" to "Trainings" does not flip the order as well.
    onSort(field, active ? currentDirection : 'asc');
  };

  const toggleDirection = () => {
    if (!active || currentSort === null) return;
    onSort(currentSort, descending ? 'asc' : 'desc');
  };

  return (
    <div className={`rwd-card-sort ${tier ? `rwd-card-sort-${tier}` : ''} items-end gap-2 pb-3 ${className}`}>
      <div className="min-w-0 flex-1">
        <label htmlFor={selectId} className="form-label">
          Sort by
        </label>
        <select id={selectId} className="form-input" value={active ? currentSort : ''} onChange={handleField}>
          {allowDefault && <option value="">Default order</option>}
          {options.map((option) => (
            <option key={option.field} value={option.field}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="btn-icon border-theme-surface-border text-theme-text-primary border"
        onClick={toggleDirection}
        disabled={!active}
        aria-label={descending ? 'Sort ascending' : 'Sort descending'}
        title={descending ? 'Descending' : 'Ascending'}
      >
        {descending ? (
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
};
