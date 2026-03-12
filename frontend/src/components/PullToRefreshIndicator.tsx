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
      className="fixed top-0 left-0 right-0 z-40 flex justify-center pointer-events-none"
      style={{ transform: `translateY(${refreshing ? 48 : pullDistance * 0.5}px)` }}
      aria-live="polite"
      aria-label={refreshing ? 'Refreshing' : 'Pull to refresh'}
    >
      <div className="bg-theme-surface rounded-full shadow-lg p-2 border border-theme-surface-border">
        {refreshing ? (
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowDown
            className="w-5 h-5 text-theme-text-secondary transition-transform"
            style={{ transform: `rotate(${rotation}deg)`, opacity: progress }}
            aria-hidden="true"
            data-testid="pull-arrow"
          />
        )}
      </div>
    </div>
  );
};
