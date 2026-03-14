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
  { label: 'Today', getDates: () => { const d = getTodayLocalDate(tz); return [d, d]; } },
  { label: 'Last 7 days', getDates: () => { const e = new Date(); const s = new Date(e); s.setDate(s.getDate() - 7); return [toLocalDateString(s, tz), getTodayLocalDate(tz)]; } },
  { label: 'Last 30 days', getDates: () => { const e = new Date(); const s = new Date(e); s.setDate(s.getDate() - 30); return [toLocalDateString(s, tz), getTodayLocalDate(tz)]; } },
  { label: 'Last 90 days', getDates: () => { const e = new Date(); const s = new Date(e); s.setDate(s.getDate() - 90); return [toLocalDateString(s, tz), getTodayLocalDate(tz)]; } },
  { label: 'This year', getDates: () => { const e = new Date(); const s = new Date(e.getFullYear(), 0, 1); return [toLocalDateString(s, tz), getTodayLocalDate(tz)]; } },
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
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-theme-input-bg border border-theme-input-border rounded-lg">
          <div className="flex items-center pl-3">
            <Calendar className="w-4 h-4 text-theme-text-muted" />
          </div>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onChange(e.target.value, endDate)}
            className="px-2 py-1.5 bg-transparent text-sm text-theme-text-primary focus:outline-hidden"
            aria-label="Start date"
          />
          <span className="text-theme-text-muted text-sm">&ndash;</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onChange(startDate, e.target.value)}
            className="px-2 py-1.5 bg-transparent text-sm text-theme-text-primary focus:outline-hidden"
            aria-label="End date"
          />
          {hasValue && (
            <button
              onClick={handleClear}
              className="p-1.5 text-theme-text-muted hover:text-theme-text-primary"
              aria-label="Clear date range"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="px-2.5 py-1.5 text-sm text-theme-text-muted hover:text-theme-text-primary border border-theme-surface-border rounded-lg hover:bg-theme-surface-hover transition-colors"
          >
            Presets
          </button>
          {showPresets && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPresets(false)} />
              <div className="absolute top-full left-0 mt-1 z-20 bg-theme-surface-modal border border-theme-surface-border rounded-lg shadow-lg py-1 min-w-[140px]">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      const [s, e] = preset.getDates();
                      if (s && e) onChange(s, e);
                      setShowPresets(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
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
