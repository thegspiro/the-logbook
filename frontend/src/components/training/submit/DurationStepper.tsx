import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { DURATION_STEP_MINUTES, MIN_DURATION_MINUTES, QUICK_DURATIONS, formatDuration } from './submitFormatting';

export const DurationStepper: React.FC<{
  minutes: number;
  maxMinutes: number;
  onChange: (minutes: number) => void;
}> = ({ minutes, maxMinutes, onChange }) => {
  const step = (delta: number) => onChange(Math.min(maxMinutes, Math.max(MIN_DURATION_MINUTES, minutes + delta)));

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex flex-1 items-center justify-between gap-2.5 sm:flex-none sm:justify-start">
        <button
          type="button"
          onClick={() => step(-DURATION_STEP_MINUTES)}
          disabled={minutes <= MIN_DURATION_MINUTES}
          aria-label="Decrease length by 15 minutes"
          className="border-theme-input-border text-theme-text-secondary hover:bg-theme-surface-hover flex h-12 w-12 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 sm:h-11 sm:w-11"
        >
          <Minus className="h-[18px] w-[18px]" />
        </button>
        <output className="text-theme-text-primary min-w-24 text-center font-mono text-2xl font-semibold sm:text-xl">
          {formatDuration(minutes)}
        </output>
        <button
          type="button"
          onClick={() => step(DURATION_STEP_MINUTES)}
          disabled={minutes >= maxMinutes}
          aria-label="Increase length by 15 minutes"
          className="border-theme-input-border text-theme-text-secondary hover:bg-theme-surface-hover flex h-12 w-12 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 sm:h-11 sm:w-11"
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>
      </div>
      <div className="grid w-full grid-cols-4 gap-2 sm:flex sm:w-auto">
        {QUICK_DURATIONS.filter((quick) => quick <= maxMinutes).map((quick) => {
          const active = quick === minutes;
          return (
            <button
              key={quick}
              type="button"
              onClick={() => onChange(quick)}
              aria-pressed={active}
              className={`min-h-11 rounded-full border px-3.5 font-mono text-sm transition-colors sm:min-h-9 ${
                active
                  ? 'border-red-600 bg-red-600 text-white'
                  : 'border-theme-input-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
              }`}
            >
              {formatDuration(quick)}
            </button>
          );
        })}
      </div>
    </div>
  );
};
