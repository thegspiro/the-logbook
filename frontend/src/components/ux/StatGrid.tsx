import React from 'react';

interface StatGridProps {
  children: React.ReactNode;
  /** The most tiles a row holds once there is room. Match it to the tile count. */
  columns: 3 | 4 | 5 | 6;
  gap?: 3 | 4;
  className?: string;
  /** For a row that is a labelled landmark, e.g. `role="region"`. */
  role?: string;
  'aria-label'?: string;
}

// Literal strings, so Tailwind's scanner sees every class it has to generate.
const COLUMNS: Record<StatGridProps['columns'], string> = {
  3: 'grid-cols-1 @[34rem]:grid-cols-3',
  4: 'grid-cols-1 @[17rem]:grid-cols-2 @[44rem]:grid-cols-4',
  5: 'grid-cols-1 @[17rem]:grid-cols-2 @[34rem]:grid-cols-3 @[56rem]:grid-cols-5',
  6: 'grid-cols-1 @[17rem]:grid-cols-2 @[34rem]:grid-cols-3 @[66rem]:grid-cols-6',
};
const GAP: Record<NonNullable<StatGridProps['gap']>, string> = { 3: 'gap-3', 4: 'gap-4' };

/**
 * A row of headline-number tiles that picks its column count from the width it
 * is given, not the screen's.
 *
 * Stat rows were laid out with viewport breakpoints (`md:grid-cols-4`), which
 * cannot see the 256px sidebar: at 768px the content column is ~460px, and four
 * tiles left each one ~120px, so labels and numbers ran out of their boxes on
 * the analytics, monitoring, forms, training and scheduling screens. Measured
 * here against the grid's own container, a four-tile row goes 1 → 2 → 4 and
 * never 3 + 1, and every step leaves a tile at least ~8.5rem wide.
 *
 * The wrapper is the query container. A query container also contains the
 * layout of what is inside it, so a fixed-position child would be placed
 * against the wrapper rather than the screen; tiles hold no such thing.
 */
export const StatGrid: React.FC<StatGridProps> = ({
  children,
  columns,
  gap = 3,
  className = '',
  role,
  'aria-label': ariaLabel,
}) => (
  <div className={`@container ${className}`} role={role} aria-label={ariaLabel}>
    <div className={`grid ${GAP[gap]} ${COLUMNS[columns]}`} data-testid="stat-grid">
      {children}
    </div>
  </div>
);
