/**
 * Custom Pattern Builder
 *
 * Interactive visual builder for creating custom shift cycle patterns.
 * Admins click cells in a grid to toggle between off / day / night shifts,
 * then the resulting cycle_pattern is sent to the backend.
 */

import React, { useState } from 'react';
import { Plus, Minus, RotateCcw, Sun, Moon } from 'lucide-react';
import type { CycleEntry } from './shiftPatternPresets';

const PERIOD_PRESETS = [
  { label: '6 days', value: 6 },
  { label: '1 week', value: 7 },
  { label: '9 days', value: 9 },
  { label: '2 weeks', value: 14 },
  { label: '3 weeks', value: 21 },
  { label: '4 weeks', value: 28 },
] as const;

const ENTRY_CYCLE: CycleEntry[] = ['off', 'day', 'night', 'on'];
const ENTRY_LABELS: Record<CycleEntry, string> = {
  off: 'Off',
  day: 'Day',
  night: 'Night',
  on: 'On',
};

const ENTRY_STYLES: Record<CycleEntry, string> = {
  off: 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600',
  day: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-400 dark:border-amber-600',
  night: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-400 dark:border-indigo-500',
  on: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-400 dark:border-violet-500',
};

const ENTRY_ICON: Record<CycleEntry, React.ReactNode> = {
  off: null,
  day: <Sun className="w-3.5 h-3.5" />,
  night: <Moon className="w-3.5 h-3.5" />,
  on: <Sun className="w-3.5 h-3.5" />,
};

interface CustomPatternBuilderProps {
  cyclePattern: CycleEntry[];
  onChange: (pattern: CycleEntry[]) => void;
}

