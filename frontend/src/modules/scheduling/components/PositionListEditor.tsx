/**
 * Position List Editor
 *
 * Reusable inline editor for an ordered list of positions (seats).
 * Each position is a separate slot with a name and required toggle.
 * Used by ApparatusTypeDefaultsCard, ResourceTypeDefaultsCard,
 * and ShiftTemplatesPage.
 */

import React from "react";
import { Plus, X } from "lucide-react";
import type { PositionOption } from "../types/shiftSettings";
import type { PositionSlot } from "../services/api";

// ---------- Legacy flat-string API ----------

interface LegacyPositionListEditorProps {
  /** Current ordered list of position values (legacy flat strings). */
  positions: string[];
  /** Called when the list changes (add, remove, reorder). */
  onChange: (positions: string[]) => void;
  /** Available position options for the dropdown. */
  availablePositions: PositionOption[];
  /** Label shown above the list. */
  label: string;
  /** Value used when adding a new position. */
  defaultNewPosition?: string;
  /** Label for the add button. */
  addButtonLabel?: string;
  /** When true, shows structured mode with required toggles. */
  structured?: false;
  onChangeStructured?: never;
}

// ---------- Structured PositionSlot API ----------

interface StructuredPositionListEditorProps {
  /** Current ordered list of position slots. */
  positions: PositionSlot[];
  /** Called when the structured list changes. */
  onChangeStructured: (positions: PositionSlot[]) => void;
  /** Available position options for the dropdown. */
  availablePositions: PositionOption[];
  /** Label shown above the list. */
  label: string;
  /** Value used when adding a new position. */
  defaultNewPosition?: string;
  /** Label for the add button. */
  addButtonLabel?: string;
  /** Must be true to enable structured mode. */
  structured: true;
  onChange?: never;
}

type PositionListEditorProps =
  | LegacyPositionListEditorProps
  | StructuredPositionListEditorProps;

export const PositionListEditor: React.FC<PositionListEditorProps> = (
  props,
) => {
  const {
    availablePositions,
    label,
    defaultNewPosition,
    addButtonLabel = "Add position",
  } = props;

  // ---- Structured mode ----
  if (props.structured) {
    const { positions, onChangeStructured } = props;

    const handleChangeName = (index: number, value: string) => {
      const updated = [...positions];
      const existing = updated[index];
      if (existing) {
        updated[index] = { ...existing, position: value };
        onChangeStructured(updated);
      }
    };

    const handleToggleRequired = (index: number) => {
      const updated = [...positions];
      const existing = updated[index];
      if (existing) {
        updated[index] = { ...existing, required: !existing.required };
        onChangeStructured(updated);
      }
    };

    const handleRemove = (index: number) => {
      onChangeStructured(positions.filter((_, idx) => idx !== index));
    };

    const handleAdd = () => {
      const fallback = availablePositions[0]?.value ?? "firefighter";
      onChangeStructured([
        ...positions,
        { position: defaultNewPosition ?? fallback, required: true },
      ]);
    };

    return (
      <div>
        <label className="block text-xs font-medium text-theme-text-secondary mb-1">
          {label}
        </label>
        <div className="space-y-1.5">
          {positions.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-theme-text-muted w-5 text-right">
                {i + 1}.
              </span>
              <select
                value={slot.position}
                onChange={(e) => handleChangeName(i, e.target.value)}
                className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
              >
                {availablePositions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-theme-text-secondary cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={slot.required}
                  onChange={() => handleToggleRequired(i)}
                  className="rounded border-theme-input-border text-violet-600 focus:ring-violet-500"
                />
                Req
              </label>
              <button
                onClick={() => handleRemove(i)}
                className="p-1 text-red-500 hover:bg-red-500/10 rounded-sm"
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
  }

  // ---- Legacy flat-string mode ----
  const { positions, onChange } = props;

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
              className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
            >
              {availablePositions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleRemove(i)}
              className="p-1 text-red-500 hover:bg-red-500/10 rounded-sm"
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
