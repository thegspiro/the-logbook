/**
 * ReportTable Component
 *
 * Reusable sortable table for rendering report data with export controls.
 */

import React, { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Pagination } from '../../../components/ux/Pagination';
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
}

export const ReportTable: React.FC<ReportTableProps> = ({
  rows,
  columns,
  pageSize = 25,
  emptyMessage = 'No data found.',
  maxHeight = '50vh',
}) => {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
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

  const SortIcon: React.FC<{ columnKey: string }> = ({ columnKey }) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  };

  return (
    <div>
      <div className={`overflow-x-auto overflow-y-auto`} style={{ maxHeight }}>
        <table className="w-full text-left text-sm">
          <thead className="text-theme-text-muted bg-theme-surface-secondary sticky top-0 z-10 text-xs uppercase">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-2 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} ${col.sortable !== false ? 'hover:text-theme-text-primary cursor-pointer select-none' : ''} ${col.className ?? ''}`}
                  onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                >
                  {col.header}
                  {col.sortable !== false && <SortIcon columnKey={col.key} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-theme-surface-border divide-y">
            {paginatedRows.map((row, i) => (
              <tr key={i} className="text-theme-text-secondary hover:bg-theme-surface-hover/50">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-2 whitespace-nowrap ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
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
