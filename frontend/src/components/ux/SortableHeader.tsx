/**
 * Sortable Table Header Component (#30)
 *
 * Click-to-sort column headers for table views.
 */

import React from 'react';
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
      onClick={handleClick}
      className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider hover:text-theme-text-primary transition-colors group ${
        isActive ? 'text-theme-text-primary' : 'text-theme-text-secondary'
      } ${className}`}
      aria-sort={isActive ? (currentDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="flex-shrink-0">
        {isActive && currentDirection === 'asc' ? (
          <ArrowUp className="w-3.5 h-3.5" />
        ) : isActive && currentDirection === 'desc' ? (
          <ArrowDown className="w-3.5 h-3.5" />
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 opacity-0 group-hover:opacity-50 transition-opacity" />
        )}
      </span>
    </button>
  );
};

/** Generic sort utility
 * @deprecated Prefer dedicated sort logic in components */
// eslint-disable-next-line react-refresh/only-export-components
export function sortItems<T>(
  items: T[],
  field: string | null,
  direction: SortDirection,
  accessor?: (item: T, field: string) => string | number | Date | null | undefined
): T[] {
  if (!field || !direction) return items;

  return [...items].sort((a, b) => {
    const getVal = accessor || ((item: T, f: string) => (item as Record<string, unknown>)[f]);
    const aVal = getVal(a, field);
    const bVal = getVal(b, field);

    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;

    let cmp: number;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      cmp = aVal.localeCompare(bVal);
    } else {
      cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    }

    return direction === 'desc' ? -cmp : cmp;
  });
}
