/**
 * ReportTable Component
 *
 * Reusable sortable table for rendering report data with export controls.
 */

import React, { useState, useMemo } from 'react';
import { Pagination } from '../../../components/ux/Pagination';
import { SortableHeader } from '../../../components/ux/SortableHeader';
import type { SortDirection } from '../../../components/ux/SortableHeader';
import { toStr } from '../utils/export';

interface Column {
  key: string;
  header: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

interface ReportTableProps {
  rows: Array<Record<string, unknown>>;
  columns: Column[];
  pageSize?: number;
  emptyMessage?: string;
  maxHeight?: string;
  /**
   * Where the rows turn into stacked cards. `phone`, the default, reflows
   * below 768px only; from there up the rows are a table, and one wider than
   * the dialog scrolls sideways inside it. That is deliberate: sorting lives
   * in the column headers, which card mode hides, so a report that went to
   * cards on a desktop could not be sorted at all. The nine- and ten-column
   * reports measure 917-958px against a dialog body of at most 974px (~61rem),
   * and the next container tier, 64rem, is wider than the dialog ever gets.
   * `wide` shows cards at every width, for a caller that wants that trade.
   */
  reflow?: 'phone' | 'wide';
}

export const ReportTable: React.FC<ReportTableProps> = ({
  rows,
  columns,
  pageSize = 25,
  emptyMessage = 'No data found.',
  maxHeight = '50vh',
  reflow = 'phone',
}) => {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  // SortableHeader cycles ascending, descending, then none: a third press
  // returns the rows to the order the report produced them in.
  const handleSort = (key: string, direction: SortDirection) => {
    setSortKey(direction ? key : null);
    if (direction) setSortDir(direction);
    setPage(1);
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number' ? aVal - bVal : toStr(aVal).localeCompare(toStr(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.ceil(sortedRows.length / pageSize);
  const paginatedRows = sortedRows.slice((page - 1) * pageSize, page * pageSize);

  if (rows.length === 0) {
    return <p className="text-theme-text-muted py-4 text-sm">{emptyMessage}</p>;
  }

  return (
    <div>
      {/* Focusable so the arrow keys can scroll it. Tabbing through the header
          buttons reaches the columns past the dialog's edge, but nothing in the
          body takes focus, so the rows below the fold need this. */}
      <div
        className="rwd-table-container overflow-x-auto overflow-y-auto"
        style={{ maxHeight }}
        tabIndex={0}
        role="region"
        aria-label="Report results"
      >
        <table className={`rwd-table ${reflow === 'wide' ? 'rwd-table-wide' : ''} w-full text-left text-sm`}>
          <thead className="text-theme-text-muted surface-secondary-opaque sticky top-0 z-10 text-xs uppercase">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-2 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} ${col.className ?? ''}`}
                >
                  {col.sortable !== false ? (
                    <SortableHeader
                      label={col.header}
                      field={col.key}
                      currentSort={sortKey}
                      currentDirection={sortKey === col.key ? sortDir : null}
                      onSort={handleSort}
                    />
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-theme-surface-border divide-y">
            {paginatedRows.map((row, i) => (
              <tr key={i} className="text-theme-text-secondary hover:bg-theme-surface-hover/50">
                {columns.map((col, colIndex) => (
                  <td
                    key={col.key}
                    data-label={col.header}
                    className={`px-4 py-2 ${col.align === 'right' ? 'text-right whitespace-nowrap' : col.align === 'center' ? 'text-center whitespace-nowrap' : ''} ${colIndex === 0 ? 'rwd-table-lead' : ''}`}
                  >
                    {col.render ? col.render(row[col.key], row) : toStr(row[col.key], '-')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3">
          <Pagination currentPage={page} totalItems={sortedRows.length} pageSize={pageSize} onPageChange={setPage} />
        </div>
      )}

      <div className="text-theme-text-muted mt-2 text-xs">
        Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, rows.length)} of {rows.length} rows
      </div>
    </div>
  );
};
