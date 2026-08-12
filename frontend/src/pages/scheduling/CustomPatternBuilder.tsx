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
  off: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
  day: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-400 dark:border-amber-600',
  night:
    'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-400 dark:border-indigo-500',
  on: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-400 dark:border-violet-500',
};

const ENTRY_ICON: Record<CycleEntry, React.ReactNode> = {
  off: null,
  day: <Sun className="h-3.5 w-3.5" />,
  night: <Moon className="h-3.5 w-3.5" />,
  on: <Sun className="h-3.5 w-3.5" />,
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
  const onCount = cyclePattern.filter((e) => e !== 'off').length;
  const dayCount = cyclePattern.filter((e) => e === 'day').length;
  const nightCount = cyclePattern.filter((e) => e === 'night').length;
  const onDutyCount = cyclePattern.filter((e) => e === 'on').length;
  const offCount = cyclePattern.filter((e) => e === 'off').length;

  // Split cycle into weeks for display
  const weeks: CycleEntry[][] = [];
  for (let i = 0; i < cyclePattern.length; i += 7) {
    weeks.push(cyclePattern.slice(i, i + 7));
  }

  return (
    <div className="space-y-4">
      {/* Cycle length controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <label className="text-theme-text-secondary text-xs font-medium whitespace-nowrap">Cycle Length:</label>
          <button
            onClick={() => adjustLength(cycleDays - 1)}
            className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary rounded-sm border p-1 transition-colors hover:border-violet-500"
            aria-label="Decrease cycle length"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="text-theme-text-primary w-16 text-center text-sm font-semibold">{cycleDays} days</span>
          <button
            onClick={() => adjustLength(cycleDays + 1)}
            className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary rounded-sm border p-1 transition-colors hover:border-violet-500"
            aria-label="Increase cycle length"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => adjustLength(p.value)}
              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                cycleDays === p.value
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : 'border-theme-surface-border text-theme-text-muted hover:border-violet-500'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick fill buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-theme-text-muted text-xs">Quick fill:</span>
        <button
          onClick={() => fillRange('day')}
          className="rounded-sm border border-amber-400/50 px-2 py-1 text-[11px] text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
        >
          All Day
        </button>
        <button
          onClick={() => fillRange('night')}
          className="rounded-sm border border-indigo-400/50 px-2 py-1 text-[11px] text-indigo-600 transition-colors hover:bg-indigo-500/10 dark:text-indigo-400"
        >
          All Night
        </button>
        <button
          onClick={() => fillRange('on')}
          className="rounded-sm border border-violet-400/50 px-2 py-1 text-[11px] text-violet-600 transition-colors hover:bg-violet-500/10 dark:text-violet-400"
        >
          All On
        </button>
        <button
          onClick={resetAll}
          className="border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> Clear
        </button>
      </div>

      {/* Cycle grid */}
      <div className="space-y-2">
        <p className="text-theme-text-muted text-xs">Click each day to cycle through: Off → Day → Night → On → Off</p>
        {weeks.map((week, weekIdx) => (
          <div key={weekIdx} className="flex gap-1.5">
            <span className="text-theme-text-muted flex w-6 items-center justify-end pr-1 text-[10px]">
              {weekIdx > 0 || weeks.length > 1 ? `W${weekIdx + 1}` : ''}
            </span>
            {week.map((entry, dayIdx) => {
              const globalIdx = weekIdx * 7 + dayIdx;
              return (
                <button
                  key={globalIdx}
                  onClick={() => toggleCell(globalIdx)}
                  className={`flex h-12 max-w-[64px] min-w-[40px] flex-1 flex-col items-center justify-center gap-0.5 rounded-lg border-2 transition-all hover:scale-105 ${ENTRY_STYLES[entry]}`}
                  title={`Day ${globalIdx + 1}: ${ENTRY_LABELS[entry]} — click to change`}
                >
                  {ENTRY_ICON[entry]}
                  <span className="text-[9px] leading-none font-bold">{ENTRY_LABELS[entry]}</span>
                  <span className="text-[8px] leading-none opacity-60">D{globalIdx + 1}</span>
                </button>
              );
            })}
            {/* Pad the last row if it's incomplete */}
            {week.length < 7 &&
              Array.from({ length: 7 - week.length }, (_, i) => (
                <div key={`pad-${i}`} className="max-w-[64px] min-w-[40px] flex-1" />
              ))}
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="text-theme-text-muted flex flex-wrap gap-3 pt-1 text-xs">
        <span>
          Total: <span className="text-theme-text-primary font-semibold">{cycleDays} days</span>
        </span>
        <span>
          On duty: <span className="text-theme-text-primary font-semibold">{onCount} days</span>
        </span>
        {dayCount > 0 && (
          <span className="flex items-center gap-1">
            <Sun className="h-3 w-3 text-amber-500" />
            Day: <span className="font-semibold text-amber-600 dark:text-amber-400">{dayCount}</span>
          </span>
        )}
        {nightCount > 0 && (
          <span className="flex items-center gap-1">
            <Moon className="h-3 w-3 text-indigo-700 dark:text-indigo-400" />
            Night: <span className="font-semibold text-indigo-600 dark:text-indigo-400">{nightCount}</span>
          </span>
        )}
        {onDutyCount > 0 && (
          <span>
            General: <span className="font-semibold text-violet-600 dark:text-violet-400">{onDutyCount}</span>
          </span>
        )}
        <span>
          Off: <span className="text-theme-text-primary font-semibold">{offCount}</span>
        </span>
      </div>

      {/* Preview: how the pattern repeats */}
      {onCount > 0 && (
        <div className="pt-2">
          <p className="text-theme-text-secondary mb-1.5 text-[11px] font-medium">Pattern Preview (3 cycles)</p>
          <div className="flex gap-px">
            {Array.from({ length: Math.min(cycleDays * 3, 84) }, (_, i) => {
              const entry = cyclePattern[i % cycleDays] ?? 'off';
              const isCycleBoundary = i > 0 && i % cycleDays === 0;
              let bg = 'bg-theme-surface-hover';
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
          <div className="text-theme-text-muted mt-0.5 flex justify-between text-[9px]">
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
