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
  const entries: CycleEntry[] = pattern.cyclePattern ??
    Array.from({ length: pattern.cycleDays }, (_, i) =>
      i < (pattern.daysOn ?? 0) ? 'on' as const : 'off' as const
    );

  return (
    <div className="flex gap-0.5 mt-2">
      {entries.map((entry, i) => {
        let bg = 'bg-gray-300 dark:bg-gray-600';
        let title = 'Off';
        if (entry === 'on') {
          bg = 'bg-violet-500';
          title = 'On duty';
        } else if (entry === 'day') {
          bg = 'bg-amber-400 dark:bg-amber-500';
          title = 'Day shift';
        } else if (entry === 'night') {
          bg = 'bg-indigo-500 dark:bg-indigo-400';
          title = 'Night shift';
        }
        return (
          <div
            key={i}
            className={`h-2 flex-1 rounded-sm ${bg}`}
            title={`Day ${i + 1}: ${title}`}
          />
        );
      })}
    </div>
  );
};

/** Icon for pattern category. */
const CategoryIcon: React.FC<{ category: PresetPatternDef['category'] }> = ({ category }) => {
  if (category === 'rotating') return <Repeat className="w-5 h-5" />;
  if (category === 'complex') return <Moon className="w-5 h-5" />;
  return <Sun className="w-5 h-5" />;
};

interface PresetPatternsProps {
  onSelect: (preset: PresetPatternDef) => void;
  selectedId?: string | null;
}

const PresetPatterns: React.FC<PresetPatternsProps> = ({ onSelect, selectedId }) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap text-xs text-theme-text-muted">
        <span className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-violet-500" /> On duty
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-amber-400 dark:bg-amber-500" /> Day shift
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-indigo-500 dark:bg-indigo-400" /> Night shift
        </span>
        <span className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-gray-300 dark:bg-gray-600" /> Off duty
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PRESET_PATTERNS.map(preset => {
          const isSelected = selectedId === preset.id;
          return (
            <button
              key={preset.id}
              onClick={() => onSelect(preset)}
              className={`text-left p-4 rounded-xl border transition-all ${
                isSelected
                  ? 'border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30'
                  : 'border-theme-surface-border bg-theme-surface hover:border-violet-500/40 hover:bg-violet-500/5'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isSelected ? 'bg-violet-500/20 text-violet-500' : 'bg-theme-input-bg text-theme-text-muted'
                }`}>
                  <CategoryIcon category={preset.category} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-theme-text-primary truncate">{preset.name}</p>
                  </div>
                  <p className="text-xs text-theme-text-muted mt-0.5 line-clamp-2">{preset.description}</p>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-theme-text-muted">
                    <Clock className="w-3 h-3" />
                    <span>{preset.cycleDays}-day cycle</span>
                    {preset.hasDayNight && (
                      <span className="flex items-center gap-1">
                        <Sun className="w-3 h-3 text-amber-500" />
                        <Moon className="w-3 h-3 text-indigo-400" />
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
