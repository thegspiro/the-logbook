/**
 * Apparatus Type Defaults Card
 *
 * Configures default crew positions and minimum staffing per vehicle type.
 * Includes inline editing with the shared PositionListEditor.
 */

import React, { useState, useMemo } from 'react';
import { Truck } from 'lucide-react';
import { PositionListEditor } from './PositionListEditor';
import type { ApparatusTypeDefaults, PositionOption, ShiftSettings } from '../types/shiftSettings';
import { DEFAULT_APPARATUS_TYPE_POSITIONS } from '../types/shiftSettings';

interface ApparatusTypeDefaultsCardProps {
  settings: ShiftSettings;
  onSettingsChange: (updater: (prev: ShiftSettings) => ShiftSettings) => void;
  allPositionOptions: PositionOption[];
  apparatusList: Array<{
    id: string;
    name: string;
    unit_number: string;
    apparatus_type: string;
    positions?: string[] | undefined;
  }>;
}

export const ApparatusTypeDefaultsCard: React.FC<ApparatusTypeDefaultsCardProps> = ({
  settings,
  onSettingsChange,
  allPositionOptions,
  apparatusList,
}) => {
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
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-5">
      <h3 className="text-theme-text-primary mb-1 text-base font-semibold">Apparatus Type Defaults</h3>
      <p className="text-theme-text-muted mb-4 text-xs">
        Define default crew positions and minimum staffing per vehicle type. These defaults are used when creating new
        apparatus or generating shift templates.
      </p>
      <div className="space-y-2">
        {knownApparatusTypes.map((type) => {
          const defaults: ApparatusTypeDefaults = settings.apparatusTypeDefaults[type] ??
            DEFAULT_APPARATUS_TYPE_POSITIONS[type] ?? {
              positions: [],
              minStaffing: 1,
            };
          const vehiclesOfType = apparatusList.filter((a) => a.apparatus_type === type);
          const isEditing = editingType === type;

          return (
            <div key={type} className="bg-theme-surface-hover/50 rounded-lg p-3">
              {isEditing ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-theme-text-primary text-sm font-semibold capitalize">{type}</h4>
                    <div className="flex gap-2">
                      <button
                        onClick={cancelEdit}
                        className="text-theme-text-muted hover:text-theme-text-primary text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-theme-text-secondary mb-1 block text-xs font-medium">Min Staffing</label>
                    <input
                      type="number"
                      value={editMinStaffing}
                      min={1}
                      max={20}
                      onChange={(e) => setEditMinStaffing(parseInt(e.target.value, 10) || 1)}
                      className="bg-theme-input-bg border-theme-input-border text-theme-text-primary w-24 rounded-lg border px-2 py-1 text-sm focus:ring-1 focus:ring-violet-500 focus:outline-hidden"
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
                <div className="flex items-start justify-between gap-2 sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 shrink-0 text-red-500" />
                      <h4 className="text-theme-text-primary text-sm font-semibold capitalize">{type}</h4>
                      <span className="text-theme-text-muted bg-theme-surface-hover rounded-sm px-1.5 py-0.5 text-[10px]">
                        min {defaults.minStaffing}
                      </span>
                      {vehiclesOfType.length > 0 && (
                        <span className="text-theme-text-muted text-[10px]">
                          ({vehiclesOfType.length} unit
                          {vehiclesOfType.length !== 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                    {defaults.positions.length > 0 && (
                      <div className="mt-1.5 ml-6 flex flex-wrap gap-1">
                        {defaults.positions.map((pos, i) => {
                          const label = allPositionOptions.find((o) => o.value === pos)?.label || pos;
                          return (
                            <span
                              key={i}
                              className="rounded-sm bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-700 capitalize dark:text-red-400"
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
                    className="shrink-0 text-xs text-violet-600 hover:underline dark:text-violet-400"
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
