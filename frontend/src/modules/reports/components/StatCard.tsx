/**
 * StatCard Component
 *
 * Displays a single KPI metric with optional trend indicator.
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatNumber } from '@/utils/dateFormatting';

interface StatCardProps {
  label: string;
  value: string | number;
  previousValue?: number;
  suffix?: string;
  className?: string;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, previousValue, suffix, className }) => {
  const showTrend = previousValue !== undefined && typeof value === 'number';
  let trendPct = 0;
  let trendDir: 'up' | 'down' | 'flat' = 'flat';

  if (showTrend && previousValue > 0) {
    trendPct = Math.round(((value - previousValue) / previousValue) * 100);
    trendDir = trendPct > 0 ? 'up' : trendPct < 0 ? 'down' : 'flat';
  }

  return (
    <div className={`bg-theme-surface-secondary rounded-lg p-3 text-center ${className ?? ''}`}>
      <div className="text-theme-text-primary text-xl font-bold">
        {typeof value === 'number' ? formatNumber(value) : value}
        {suffix && <span className="text-theme-text-muted ml-0.5 text-sm font-normal">{suffix}</span>}
      </div>
      <div className="text-theme-text-muted text-xs">{label}</div>
      {showTrend && trendDir !== 'flat' && (
        <div
          className={`mt-1 flex items-center justify-center gap-0.5 text-xs ${trendDir === 'up' ? 'text-green-400' : 'text-red-400'}`}
        >
          {trendDir === 'up' ? (
            <TrendingUp className="h-3 w-3" />
          ) : trendDir === 'down' ? (
            <TrendingDown className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          <span>
            {trendPct > 0 ? '+' : ''}
            {trendPct}%
          </span>
        </div>
      )}
    </div>
  );
};
