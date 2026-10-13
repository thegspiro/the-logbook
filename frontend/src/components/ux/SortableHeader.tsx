/**
 * Sortable Table Header Component (#30)
 *
 * Click-to-sort column headers for table views.
 */

import React, { useLayoutEffect, useRef } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

export type SortDirection = 'asc' | 'desc' | null;

interface SortableHeaderProps {
  label: string;
  field: string;
  currentSort: string | null;
  currentDirection: SortDirection;
  onSort: (field: string, direction: SortDirection) => void;
  className?: string;
}

export const SortableHeader: React.FC<SortableHeaderProps> = ({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  className = '',
}) => {
  const isActive = currentSort === field;
  const sortState = isActive && currentDirection ? (currentDirection === 'asc' ? 'ascending' : 'descending') : 'none';
  const buttonRef = useRef<HTMLButtonElement>(null);

  // `aria-sort` is only valid on a column header; on the button it was flagged
  // by axe and never announced. Set on the enclosing <th> so every caller gets
  // it without restructuring its table.
  useLayoutEffect(() => {
    const header = buttonRef.current?.closest('th');
    if (!header) return undefined;
    header.setAttribute('aria-sort', sortState);
    return () => header.removeAttribute('aria-sort');
  }, [sortState]);

  const handleClick = () => {
    if (!isActive) {
      onSort(field, 'asc');
    } else if (currentDirection === 'asc') {
      onSort(field, 'desc');
    } else {
      onSort(field, null);
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      className={`hover:text-theme-text-primary group inline-flex min-h-6 items-center gap-1 text-xs font-medium tracking-wider uppercase transition-colors ${
        isActive ? 'text-theme-text-primary' : 'text-theme-text-secondary'
      } ${className}`}
    >
      {label}
      <span className="shrink-0" aria-hidden="true">
        {isActive && currentDirection === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : isActive && currentDirection === 'desc' ? (
          <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-50 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-50 pointer-fine:group-hover:opacity-50" />
        )}
      </span>
    </button>
  );
};