const CustomPatternBuilder: React.FC<CustomPatternBuilderProps> = ({ cyclePattern, onChange }) => {
  const [cycleDays, setCycleDays] = useState(cyclePattern.length || 7);

  const adjustLength = (newLength: number) => {
    const clamped = Math.max(2, Math.min(56, newLength));
    setCycleDays(clamped);
    const updated = [...cyclePattern];
    if (clamped > updated.length) {
      while (updated.length < clamped) updated.push('off');
    } else {
      updated.length = clamped;
    }
    onChange(updated);
  };

  const toggleCell = (index: number) => {
    const updated = [...cyclePattern];
    const current = updated[index] ?? 'off';
    const nextIdx = (ENTRY_CYCLE.indexOf(current) + 1) % ENTRY_CYCLE.length;
    updated[index] = ENTRY_CYCLE[nextIdx] ?? 'off';
    onChange(updated);
  };

  const resetAll = () => {
    onChange(Array.from({ length: cycleDays }, () => 'off' as const));
  };

  const fillRange = (entry: CycleEntry) => {
    onChange(Array.from({ length: cycleDays }, () => entry));
  };

  // Calculate stats
  const onCount = cyclePattern.filter(e => e !== 'off').length;
  const dayCount = cyclePattern.filter(e => e === 'day').length;
  const nightCount = cyclePattern.filter(e => e === 'night').length;
  const onDutyCount = cyclePattern.filter(e => e === 'on').length;
  const offCount = cyclePattern.filter(e => e === 'off').length;

  // Split cycle into weeks for display
  const weeks: CycleEntry[][] = [];
  for (let i = 0; i < cyclePattern.length; i += 7) {
    weeks.push(cyclePattern.slice(i, i + 7));
  }

  return (
    <div className="space-y-4">
      {/* Cycle length controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-theme-text-secondary whitespace-nowrap">Cycle Length:</label>
          <button
            onClick={() => adjustLength(cycleDays - 1)}
            className="p-1 rounded border border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:border-violet-500 transition-colors"
            aria-label="Decrease cycle length"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-sm font-semibold text-theme-text-primary w-16 text-center">{cycleDays} days</span>
          <button
            onClick={() => adjustLength(cycleDays + 1)}
            className="p-1 rounded border border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary hover:border-violet-500 transition-colors"
            aria-label="Increase cycle length"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PERIOD_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => adjustLength(p.value)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                cycleDays === p.value
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'border-theme-surface-border text-theme-text-muted hover:border-violet-500'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick fill buttons */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-theme-text-muted">Quick fill:</span>
        <button onClick={() => fillRange('day')} className="px-2 py-1 text-[11px] rounded border border-amber-400/50 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors">
          All Day
        </button>
        <button onClick={() => fillRange('night')} className="px-2 py-1 text-[11px] rounded border border-indigo-400/50 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition-colors">
          All Night
        </button>
        <button onClick={() => fillRange('on')} className="px-2 py-1 text-[11px] rounded border border-violet-400/50 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors">
          All On
        </button>
        <button onClick={resetAll} className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary transition-colors">
          <RotateCcw className="w-3 h-3" /> Clear
        </button>
      </div>

      {/* Cycle grid */}
      <div className="space-y-2">
        <p className="text-xs text-theme-text-muted">Click each day to cycle through: Off → Day → Night → On → Off</p>
        {weeks.map((week, weekIdx) => (
          <div key={weekIdx} className="flex gap-1.5">
            <span className="w-6 text-[10px] text-theme-text-muted flex items-center justify-end pr-1">
              {weekIdx > 0 || weeks.length > 1 ? `W${weekIdx + 1}` : ''}
            </span>
            {week.map((entry, dayIdx) => {
              const globalIdx = weekIdx * 7 + dayIdx;
              return (
                <button
                  key={globalIdx}
                  onClick={() => toggleCell(globalIdx)}
                  className={`flex-1 min-w-[40px] max-w-[64px] h-12 rounded-lg border-2 flex flex-col items-center justify-center gap-0.5 transition-all hover:scale-105 ${ENTRY_STYLES[entry]}`}
                  title={`Day ${globalIdx + 1}: ${ENTRY_LABELS[entry]} — click to change`}
                >
                  {ENTRY_ICON[entry]}
                  <span className="text-[9px] font-bold leading-none">{ENTRY_LABELS[entry]}</span>
                  <span className="text-[8px] opacity-60 leading-none">D{globalIdx + 1}</span>
                </button>
              );
            })}
            {/* Pad the last row if it's incomplete */}
            {week.length < 7 && Array.from({ length: 7 - week.length }, (_, i) => (
              <div key={`pad-${i}`} className="flex-1 min-w-[40px] max-w-[64px]" />
            ))}
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-3 text-xs text-theme-text-muted pt-1">
        <span>
          Total: <span className="font-semibold text-theme-text-primary">{cycleDays} days</span>
        </span>
        <span>
          On duty: <span className="font-semibold text-theme-text-primary">{onCount} days</span>
        </span>
        {dayCount > 0 && (
          <span className="flex items-center gap-1">
            <Sun className="w-3 h-3 text-amber-500" />
            Day: <span className="font-semibold text-amber-600 dark:text-amber-400">{dayCount}</span>
          </span>
        )}
        {nightCount > 0 && (
          <span className="flex items-center gap-1">
            <Moon className="w-3 h-3 text-indigo-400" />
            Night: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{nightCount}</span>
          </span>
        )}
        {onDutyCount > 0 && (
          <span>
            General: <span className="font-semibold text-violet-600 dark:text-violet-400">{onDutyCount}</span>
          </span>
        )}
        <span>
          Off: <span className="font-semibold text-theme-text-primary">{offCount}</span>
        </span>
      </div>

      {/* Preview: how the pattern repeats */}
      {onCount > 0 && (
        <div className="pt-2">
          <p className="text-[11px] font-medium text-theme-text-secondary mb-1.5">Pattern Preview (3 cycles)</p>
          <div className="flex gap-px">
            {Array.from({ length: Math.min(cycleDays * 3, 84) }, (_, i) => {
              const entry = cyclePattern[i % cycleDays] ?? 'off';
              const isCycleBoundary = i > 0 && i % cycleDays === 0;
              let bg = 'bg-gray-200 dark:bg-gray-700';
              if (entry === 'on') bg = 'bg-violet-500';
              else if (entry === 'day') bg = 'bg-amber-400 dark:bg-amber-500';
              else if (entry === 'night') bg = 'bg-indigo-500 dark:bg-indigo-400';
              return (
                <div
                  key={i}
                  className={`h-3 flex-1 ${bg} ${i === 0 ? 'rounded-l' : ''} ${i === Math.min(cycleDays * 3, 84) - 1 ? 'rounded-r' : ''} ${isCycleBoundary ? 'ml-1' : ''}`}
                  title={`Day ${(i % cycleDays) + 1} of cycle ${Math.floor(i / cycleDays) + 1}: ${ENTRY_LABELS[entry]}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] text-theme-text-muted mt-0.5">
            <span>Cycle 1</span>
            <span>Cycle 2</span>
            <span>Cycle 3</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomPatternBuilder;
