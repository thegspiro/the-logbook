/**
 * Position Names Card
 *
 * Manages built-in position toggles and custom position creation/removal.
 */

import React, { useState } from "react";
import { X } from "lucide-react";
import type { PositionOption, ShiftSettings } from "../types/shiftSettings";
import { BUILTIN_POSITIONS } from "../types/shiftSettings";

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
  const [newPositionValue, setNewPositionValue] = useState("");
  const [newPositionLabel, setNewPositionLabel] = useState("");

  const togglePosition = (pos: string) => {
    onSettingsChange((prev) => ({
      ...prev,
      enabledPositions: prev.enabledPositions.includes(pos)
        ? prev.enabledPositions.filter((p) => p !== pos)
        : [...prev.enabledPositions, pos],
    }));
  };

  const addCustomPosition = () => {
    const val = newPositionValue.trim().toLowerCase().replace(/\s+/g, "_");
    const lbl = newPositionLabel.trim();
    if (!val || !lbl) return;
    if (allPositionOptions.some((p) => p.value === val)) return;
    onSettingsChange((prev) => ({
      ...prev,
      customPositions: [...prev.customPositions, { value: val, label: lbl }],
      enabledPositions: [...prev.enabledPositions, val],
    }));
    setNewPositionValue("");
    setNewPositionLabel("");
  };

  const removeCustomPosition = (val: string) => {
    onSettingsChange((prev) => ({
      ...prev,
      customPositions: prev.customPositions.filter((p) => p.value !== val),
      enabledPositions: prev.enabledPositions.filter((p) => p !== val),
    }));
  };

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-theme-text-primary mb-1">
        Position Names
      </h3>
      <p className="text-xs text-theme-text-muted mb-4">
        Enable built-in position types or add custom ones unique to your
        department. Custom positions appear everywhere built-in ones do.
      </p>

      {/* Built-in positions toggle */}
      <div className="mb-4">
        <p className="text-xs font-medium text-theme-text-secondary mb-2">
          Built-in Positions
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {BUILTIN_POSITIONS.map((pos) => (
            <label
              key={pos.value}
              className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                settings.enabledPositions.includes(pos.value)
                  ? "border-violet-500/30 bg-violet-500/5"
                  : "border-theme-surface-border bg-theme-surface-hover/30"
              }`}
            >
              <input
                type="checkbox"
                checked={settings.enabledPositions.includes(pos.value)}
                onChange={() => togglePosition(pos.value)}
                className="rounded-sm border-theme-input-border"
              />
              <span className="text-sm text-theme-text-primary">
                {pos.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Custom positions */}
      {settings.customPositions.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-theme-text-secondary mb-2">
            Custom Positions
          </p>
          <div className="space-y-1.5">
            {settings.customPositions.map((cp) => (
              <div
                key={cp.value}
                className="flex items-center justify-between p-2.5 bg-theme-surface-hover/50 rounded-lg border border-theme-surface-border"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.enabledPositions.includes(cp.value)}
                    onChange={() => togglePosition(cp.value)}
                    className="rounded-sm border-theme-input-border"
                  />
                  <span className="text-sm text-theme-text-primary">
                    {cp.label}
                  </span>
                  <span className="text-[10px] text-theme-text-muted bg-theme-surface-hover px-1.5 py-0.5 rounded-sm">
                    {cp.value}
                  </span>
                </div>
                <button
                  onClick={() => removeCustomPosition(cp.value)}
                  className="p-1 text-red-500 hover:bg-red-500/10 rounded-sm"
                  title="Remove custom position"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add custom position */}
      <div className="p-3 bg-theme-surface-hover/30 rounded-lg border border-dashed border-theme-surface-border">
        <p className="text-xs font-medium text-theme-text-secondary mb-2">
          Add Custom Position
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={newPositionLabel}
            onChange={(e) => {
              setNewPositionLabel(e.target.value);
              setNewPositionValue(
                e.target.value.trim().toLowerCase().replace(/\s+/g, "_"),
              );
            }}
            placeholder="Display name (e.g., Tillerman)"
            className="flex-1 px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500 placeholder-theme-text-muted"
          />
          <button
            onClick={addCustomPosition}
            disabled={
              !newPositionLabel.trim() ||
              allPositionOptions.some((p) => p.value === newPositionValue)
            }
            className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            Add Position
          </button>
        </div>
        {newPositionLabel.trim() && (
          <p className="text-[10px] text-theme-text-muted mt-1">
            Internal key:{" "}
            <code className="bg-theme-surface-hover px-1 py-0.5 rounded-sm">
              {newPositionValue}
            </code>
            {allPositionOptions.some((p) => p.value === newPositionValue) && (
              <span className="text-red-500 ml-1">— already exists</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
};

export default PositionNamesCard;
