/**
 * Resource Type Defaults Card
 *
 * Configures default staffing for non-vehicle resources used during events
 * (first aid stations, bicycle teams, etc.). Uses the shared PositionListEditor.
 */

import React, { useState } from "react";
import { PositionListEditor } from "./PositionListEditor";
import type { PositionOption, ShiftSettings } from "../types/shiftSettings";

interface ResourceTypeDefaultsCardProps {
  settings: ShiftSettings;
  onSettingsChange: (updater: (prev: ShiftSettings) => ShiftSettings) => void;
  allPositionOptions: PositionOption[];
}

export const ResourceTypeDefaultsCard: React.FC<
  ResourceTypeDefaultsCardProps
> = ({ settings, onSettingsChange, allPositionOptions }) => {
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editPositions, setEditPositions] = useState<string[]>([]);

  const startEdit = (type: string) => {
    const defaults = settings.resourceTypeDefaults[type];
    if (!defaults) return;
    setEditingType(type);
    setEditPositions([...defaults.positions]);
  };

  const saveEdit = (type: string) => {
    onSettingsChange((prev) => {
      const existing = prev.resourceTypeDefaults[type];
      if (!existing) return prev;
      return {
        ...prev,
        resourceTypeDefaults: {
          ...prev.resourceTypeDefaults,
          [type]: {
            ...existing,
            positions: editPositions,
          },
        },
      };
    });
    setEditingType(null);
  };

  const cancelEdit = () => {
    setEditingType(null);
  };

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
      <h3 className="text-base font-semibold text-theme-text-primary mb-1">
        Event Resource Defaults
      </h3>
      <p className="text-xs text-theme-text-muted mb-4">
        Define default staffing for non-vehicle resources used during events
        (first aid stations, bicycle teams, etc.). These defaults are used
        when adding resources to event templates.
      </p>
      <div className="space-y-2">
        {Object.entries(settings.resourceTypeDefaults).map(
          ([type, defaults]: [string, ResourceTypeDefaults]) => {
            const isEditing = editingType === type;
            return (
              <div
                key={type}
                className="p-3 bg-theme-surface-hover/50 rounded-lg"
              >
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-theme-text-primary">
                        {defaults.label}
                      </h4>
                      <div className="flex gap-2">
                        <button
                          onClick={cancelEdit}
                          className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(type)}
                          className="text-xs text-violet-600 dark:text-violet-400 font-medium hover:underline"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                    <PositionListEditor
                      positions={editPositions}
                      onChange={setEditPositions}
                      availablePositions={allPositionOptions}
                      label="Default Positions"
                      defaultNewPosition="ems"
                      addButtonLabel="Add position"
                    />
                  </div>
                ) : (
                  <div className="flex items-start sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-theme-text-primary">
                          {defaults.label}
                        </h4>
                        <span className="text-[10px] text-theme-text-muted bg-theme-surface-hover px-1.5 py-0.5 rounded">
                          {defaults.positions.length} positions
                        </span>
                      </div>
                      {defaults.positions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {defaults.positions.map((pos, i) => {
                            const label =
                              allPositionOptions.find((o) => o.value === pos)
                                ?.label || pos;
                            return (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 text-[10px] bg-purple-500/10 text-purple-700 dark:text-purple-400 rounded capitalize"
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
                      className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex-shrink-0"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            );
          },
        )}
      </div>
    </div>
  );
};

export default ResourceTypeDefaultsCard;
