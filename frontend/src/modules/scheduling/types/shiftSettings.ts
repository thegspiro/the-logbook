/**
 * Shift Settings Types & Constants
 *
 * Interfaces and default values used by the ShiftSettingsPanel and its
 * sub-components (PositionListEditor, ApparatusTypeDefaultsCard, etc.).
 */

// ─── Built-in position options ───────────────────────────────────────────────

export interface PositionOption {
  value: string;
  label: string;
}

export const BUILTIN_POSITIONS: PositionOption[] = [
  { value: "officer", label: "Officer" },
  { value: "driver", label: "Driver/Operator" },
  { value: "firefighter", label: "Firefighter" },
  { value: "ems", label: "EMT" },
  { value: "probationary", label: "Probationary" },
  { value: "volunteer", label: "Volunteer" },
];

// ─── Default positions per apparatus type ────────────────────────────────────

export const DEFAULT_APPARATUS_TYPE_POSITIONS: Record<
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

export const DEFAULT_RESOURCE_TYPE_POSITIONS: Record<
  string,
  { positions: string[]; label: string }
> = {
  first_aid_station: { positions: ["ems", "ems"], label: "First Aid Station" },
  bicycle_team: { positions: ["ems", "ems"], label: "Bicycle Team" },
  command_post: { positions: ["officer", "captain"], label: "Command Post" },
  rehab_station: { positions: ["ems", "firefighter"], label: "Rehab Station" },
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApparatusTypeDefaults {
  positions: string[];
  minStaffing: number;
}

export interface CustomPosition {
  value: string;
  label: string;
}

export interface ResourceTypeDefaults {
  positions: string[];
  label: string;
}

export interface ShiftSettings {
  defaultDurationHours: number;
  defaultMinStaffing: number;
  requireAssignmentConfirmation: boolean;
  overtimeThresholdHoursPerWeek: number;
  enabledPositions: string[];
  customPositions: CustomPosition[];
  apparatusTypeDefaults: Record<string, ApparatusTypeDefaults>;
  resourceTypeDefaults: Record<string, ResourceTypeDefaults>;
}

export const SETTINGS_KEY = "scheduling_settings";

export const DEFAULT_SETTINGS: ShiftSettings = {
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
