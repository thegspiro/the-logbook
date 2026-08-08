/**
 * Resource Type Defaults Card
 *
 * Configures default staffing for non-vehicle resources used during events
 * (first aid stations, bicycle teams, etc.). Uses the shared PositionListEditor.
 */

import React, { useState } from 'react';
import { PositionListEditor } from './PositionListEditor';
import type { PositionOption, ResourceTypeDefaults, ShiftSettings } from '../types/shiftSettings';

interface ResourceTypeDefaultsCardProps {
  settings: ShiftSettings;
  onSettingsChange: (updater: (prev: ShiftSettings) => ShiftSettings) => void;
  allPositionOptions: PositionOption[];
}

export const ResourceTypeDefaultsCard: React.FC<ResourceTypeDefaultsCardProps> = ({
  settings,
  onSettingsChange,
  allPositionOptions,
}) => {
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
    <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-5">
      <h3 className="text-theme-text-primary mb-1 text-base font-semibold">Event Resource Defaults</h3>
      <p className="text-theme-text-muted mb-4 text-xs">
        Define default staffing for non-vehicle resources used during events (first aid stations, bicycle teams, etc.).
        These defaults are used when adding resources to event templates.
      </p>
      <div className="space-y-2">
        {Object.entries(settings.resourceTypeDefaults).map(([type, defaults]: [string, ResourceTypeDefaults]) => {
          const isEditing = editingType === type;
          return (
            <div key={type} className="bg-theme-surface-hover/50 rounded-lg p-3">
              {isEditing ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-theme-text-primary text-sm font-semibold">{defaults.label}</h4>
                    <div className="flex gap-2">
                      <button
                        onClick={cancelEdit}
                        className="text-theme-text-muted hover:text-theme-text-primary text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(type)}
                        className="text-xs font-medium text-violet-600 hover:underline dark:text-violet-400"
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
                <div className="flex items-start justify-between gap-2 sm:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-theme-text-primary text-sm font-semibold">{defaults.label}</h4>
                      <span className="text-theme-text-muted bg-theme-surface-hover rounded-sm px-1.5 py-0.5 text-[10px]">
                        {defaults.positions.length} positions
                      </span>
                    </div>
                    {defaults.positions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {defaults.positions.map((pos, i) => {
                          const label = allPositionOptions.find((o) => o.value === pos)?.label || pos;
                          return (
                            <span
                              key={i}
                              className="rounded-sm bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-700 capitalize dark:text-purple-400"
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

export default ResourceTypeDefaultsCard;
