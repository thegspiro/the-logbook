import React from 'react';

export interface HoursSegment {
  label: string;
  value: number;
  /** Tailwind background class for the bar span and the legend dot. */
  colorClass: string;
  onClick?: (() => void) | undefined;
}

interface DashboardHoursCardProps {
  /** Month the figures cover, already localized (e.g. "August"). */
  monthLabel: string;
  segments: HoursSegment[];
  loading: boolean;
}

/**
 * Month-to-date hours as one total plus a proportional split.
 *
 * This replaced four equal-weight stat tiles that stated the same three
 * numbers and their sum. A single stacked bar answers "where did my time go"
 * without asking the reader to divide the tiles in their head.
 */
const DashboardHoursCard: React.FC<DashboardHoursCardProps> = ({ monthLabel, segments, loading }) => {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <section className="card p-4" aria-label={`My hours, ${monthLabel}`}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-theme-text-primary text-[15px] font-bold">My Hours, {monthLabel}</h3>
        {loading ? (
          <div className="bg-theme-surface-hover h-7 w-10 animate-pulse rounded-sm" />
        ) : (
          <span className="flex items-baseline gap-1.5">
            <span className="text-theme-text-primary text-2xl font-bold tabular-nums">{total}</span>
            <span className="text-theme-text-muted text-xs">total</span>
          </span>
        )}
      </div>

      <div className="bg-theme-surface-hover mb-3 flex h-2.5 overflow-hidden rounded-full" aria-hidden="true">
        {total > 0 &&
          segments.map((segment) => (
            <div
              key={segment.label}
              className={segment.colorClass}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ))}
      </div>

      <ul className="flex flex-col gap-1">
        {segments.map((segment) => {
          const row = (
            <>
              <span className={`h-2 w-2 shrink-0 rounded-full ${segment.colorClass}`} aria-hidden="true" />
              <span className="text-theme-text-secondary flex-1 truncate text-left">{segment.label}</span>
              <span className="text-theme-text-primary font-bold tabular-nums">{segment.value}</span>
            </>
          );
          return (
            <li key={segment.label}>
              {segment.onClick ? (
                <button
                  type="button"
                  onClick={segment.onClick}
                  className="hover:bg-theme-surface-hover focus:ring-theme-focus-ring -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors focus:ring-2 focus:outline-hidden max-md:min-h-[44px]"
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-center gap-2 px-0 py-1.5 text-[13px]">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default DashboardHoursCard;
