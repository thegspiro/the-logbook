/**
 * Date Range Picker Component (#31)
 *
 * Allows users to select a date range for filtering views
 * like events, training records, and audit logs.
 */

import React, { useState, useMemo } from 'react';
import { Calendar, X } from 'lucide-react';
import { getTodayLocalDate, toLocalDateString } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  className?: string;
  label?: string;
}

const buildPresets = (tz: string) => [
  {
    label: 'Today',
    getDates: () => {
      const d = getTodayLocalDate(tz);
      return [d, d];
    },
  },
  {
    label: 'Last 7 days',
    getDates: () => {
      const e = new Date();
      const s = new Date(e);
      s.setDate(s.getDate() - 7);
      return [toLocalDateString(s, tz), getTodayLocalDate(tz)];
    },
  },
  {
    label: 'Last 30 days',
    getDates: () => {
      const e = new Date();
      const s = new Date(e);
      s.setDate(s.getDate() - 30);
      return [toLocalDateString(s, tz), getTodayLocalDate(tz)];
    },
  },
  {
    label: 'This month',
    getDates: () => {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return [toLocalDateString(s, tz), getTodayLocalDate(tz)];
    },
  },
  {
    label: 'Last 90 days',
    getDates: () => {
      const e = new Date();
      const s = new Date(e);
      s.setDate(s.getDate() - 90);
      return [toLocalDateString(s, tz), getTodayLocalDate(tz)];
    },
  },
  {
    label: 'This year',
    getDates: () => {
      const e = new Date();
      const s = new Date(e.getFullYear(), 0, 1);
      return [toLocalDateString(s, tz), getTodayLocalDate(tz)];
    },
  },
];

export const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onChange,
  className = '',
  label,
}) => {
  const tz = useTimezone();
  const presets = useMemo(() => buildPresets(tz), [tz]);
  const [showPresets, setShowPresets] = useState(false);

  const handleClear = () => {
    onChange('', '');
  };

  const hasValue = startDate || endDate;

  return (
    <div className={`relative ${className}`}>
      {label && <label className="form-label">{label}</label>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-theme-input-bg border-theme-input-border flex w-full min-w-0 items-center gap-1 rounded-lg border sm:w-auto">
          <div className="flex items-center pl-3">
            <Calendar className="text-theme-text-muted h-4 w-4" />
          </div>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onChange(e.target.value, endDate)}
            className="text-theme-text-primary focus:ring-theme-focus-ring min-w-0 flex-1 rounded-sm bg-transparent px-2 py-1.5 text-sm focus:ring-2 focus:outline-hidden sm:flex-none"
            aria-label="Start date"
          />
          <span className="text-theme-text-muted text-sm">&ndash;</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onChange(startDate, e.target.value)}
            className="text-theme-text-primary focus:ring-theme-focus-ring min-w-0 flex-1 rounded-sm bg-transparent px-2 py-1.5 text-sm focus:ring-2 focus:outline-hidden sm:flex-none"
            aria-label="End date"
          />
          {hasValue && (
            <button
              onClick={handleClear}
              className="text-theme-text-muted hover:text-theme-text-primary inline-flex items-center justify-center p-1.5 max-sm:min-h-[44px] max-sm:min-w-[44px]"
              aria-label="Clear date range"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="text-theme-text-muted hover:text-theme-text-primary border-theme-surface-border hover:bg-theme-surface-hover rounded-lg border px-2.5 py-1.5 text-sm transition-colors"
            aria-expanded={showPresets}
            aria-haspopup="true"
          >
            Presets
          </button>
          {showPresets && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPresets(false)} aria-hidden="true" />
              <div
                className="bg-theme-surface-modal border-theme-surface-border absolute top-full left-0 z-20 mt-1 min-w-[140px] rounded-lg border py-1 shadow-lg"
                role="menu"
              >
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    role="menuitem"
                    onClick={() => {
                      const [s, e] = preset.getDates();
                      if (s && e) onChange(s, e);
                      setShowPresets(false);
                    }}
                    className="text-theme-text-primary hover:bg-theme-surface-hover w-full px-3 py-1.5 text-left text-sm transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
