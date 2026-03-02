/**
 * Apparatus Type Defaults Card
 *
 * Configures default crew positions and minimum staffing per vehicle type.
 * Includes inline editing with the shared PositionListEditor.
 */

import React, { useState, useMemo } from "react";
import { Truck } from "lucide-react";
import { PositionListEditor } from "./PositionListEditor";
import type {
  ApparatusTypeDefaults,
  PositionOption,
  ShiftSettings,
} from "../types/shiftSettings";
import { DEFAULT_APPARATUS_TYPE_POSITIONS } from "../types/shiftSettings";

interface ApparatusTypeDefaultsCardProps {
  settings: ShiftSettings;
  onSettingsChange: (updater: (prev: ShiftSettings) => ShiftSettings) => void;
  allPositionOptions: PositionOption[];
  apparatusList: Array<{
    id: string;
    name: string;
    unit_number: string;
    apparatus_type: string;
    positions?: string[];
  }>;
}

export const ApparatusTypeDefaultsCard: React.FC<
  ApparatusTypeDefaultsCardProps
> = ({ settings, onSettingsChange, allPositionOptions, apparatusList }) => {
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editPositions, setEditPositions] = useState<string[]>([]);
  const [editMinStaffing, setEditMinStaffing] = useState(1);

  // Collect all known apparatus types from both the defaults and current apparatus
  const knownApparatusTypes = useMemo(() => {
    const types = new Set(Object.keys(settings.apparatusTypeDefaults));
    Object.keys(DEFAULT_APPARATUS_TYPE_POSITIONS).forEach((t) => types.add(t));
    apparatusList.forEach((a) => types.add(a.apparatus_type));
    return Array.from(types).sort();
  }, [settings.apparatusTypeDefaults, apparatusList]);

  const startEdit = (type: string) => {
    const defaults = settings.apparatusTypeDefaults[type] ??
      DEFAULT_APPARATUS_TYPE_POSITIONS[type] ?? {
        positions: [],
        minStaffing: 1,
      };
    setEditingType(type);
    setEditPositions([...defaults.positions]);
    setEditMinStaffing(defaults.minStaffing);
  };

  const saveEdit = () => {
    if (!editingType) return;
    onSettingsChange((prev) => ({
      ...prev,
      apparatusTypeDefaults: {
        ...prev.apparatusTypeDefaults,
        [editingType]: {
          positions: editPositions,
          minStaffing: editMinStaffing,
        },
      },
    }));
    setEditingType(null);
  };

  const cancelEdit = () => {
    setEditingType(null);
  };

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-theme-text-primary mb-1">
        Apparatus Type Defaults
      </h3>
      <p className="text-xs text-theme-text-muted mb-4">
        Define default crew positions and minimum staffing per vehicle type.
        These defaults are used when creating new apparatus or generating
        shift templates.
      </p>
      <div className="space-y-2">
        {knownApparatusTypes.map((type) => {
          const defaults: ApparatusTypeDefaults = settings
            .apparatusTypeDefaults[type] ??
            DEFAULT_APPARATUS_TYPE_POSITIONS[type] ?? {
              positions: [],
              minStaffing: 1,
            };
          const vehiclesOfType = apparatusList.filter(
            (a) => a.apparatus_type === type,
          );
          const isEditing = editingType === type;

          return (
            <div
              key={type}
              className="p-3 bg-theme-surface-hover/50 rounded-lg"
            >
              {isEditing ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-theme-text-primary capitalize">
                      {type}
                    </h4>
                    <div className="flex gap-2">
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        className="text-xs text-violet-600 dark:text-violet-400 font-medium hover:underline"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-theme-text-secondary mb-1">
                      Min Staffing
                    </label>
                    <input
                      type="number"
                      value={editMinStaffing}
                      min={1}
                      max={20}
                      onChange={(e) =>
                        setEditMinStaffing(parseInt(e.target.value, 10) || 1)
                      }
                      className="w-24 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                  <PositionListEditor
                    positions={editPositions}
                    onChange={setEditPositions}
                    availablePositions={allPositionOptions}
                    label="Default Positions (in seat order)"
                    defaultNewPosition="firefighter"
                    addButtonLabel="Add seat"
                  />
                </div>
              ) : (
                <div className="flex items-start sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-red-500 shrink-0" />
                      <h4 className="text-sm font-semibold text-theme-text-primary capitalize">
                        {type}
                      </h4>
                      <span className="text-[10px] text-theme-text-muted bg-theme-surface-hover px-1.5 py-0.5 rounded-sm">
                        min {defaults.minStaffing}
                      </span>
                      {vehiclesOfType.length > 0 && (
                        <span className="text-[10px] text-theme-text-muted">
                          ({vehiclesOfType.length} unit
                          {vehiclesOfType.length !== 1 ? "s" : ""})
                        </span>
                      )}
                    </div>
                    {defaults.positions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5 ml-6">
                        {defaults.positions.map((pos, i) => {
                          const label =
                            allPositionOptions.find((o) => o.value === pos)
                              ?.label || pos;
                          return (
                            <span
                              key={i}
                              className="px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-700 dark:text-red-400 rounded-sm capitalize"
                            >
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => startEdit(type)}
                    className="text-xs text-violet-600 dark:text-violet-400 hover:underline shrink-0"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ApparatusTypeDefaultsCard;
