/**
 * Shift Settings Panel
 *
 * Department-wide scheduling settings: default durations, min staffing,
 * overtime thresholds, custom positions, apparatus type defaults, and
 * notification rules.
 *
 * Extracted from the SchedulingPage monolith for maintainability.
 */

import React, { useState, useMemo } from "react";
import {
  Settings,
  Truck,
  Plus,
  X,
  AlertCircle,
} from "lucide-react";
import type { ShiftTemplateRecord } from "../services/api";
import { SchedulingNotificationsPanel } from "./SchedulingNotificationsPanel";

// ─── Built-in position options ───────────────────────────────────────────────

const BUILTIN_POSITIONS = [
  { value: "officer", label: "Officer" },
  { value: "driver", label: "Driver/Operator" },
  { value: "firefighter", label: "Firefighter" },
  { value: "ems", label: "EMT" },
  { value: "probationary", label: "Probationary" },
  { value: "volunteer", label: "Volunteer" },
];

// ─── Default positions per apparatus type ────────────────────────────────────

const DEFAULT_APPARATUS_TYPE_POSITIONS: Record<
  string,
  { positions: string[]; minStaffing: number }
> = {
  engine: {
    positions: ["officer", "driver", "firefighter", "firefighter"],
    minStaffing: 4,
  },
  ladder: {
    positions: ["officer", "driver", "firefighter", "firefighter"],
    minStaffing: 4,
  },
  ambulance: { positions: ["driver", "ems", "ems"], minStaffing: 2 },
  rescue: {
    positions: ["officer", "driver", "firefighter", "firefighter"],
    minStaffing: 4,
  },
  tanker: { positions: ["driver", "firefighter"], minStaffing: 2 },
  brush: { positions: ["driver", "firefighter"], minStaffing: 2 },
  tower: {
    positions: ["officer", "driver", "firefighter", "firefighter"],
    minStaffing: 4,
  },
  hazmat: {
    positions: ["officer", "driver", "firefighter", "firefighter"],
    minStaffing: 4,
  },
  boat: { positions: ["officer", "driver"], minStaffing: 2 },
  chief: { positions: ["officer"], minStaffing: 1 },
  utility: { positions: ["driver"], minStaffing: 1 },
};

// ─── Default positions per event resource type ───────────────────────────────

const DEFAULT_RESOURCE_TYPE_POSITIONS: Record<
  string,
  { positions: string[]; label: string }
