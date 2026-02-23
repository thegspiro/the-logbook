/**
 * Skeleton Loading Component (#4)
 *
 * Content placeholder screens that reduce perceived load time
 * and prevent layout shift during data fetching.
 */

import React from 'react';

interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  width,
  height,
  rounded = 'md',
}) => {
  const roundedClasses = {
    none: '',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  };

  return (
    <div
      className={`animate-pulse bg-theme-surface-hover ${roundedClasses[rounded]} ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
};

/** Skeleton row for table loading states */
export const SkeletonRow: React.FC<{ columns?: number }> = ({ columns = 5 }) => (
  <div className="flex items-center gap-4 p-4">
    {Array.from({ length: columns }).map((_, i) => (
      <Skeleton key={i} className="h-4 flex-1" />
    ))}
  </div>
);

/** Skeleton card for grid loading states */
export const SkeletonCard: React.FC = () => (
  <div className="card p-5 space-y-3">
    <Skeleton className="h-5 w-3/4" />
    <Skeleton className="h-3 w-1/2" />
    <div className="flex gap-2 pt-2">
      <Skeleton className="h-6 w-16" rounded="full" />
      <Skeleton className="h-6 w-20" rounded="full" />
    </div>
    <div className="space-y-2 pt-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  </div>
);

/** Skeleton for list page loading (stat cards + table rows) */
export const SkeletonPage: React.FC<{ rows?: number; showStats?: boolean }> = ({
  rows = 5,
  showStats = true,
}) => (
  <div className="space-y-6" aria-label="Loading content" role="status">
    <span className="sr-only">Loading...</span>
    {showStats && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-14" />
          </div>
        ))}
      </div>
    )}
    <div className="card overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="border-b border-theme-surface-border last:border-b-0">
          <SkeletonRow />
        </div>
      ))}
    </div>
  </div>
);

/** Skeleton for event card grid */
export const SkeletonCardGrid: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" role="status">
    <span className="sr-only">Loading...</span>
    {Array.from({ length: count }).map((_, i) => (
      <SkeletonCard key={i} />
    ))}
  </div>
);
