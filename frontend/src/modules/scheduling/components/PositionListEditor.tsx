/**
 * Position List Editor
 *
 * Reusable inline editor for an ordered list of positions (seats).
 * Each position is a separate slot with a name and required toggle.
 * Used by ApparatusTypeDefaultsCard, ResourceTypeDefaultsCard,
 * and ShiftTemplatesPage.
 */

import React from 'react';
import { Plus, X } from 'lucide-react';
import type { PositionOption } from '../types/shiftSettings';
import type { PositionSlot } from '../services/api';

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

type PositionListEditorProps = LegacyPositionListEditorProps | StructuredPositionListEditorProps;

export const PositionListEditor: React.FC<PositionListEditorProps> = (props) => {
  const { availablePositions, label, defaultNewPosition, addButtonLabel = 'Add position' } = props;

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
      const fallback = availablePositions[0]?.value ?? 'firefighter';
      onChangeStructured([...positions, { position: defaultNewPosition ?? fallback, required: true }]);
    };

    return (
      <div>
        <label className="text-theme-text-secondary mb-1 block text-xs font-medium">{label}</label>
        <div className="space-y-1.5">
          {positions.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-theme-text-muted w-5 text-right text-xs">{i + 1}.</span>
              <select
                value={slot.position}
                onChange={(e) => handleChangeName(i, e.target.value)}
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary flex-1 rounded-lg border px-2 py-1 text-sm focus:ring-1 focus:ring-violet-500 focus:outline-hidden"
              >
                {availablePositions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <label className="text-theme-text-secondary flex cursor-pointer items-center gap-1 text-xs whitespace-nowrap select-none">
                <input
                  type="checkbox"
                  checked={slot.required}
                  onChange={() => handleToggleRequired(i)}
                  className="border-theme-input-border rounded text-violet-600 focus:ring-violet-500"
                />
                Req
              </label>
              <button onClick={() => handleRemove(i)} className="rounded-sm p-1 text-red-500 hover:bg-red-500/10">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={handleAdd}
          className="mt-1.5 flex items-center gap-1 text-xs text-violet-600 hover:underline dark:text-violet-400"
        >
          <Plus className="h-3 w-3" /> {addButtonLabel}
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
    const fallback = availablePositions[0]?.value ?? 'firefighter';
    onChange([...positions, defaultNewPosition ?? fallback]);
  };

  return (
    <div>
      <label className="text-theme-text-secondary mb-1 block text-xs font-medium">{label}</label>
      <div className="space-y-1.5">
        {positions.map((pos, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-theme-text-muted w-5 text-right text-xs">{i + 1}.</span>
            <select
              value={pos}
              onChange={(e) => handleChange(i, e.target.value)}
              className="bg-theme-input-bg border-theme-input-border text-theme-text-primary flex-1 rounded-lg border px-2 py-1 text-sm focus:ring-1 focus:ring-violet-500 focus:outline-hidden"
            >
              {availablePositions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button onClick={() => handleRemove(i)} className="rounded-sm p-1 text-red-500 hover:bg-red-500/10">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={handleAdd}
        className="mt-1.5 flex items-center gap-1 text-xs text-violet-600 hover:underline dark:text-violet-400"
      >
        <Plus className="h-3 w-3" /> {addButtonLabel}
      </button>
    </div>
  );
};

export default PositionListEditor;
