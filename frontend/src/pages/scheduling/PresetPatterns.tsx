/**
 * Preset Patterns
 *
 * Displays a grid of common fire department shift patterns that can be
 * selected to quickly pre-fill the pattern creation form.
 */

import React from 'react';
import { Clock, Moon, Sun, Repeat } from 'lucide-react';
import { PRESET_PATTERNS } from './shiftPatternPresets';
import type { PresetPatternDef, CycleEntry } from './shiftPatternPresets';

/** Small visual cycle preview strip. */
const CyclePreview: React.FC<{ pattern: PresetPatternDef }> = ({ pattern }) => {
  const entries: CycleEntry[] =
    pattern.cyclePattern ??
    Array.from({ length: pattern.cycleDays }, (_, i) =>
      i < (pattern.daysOn ?? 0) ? ('on' as const) : ('off' as const)
    );

  const labels = entries.map((entry, i) => {
    let label = 'Off';
    if (entry === 'on') label = 'On duty';
    else if (entry === 'day') label = 'Day shift';
    else if (entry === 'night') label = 'Night shift';
    return {
      bg:
        entry === 'on'
          ? 'bg-violet-500'
          : entry === 'day'
            ? 'bg-amber-400 dark:bg-amber-500'
            : entry === 'night'
              ? 'bg-indigo-500 dark:bg-indigo-400'
              : 'bg-theme-surface-hover',
      title: `Day ${i + 1}: ${label}`,
      label,
    };
  });
  const summary = labels.map((l) => l.title).join(', ');
  return (
    <div className="mt-2 flex gap-0.5" role="img" aria-label={`Cycle pattern: ${summary}`}>
      {labels.map((item, i) => (
        <div key={i} className={`h-2 flex-1 rounded-xs ${item.bg}`} title={item.title} aria-hidden="true" />
      ))}
    </div>
  );
};

/** Icon for pattern category. */
const CategoryIcon: React.FC<{ category: PresetPatternDef['category'] }> = ({ category }) => {
  if (category === 'rotating') return <Repeat className="h-5 w-5" />;
  if (category === 'complex') return <Moon className="h-5 w-5" />;
  return <Sun className="h-5 w-5" />;
};

interface PresetPatternsProps {
  onSelect: (preset: PresetPatternDef) => void;
  selectedId?: string | null | undefined;
}

const PresetPatterns: React.FC<PresetPatternsProps> = ({ onSelect, selectedId }) => {
  return (
    <div className="space-y-4">
      <div className="text-theme-text-muted flex flex-wrap items-center gap-3 text-xs">
        <span className="flex items-center gap-1">
          <div className="h-2 w-3 rounded-xs bg-violet-500" /> On duty
        </span>
        <span className="flex items-center gap-1">
          <div className="h-2 w-3 rounded-xs bg-amber-400 dark:bg-amber-500" /> Day shift
        </span>
        <span className="flex items-center gap-1">
          <div className="h-2 w-3 rounded-xs bg-indigo-500 dark:bg-indigo-400" /> Night shift
        </span>
        <span className="flex items-center gap-1">
          <div className="bg-theme-surface-hover h-2 w-3 rounded-xs" /> Off duty
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PRESET_PATTERNS.map((preset) => {
          const isSelected = selectedId === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onSelect(preset)}
              className={`rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30'
                  : 'border-theme-surface-border bg-theme-surface hover:border-violet-500/40 hover:bg-violet-500/5'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isSelected ? 'bg-violet-500/20 text-violet-500' : 'bg-theme-input-bg text-theme-text-muted'
                  }`}
                >
                  <CategoryIcon category={preset.category} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-theme-text-primary truncate text-sm font-semibold">{preset.name}</p>
                  </div>
                  <p className="text-theme-text-muted mt-0.5 line-clamp-2 text-xs">{preset.description}</p>
                  <div className="text-theme-text-muted mt-1.5 flex items-center gap-2 text-[10px]">
                    <Clock className="h-3 w-3" />
                    <span>{preset.cycleDays}-day cycle</span>
                    {preset.hasDayNight && (
                      <span className="flex items-center gap-1">
                        <Sun className="h-3 w-3 text-amber-500" />
                        <Moon className="h-3 w-3 text-indigo-700 dark:text-indigo-400" />
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <CyclePreview pattern={preset} />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PresetPatterns;
