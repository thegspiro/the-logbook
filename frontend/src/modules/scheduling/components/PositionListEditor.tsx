/**
 * Position List Editor
 *
 * Reusable inline editor for an ordered list of positions (seats).
 * Used by ApparatusTypeDefaultsCard and ResourceTypeDefaultsCard.
 */

import React from "react";
import { Plus, X } from "lucide-react";
import type { PositionOption } from "../types/shiftSettings";

interface PositionListEditorProps {
  /** Current ordered list of position values. */
  positions: string[];
  /** Called when the list changes (add, remove, reorder). */
  onChange: (positions: string[]) => void;
  /** Available position options for the dropdown. */
  availablePositions: PositionOption[];
  /** Label shown above the list (e.g. "Default Positions (in seat order)"). */
  label: string;
  /** Value used when adding a new position. Defaults to the first available option. */
  defaultNewPosition?: string;
  /** Label for the add button. Defaults to "Add position". */
  addButtonLabel?: string;
}

export const PositionListEditor: React.FC<PositionListEditorProps> = ({
  positions,
  onChange,
  availablePositions,
  label,
  defaultNewPosition,
  addButtonLabel = "Add position",
}) => {
  const handleChange = (index: number, value: string) => {
    const updated = [...positions];
    updated[index] = value;
    onChange(updated);
  };

  const handleRemove = (index: number) => {
    onChange(positions.filter((_, idx) => idx !== index));
  };

  const handleAdd = () => {
    const fallback = availablePositions[0]?.value ?? "firefighter";
    onChange([...positions, defaultNewPosition ?? fallback]);
  };

  return (
    <div>
      <label className="block text-xs font-medium text-theme-text-secondary mb-1">
        {label}
      </label>
      <div className="space-y-1.5">
        {positions.map((pos, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-theme-text-muted w-5 text-right">
              {i + 1}.
            </span>
            <select
              value={pos}
              onChange={(e) => handleChange(i, e.target.value)}
              className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              {availablePositions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleRemove(i)}
              className="p-1 text-red-500 hover:bg-red-500/10 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={handleAdd}
        className="mt-1.5 text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
      >
        <Plus className="w-3 h-3" /> {addButtonLabel}
      </button>
    </div>
  );
};

export default PositionListEditor;
