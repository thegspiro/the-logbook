/**
 * Quick-duration presets for the admin-hours time forms.
 *
 * Mirrors the row on the Create Events form so the two read as one control,
 * with the 44px touch minimum the event form's padding alone misses.
 */

import React from 'react';
import { DURATION_PRESET_HOURS } from '../utils/entryTimes';

interface QuickDurationButtonsProps {
  /** Sets the end to the start plus this many hours. */
  onSelect: (hours: number) => void;
  /** True while there is no start time to measure from. */
  disabled?: boolean;
  size?: 'sm' | 'md';
}

const QuickDurationButtons: React.FC<QuickDurationButtonsProps> = ({ onSelect, disabled = false, size = 'md' }) => (
  <div>
    <span
      className={
        size === 'sm'
          ? 'text-theme-text-muted mb-1 block text-xs font-medium'
          : 'text-theme-text-secondary mb-1 block text-sm font-medium'
      }
    >
      Quick duration
    </span>
    <div className="flex flex-wrap gap-2">
      {DURATION_PRESET_HOURS.map((hours) => (
        <button
          key={hours}
          type="button"
          disabled={disabled}
          title={disabled ? 'Set a start time first' : undefined}
          onClick={() => onSelect(hours)}
          className={`text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-secondary focus:ring-theme-focus-ring mobile-touch-target rounded-lg border font-medium transition-colors focus:ring-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 ${
            size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
          }`}
        >
          {hours} {hours === 1 ? 'hour' : 'hours'}
        </button>
      ))}
    </div>
  </div>
);

export default QuickDurationButtons;
