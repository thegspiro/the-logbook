/**
 * Pull-to-Refresh Visual Indicator
 *
 * Shows a spinner/arrow at the top of the page during pull-to-refresh.
 * Renders above the page content as a fixed-position overlay.
 */

import React from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';

interface PullToRefreshIndicatorProps {
  pulling: boolean;
  refreshing: boolean;
  pullDistance: number;
  threshold?: number;
}

export const PullToRefreshIndicator: React.FC<PullToRefreshIndicatorProps> = ({
  pulling,
  refreshing,
  pullDistance,
  threshold = 80,
}) => {
  if (!pulling && !refreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 180;

  return (
    <div
      className="safe-top pointer-events-none fixed top-0 right-0 left-0 z-40 flex justify-center"
      style={{ transform: `translateY(${refreshing ? 48 : pullDistance * 0.5}px)` }}
      aria-live="polite"
      aria-label={refreshing ? 'Refreshing' : 'Pull to refresh'}
    >
      <div className="bg-theme-surface border-theme-surface-border rounded-full border p-2 shadow-lg">
        {refreshing ? (
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" aria-hidden="true" />
        ) : (
          <ArrowDown
            className="text-theme-text-secondary h-5 w-5 transition-transform"
            style={{ transform: `rotate(${rotation}deg)`, opacity: progress }}
            aria-hidden="true"
            data-testid="pull-arrow"
          />
        )}
      </div>
    </div>
  );
};