> = {
  first_aid_station: { positions: ["ems", "ems"], label: "First Aid Station" },
  bicycle_team: { positions: ["ems", "ems"], label: "Bicycle Team" },
  command_post: { positions: ["officer", "captain"], label: "Command Post" },
  rehab_station: { positions: ["ems", "firefighter"], label: "Rehab Station" },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApparatusTypeDefaults {
  positions: string[];
  minStaffing: number;
}

interface CustomPosition {
  value: string;
  label: string;
}

interface ResourceTypeDefaults {
  positions: string[];
  label: string;
}

interface ShiftSettings {
  defaultDurationHours: number;
  defaultMinStaffing: number;
  requireAssignmentConfirmation: boolean;
  overtimeThresholdHoursPerWeek: number;
  enabledPositions: string[];
  customPositions: CustomPosition[];
  apparatusTypeDefaults: Record<string, ApparatusTypeDefaults>;
  resourceTypeDefaults: Record<string, ResourceTypeDefaults>;
}

const SETTINGS_KEY = "scheduling_settings";

const DEFAULT_SETTINGS: ShiftSettings = {
  defaultDurationHours: 12,
  defaultMinStaffing: 4,
  requireAssignmentConfirmation: true,
  overtimeThresholdHoursPerWeek: 48,
  enabledPositions: [
    "officer",
    "driver",
    "firefighter",
    "ems",
    "captain",
    "lieutenant",
  ],
  customPositions: [],
  apparatusTypeDefaults: { ...DEFAULT_APPARATUS_TYPE_POSITIONS },
  resourceTypeDefaults: { ...DEFAULT_RESOURCE_TYPE_POSITIONS },
};

// ─── Component ───────────────────────────────────────────────────────────────

interface ShiftSettingsPanelProps {
  templates: ShiftTemplateRecord[];
  apparatusList: Array<{
    id: string;
    name: string;
    unit_number: string;
    apparatus_type: string;
    positions?: string[];
  }>;
  onNavigateToTemplates: () => void;
}

export const ShiftSettingsPanel: React.FC<ShiftSettingsPanelProps> = ({
  templates,
  apparatusList,
  onNavigateToTemplates,
}) => {
  const [settings, setSettings] = useState<ShiftSettings>(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      return stored
        ? {
            ...DEFAULT_SETTINGS,
            ...(JSON.parse(stored) as Partial<ShiftSettings>),
          }
        : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [saved, setSaved] = useState(false);

  // Custom position form
  const [newPositionValue, setNewPositionValue] = useState("");
  const [newPositionLabel, setNewPositionLabel] = useState("");

  // Editing apparatus type defaults
  const [editingApparatusType, setEditingApparatusType] = useState<
    string | null
  >(null);
  const [editPositions, setEditPositions] = useState<string[]>([]);
  const [editMinStaffing, setEditMinStaffing] = useState(1);

  // All position options (built-in + custom)
  const allPositionOptions = useMemo(() => {
    const builtIn = BUILTIN_POSITIONS.map((p) => ({ ...p }));
    const custom = settings.customPositions.filter(
      (cp) => !builtIn.some((bp) => bp.value === cp.value),
    );
    return [...builtIn, ...custom];
  }, [settings.customPositions]);

  const handleSave = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem(SETTINGS_KEY);
  };

  const togglePosition = (pos: string) => {
    setSettings((prev) => ({
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
    setSettings((prev) => ({
      ...prev,
      customPositions: [...prev.customPositions, { value: val, label: lbl }],
      enabledPositions: [...prev.enabledPositions, val],
    }));
    setNewPositionValue("");
    setNewPositionLabel("");
  };

  const removeCustomPosition = (val: string) => {
    setSettings((prev) => ({
      ...prev,
      customPositions: prev.customPositions.filter((p) => p.value !== val),
      enabledPositions: prev.enabledPositions.filter((p) => p !== val),
    }));
  };

  const startEditApparatusType = (type: string) => {
    const defaults = settings.apparatusTypeDefaults[type] ||
      DEFAULT_APPARATUS_TYPE_POSITIONS[type] || {
        positions: [],
        minStaffing: 1,
      };
    setEditingApparatusType(type);
    setEditPositions([...defaults.positions]);
    setEditMinStaffing(defaults.minStaffing);
  };

  const saveApparatusTypeDefaults = () => {
    if (!editingApparatusType) return;
    setSettings((prev) => ({
      ...prev,
      apparatusTypeDefaults: {
        ...prev.apparatusTypeDefaults,
        [editingApparatusType]: {
          positions: editPositions,
          minStaffing: editMinStaffing,
        },
      },
    }));
    setEditingApparatusType(null);
  };

  const activeTemplates = templates.filter((t) => t.is_active);

  // Collect all known apparatus types from both the defaults and current apparatus
  const knownApparatusTypes = useMemo(() => {
    const types = new Set(Object.keys(settings.apparatusTypeDefaults));
    Object.keys(DEFAULT_APPARATUS_TYPE_POSITIONS).forEach((t) => types.add(t));
    apparatusList.forEach((a) => types.add(a.apparatus_type));
    return Array.from(types).sort();
  }, [settings.apparatusTypeDefaults, apparatusList]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-theme-text-primary flex items-center gap-2">
          <Settings className="w-5 h-5" /> Shift Settings
        </h2>
        <p className="text-sm text-theme-text-muted mt-1">
          Configure department-wide defaults for shift scheduling.
        </p>
      </div>

      {/* Templates Overview */}
      <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-theme-text-primary">
            Shift Templates
          </h3>
          <button
            onClick={onNavigateToTemplates}
            className="text-sm text-violet-600 dark:text-violet-400 hover:underline"
          >
            Manage templates
          </button>
        </div>
        {activeTemplates.length === 0 ? (
          <div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">
                  No templates configured
                </p>
                <p className="text-xs text-theme-text-muted mt-0.5">
                  The system is using built-in defaults. Create custom templates
                  to define your department's shift structure with specific
                  times, positions, and staffing requirements.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {activeTemplates.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 p-3 bg-theme-surface-hover/50 rounded-lg"
              >
                {t.color && (
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: t.color }}
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-theme-text-primary truncate">
                    {t.name}
                  </p>
                  <p className="text-xs text-theme-text-muted">
                    {t.start_time_of_day} - {t.end_time_of_day} /{" "}
                    {t.duration_hours}h / min {t.min_staffing}
                  </p>
                  {t.positions && t.positions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {t.positions.map((pos, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300 rounded capitalize"
                        >
                          {pos}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {t.is_default && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-700 dark:text-green-400 rounded flex-shrink-0">
                    Default
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Apparatus Type Defaults */}
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
            const defaults = settings.apparatusTypeDefaults[type] ||
              DEFAULT_APPARATUS_TYPE_POSITIONS[type] || {
                positions: [],
                minStaffing: 1,
              };
            const vehiclesOfType = apparatusList.filter(
              (a) => a.apparatus_type === type,
            );
            const isEditing = editingApparatusType === type;

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
                          onClick={() => setEditingApparatusType(null)}
                          className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveApparatusTypeDefaults}
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
                        className="w-24 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-theme-text-secondary mb-1">
                        Default Positions (in seat order)
                      </label>
                      <div className="space-y-1.5">
                        {editPositions.map((pos, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs text-theme-text-muted w-5 text-right">
                              {i + 1}.
                            </span>
                            <select
                              value={pos}
                              onChange={(e) => {
                                const updated = [...editPositions];
                                updated[i] = e.target.value;
                                setEditPositions(updated);
                              }}
                              className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500"
                            >
                              {allPositionOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() =>
                                setEditPositions((prev) =>
                                  prev.filter((_, idx) => idx !== i),
                                )
                              }
                              className="p-1 text-red-500 hover:bg-red-500/10 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() =>
                          setEditPositions((prev) => [...prev, "firefighter"])
                        }
                        className="mt-1.5 text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Add seat
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <h4 className="text-sm font-semibold text-theme-text-primary capitalize">
                          {type}
                        </h4>
                        <span className="text-[10px] text-theme-text-muted bg-theme-surface-hover px-1.5 py-0.5 rounded">
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
                                className="px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-700 dark:text-red-400 rounded capitalize"
                              >
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => startEditApparatusType(type)}
                      className="text-xs text-violet-600 dark:text-violet-400 hover:underline flex-shrink-0"
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

      {/* Event Resource Type Defaults */}
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
            ([type, defaults]) => {
              const isEditing = editingApparatusType === `resource_${type}`;
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
                            onClick={() => setEditingApparatusType(null)}
                            className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              setSettings(
                                (prev) =>
                                  ({
                                    ...prev,
                                    resourceTypeDefaults: {
                                      ...prev.resourceTypeDefaults,
                                      [type]: {
                                        ...prev.resourceTypeDefaults[type],
                                        positions: editPositions,
                                      },
                                    },
                                  }) as ShiftSettings,
                              );
                              setEditingApparatusType(null);
                            }}
                            className="text-xs text-violet-600 dark:text-violet-400 font-medium hover:underline"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-theme-text-secondary mb-1">
                          Default Positions
                        </label>
                        <div className="space-y-1.5">
                          {editPositions.map((pos, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-xs text-theme-text-muted w-5 text-right">
                                {i + 1}.
                              </span>
                              <select
                                value={pos}
                                onChange={(e) => {
                                  const updated = [...editPositions];
                                  updated[i] = e.target.value;
                                  setEditPositions(updated);
                                }}
                                className="flex-1 px-2 py-1 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500"
                              >
                                {allPositionOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() =>
                                  setEditPositions((prev) =>
                                    prev.filter((_, idx) => idx !== i),
                                  )
                                }
                                className="p-1 text-red-500 hover:bg-red-500/10 rounded"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() =>
                            setEditPositions((prev) => [...prev, "ems"])
                          }
                          className="mt-1.5 text-xs text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Add position
                        </button>
                      </div>
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
                        onClick={() => {
                          setEditingApparatusType(`resource_${type}`);
                          setEditPositions([...defaults.positions]);
                        }}
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

      {/* Apparatus Inventory */}
      <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
        <h3 className="text-base font-semibold text-theme-text-primary mb-3">
          Apparatus Inventory
        </h3>
        {apparatusList.length === 0 ? (
          <p className="text-sm text-theme-text-muted">
            No apparatus configured. Shifts can be created without apparatus
            assignment.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {apparatusList.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 p-3 bg-theme-surface-hover/50 rounded-lg"
              >
                <Truck className="w-4 h-4 text-red-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-theme-text-primary truncate">
                    {a.unit_number} — {a.name}
                  </p>
                  <p className="text-xs text-theme-text-muted capitalize">
                    {a.apparatus_type}
                  </p>
                  {a.positions && a.positions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {a.positions.map((pos, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 text-[10px] bg-red-500/10 text-red-700 dark:text-red-400 rounded capitalize"
                        >
                          {pos}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Department Defaults */}
      <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 space-y-5">
        <h3 className="text-base font-semibold text-theme-text-primary">
          Department Defaults
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Default Shift Duration (hours)
            </label>
            <input
              type="number"
              value={settings.defaultDurationHours}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultDurationHours: parseFloat(e.target.value) || 12,
                }))
              }
              className="form-input focus:ring-violet-500"
              min="1"
              max="48"
              step="0.5"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Default Min Staffing
            </label>
            <input
              type="number"
              value={settings.defaultMinStaffing}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  defaultMinStaffing: parseInt(e.target.value, 10) || 1,
                }))
              }
              className="form-input focus:ring-violet-500"
              min="1"
              max="50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
              Overtime Threshold (hours/week)
            </label>
            <input
              type="number"
              value={settings.overtimeThresholdHoursPerWeek}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  overtimeThresholdHoursPerWeek:
                    parseInt(e.target.value, 10) || 48,
                }))
              }
              className="form-input focus:ring-violet-500"
              min="1"
              max="168"
            />
          </div>
          <div className="flex items-center">
            <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={settings.requireAssignmentConfirmation}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    requireAssignmentConfirmation: e.target.checked,
                  }))
                }
                className="rounded border-theme-input-border"
              />
              Require assignment confirmation
            </label>
          </div>
        </div>
      </div>

      {/* Custom Positions */}
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
                  className="rounded border-theme-input-border"
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
                      className="rounded border-theme-input-border"
                    />
                    <span className="text-sm text-theme-text-primary">
                      {cp.label}
                    </span>
                    <span className="text-[10px] text-theme-text-muted bg-theme-surface-hover px-1.5 py-0.5 rounded">
                      {cp.value}
                    </span>
                  </div>
                  <button
                    onClick={() => removeCustomPosition(cp.value)}
                    className="p-1 text-red-500 hover:bg-red-500/10 rounded"
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
              className="flex-1 px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder-theme-text-muted"
            />
            <button
              onClick={addCustomPosition}
              disabled={
                !newPositionLabel.trim() ||
                allPositionOptions.some((p) => p.value === newPositionValue)
              }
              className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              Add Position
            </button>
          </div>
          {newPositionLabel.trim() && (
            <p className="text-[10px] text-theme-text-muted mt-1">
              Internal key:{" "}
              <code className="bg-theme-surface-hover px-1 py-0.5 rounded">
                {newPositionValue}
              </code>
              {allPositionOptions.some((p) => p.value === newPositionValue) && (
                <span className="text-red-500 ml-1">— already exists</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Scheduling Notifications */}
      <SchedulingNotificationsPanel />

      {/* Save Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={handleReset}
          className="text-sm text-theme-text-muted hover:text-theme-text-primary transition-colors"
        >
          Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-sm text-green-600 dark:text-green-400">
              Settings saved
            </span>
          )}
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShiftSettingsPanel;
