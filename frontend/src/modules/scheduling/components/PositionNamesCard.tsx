/**
 * Position Names Card
 *
 * Manages built-in position toggles and custom position creation/removal.
 */

import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { PositionOption, ShiftSettings } from '../types/shiftSettings';
import { BUILTIN_POSITIONS } from '../types/shiftSettings';

interface PositionNamesCardProps {
  settings: ShiftSettings;
  onSettingsChange: (updater: (prev: ShiftSettings) => ShiftSettings) => void;
  allPositionOptions: PositionOption[];
}

export const PositionNamesCard: React.FC<PositionNamesCardProps> = ({
  settings,
  onSettingsChange,
  allPositionOptions,
}) => {
  const [newPositionValue, setNewPositionValue] = useState('');
  const [newPositionLabel, setNewPositionLabel] = useState('');

  const togglePosition = (pos: string) => {
    onSettingsChange((prev) => ({
      ...prev,
      enabledPositions: prev.enabledPositions.includes(pos)
        ? prev.enabledPositions.filter((p) => p !== pos)
        : [...prev.enabledPositions, pos],
    }));
  };

  const addCustomPosition = () => {
    const val = newPositionValue.trim().toLowerCase().replace(/\s+/g, '_');
    const lbl = newPositionLabel.trim();
    if (!val || !lbl) return;
    if (allPositionOptions.some((p) => p.value === val)) return;
    onSettingsChange((prev) => ({
      ...prev,
      customPositions: [...prev.customPositions, { value: val, label: lbl }],
      enabledPositions: [...prev.enabledPositions, val],
    }));
    setNewPositionValue('');
    setNewPositionLabel('');
  };

  const removeCustomPosition = (val: string) => {
    onSettingsChange((prev) => ({
      ...prev,
      customPositions: prev.customPositions.filter((p) => p.value !== val),
      enabledPositions: prev.enabledPositions.filter((p) => p !== val),
    }));
  };

  return (
    <div className="card-secondary p-5">
      <h3 className="text-theme-text-primary mb-1 text-base font-semibold">Position Names</h3>
      <p className="text-theme-text-muted mb-4 text-xs">
        Enable built-in position types or add custom ones unique to your department. Custom positions appear everywhere
        built-in ones do.
      </p>

      {/* Built-in positions toggle */}
      <div className="mb-4">
        <p className="text-theme-text-secondary mb-2 text-xs font-medium">Built-in Positions</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {BUILTIN_POSITIONS.map((pos) => (
            <label
              key={pos.value}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 transition-colors ${
                settings.enabledPositions.includes(pos.value)
                  ? 'border-violet-500/30 bg-violet-500/5'
                  : 'border-theme-surface-border bg-theme-surface-hover/30'
              }`}
            >
              <input
                type="checkbox"
                checked={settings.enabledPositions.includes(pos.value)}
                onChange={() => togglePosition(pos.value)}
                className="border-theme-input-border rounded-sm"
              />
              <span className="text-theme-text-primary text-sm">{pos.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom positions */}
      {settings.customPositions.length > 0 && (
        <div className="mb-4">
          <p className="text-theme-text-secondary mb-2 text-xs font-medium">Custom Positions</p>
          <div className="space-y-1.5">
            {settings.customPositions.map((cp) => (
              <div
                key={cp.value}
                className="bg-theme-surface-hover/50 border-theme-surface-border flex items-center justify-between rounded-lg border p-2.5"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.enabledPositions.includes(cp.value)}
                    onChange={() => togglePosition(cp.value)}
                    className="border-theme-input-border rounded-sm"
                  />
                  <span className="text-theme-text-primary text-sm">{cp.label}</span>
                  <span className="text-theme-text-muted bg-theme-surface-hover rounded-sm px-1.5 py-0.5 text-[10px]">
                    {cp.value}
                  </span>
                </div>
                <button
                  onClick={() => removeCustomPosition(cp.value)}
                  className="rounded-sm p-1 text-red-500 hover:bg-red-500/10"
                  title="Remove custom position"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add custom position */}
      <div className="bg-theme-surface-hover/30 border-theme-surface-border rounded-lg border border-dashed p-3">
        <p className="text-theme-text-secondary mb-2 text-xs font-medium">Add Custom Position</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={newPositionLabel}
            onChange={(e) => {
              setNewPositionLabel(e.target.value);
              setNewPositionValue(e.target.value.trim().toLowerCase().replace(/\s+/g, '_'));
            }}
            placeholder="Display name (e.g., Tillerman)"
            className="bg-theme-input-bg border-theme-input-border text-theme-text-primary placeholder-theme-text-muted flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:ring-violet-500 focus:outline-hidden"
          />
          <button
            onClick={addCustomPosition}
            disabled={!newPositionLabel.trim() || allPositionOptions.some((p) => p.value === newPositionValue)}
            className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Position
          </button>
        </div>
        {newPositionLabel.trim() && (
          <p className="text-theme-text-muted mt-1 text-[10px]">
            Internal key: <code className="bg-theme-surface-hover rounded-sm px-1 py-0.5">{newPositionValue}</code>
            {allPositionOptions.some((p) => p.value === newPositionValue) && (
              <span className="ml-1 text-red-500">— already exists</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
};

export default PositionNamesCard;
