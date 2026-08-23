import React from 'react';
import type { AdminMetric } from '../../types/adminHub';

/**
 * The four headline metrics on an administration page.
 *
 * Always four, never five: the row is a glance, and a fifth card makes it a
 * report. Three describe the healthy state of the module; the fourth is the
 * count that feeds the "Needs attention" queue below, which is why it is
 * always last and never configurable.
 *
 * On a phone the row compresses to two columns — the first two slots are the
 * ones that survive there, which is what the settings screen means when it
 * labels them "phone".
 */

interface AdminMetricsRowProps {
  metrics: AdminMetric[];
  /** Renders placeholder cards while the summary is in flight. */
  loading?: boolean;
  /** Layout the frame owns — the phone/desk order swap lives there. */
  className?: string | undefined;
}

const SKELETON_SLOTS = 4;

const MetricCard: React.FC<{ metric: AdminMetric }> = ({ metric }) => (
  // The attention slot borrows the queue's danger border when it is carrying
  // anything, so the row and the card below it read as one statement. At zero
  // it stays an ordinary card — nothing is wrong, and a red box saying so is
  // its own kind of noise.
  <div className={`card p-3 sm:p-4 ${metric.fixed && metric.value !== '0' ? 'border-theme-alert-danger-border' : ''}`}>
    <p className="text-theme-text-muted truncate text-[11px] font-semibold tracking-[0.12em] uppercase">
      {metric.label}
    </p>
    <p className="text-theme-text-primary mt-1 text-2xl leading-none font-bold tabular-nums sm:text-3xl">
      {metric.value}
    </p>
    {metric.context && <p className="text-theme-text-muted mt-1.5 truncate text-xs">{metric.context}</p>}
  </div>
);

export const AdminMetricsRow: React.FC<AdminMetricsRowProps> = ({ metrics, loading = false, className = '' }) => {
  if (loading) {
    return (
      <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${className}`} aria-hidden="true">
        {Array.from({ length: SKELETON_SLOTS }, (_, index) => (
          <div key={index} className="card p-3 sm:p-4">
            <div className="shimmer-skeleton h-3 w-20 rounded" />
            <div className="shimmer-skeleton mt-2 h-7 w-16 rounded" />
            <div className="shimmer-skeleton mt-2 h-3 w-24 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (metrics.length === 0) return null;

  return (
    // A labelled region, not a bare grid: the row is one of the frame's five
    // named parts, and naming it is what lets a screen reader — and a test —
    // address it as the metrics row rather than as "a grid of four divs".
    <section aria-label="Headline metrics" className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${className}`}>
      {metrics.map((metric) => (
        <MetricCard key={metric.key} metric={metric} />
      ))}
    </section>
  );
};

export default AdminMetricsRow;
