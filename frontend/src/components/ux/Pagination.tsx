/**
 * Pagination Component (#11)
 *
 * Provides page numbers, page size selector, and total count display
 * for list views with large data sets.
 */

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  className = '',
}) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getPageNumbers = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('ellipsis');

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);

      if (currentPage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  if (totalItems === 0) return null;

  return (
    <div className={`flex flex-col items-center justify-between gap-3 px-2 py-3 sm:flex-row ${className}`}>
      {/* Info text */}
      <div className="text-theme-text-muted text-sm">
        Showing <span className="text-theme-text-secondary font-medium">{startItem}</span> &ndash;{' '}
        <span className="text-theme-text-secondary font-medium">{endItem}</span> of{' '}
        <span className="text-theme-text-secondary font-medium">{totalItems}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        {/* Page size selector. One height for the whole bar with a mouse: the
            select, the arrows and the page numbers are all 40px, and all 44px
            on a phone or touch screen. The arrows used to keep an
            unconditional 44px beside 40px numbers and a 33px select. */}
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <label htmlFor="page-size" className="text-theme-text-muted text-sm">
              Per page:
            </label>
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="form-input-sm md:pointer-fine:min-h-10"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Page buttons. The edge buttons use aria-disabled, not disabled: a
            disabled button drops focus to <body>, so pressing Next onto the
            last page used to throw a keyboard user out of the list. */}
        <nav aria-label="Pagination" className="flex items-center gap-0.5">
          <button
            onClick={() => {
              if (currentPage === 1) return;
              onPageChange(1);
            }}
            aria-disabled={currentPage === 1}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch:min-h-[44px] touch:min-w-[44px] inline-flex min-h-10 min-w-10 items-center justify-center rounded-md transition-all duration-150 active:scale-95 aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
            aria-label="First page"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (currentPage === 1) return;
              onPageChange(currentPage - 1);
            }}
            aria-disabled={currentPage === 1}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch:min-h-[44px] touch:min-w-[44px] inline-flex min-h-10 min-w-10 items-center justify-center rounded-md transition-all duration-150 active:scale-95 aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {getPageNumbers().map((page, idx) =>
            page === 'ellipsis' ? (
              <span key={`e${idx}`} className="text-theme-text-muted px-1" aria-hidden="true">
                &hellip;
              </span>
            ) : (
              <button
                key={page}
                onClick={() => onPageChange(page)}
                className={`touch:h-11 touch:min-w-[44px] inline-flex h-10 min-w-[40px] items-center justify-center rounded-md text-sm font-medium transition-all duration-150 ${
                  page === currentPage
                    ? 'scale-105 bg-red-800 text-white shadow-sm'
                    : 'text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover hover:shadow-sm active:scale-95'
                }`}
                aria-current={page === currentPage ? 'page' : undefined}
              >
                {page}
              </button>
            )
          )}

          <button
            onClick={() => {
              if (currentPage === totalPages) return;
              onPageChange(currentPage + 1);
            }}
            aria-disabled={currentPage === totalPages}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch:min-h-[44px] touch:min-w-[44px] inline-flex min-h-10 min-w-10 items-center justify-center rounded-md transition-all duration-150 active:scale-95 aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              if (currentPage === totalPages) return;
              onPageChange(totalPages);
            }}
            aria-disabled={currentPage === totalPages}
            className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch:min-h-[44px] touch:min-w-[44px] inline-flex min-h-10 min-w-10 items-center justify-center rounded-md transition-all duration-150 active:scale-95 aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
            aria-label="Last page"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </nav>
      </div>
    </div>
  );
};
