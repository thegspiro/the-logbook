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
  { value: 'officer', label: 'Officer' },
  { value: 'driver', label: 'Driver/Operator' },
  { value: 'firefighter', label: 'Firefighter' },
  { value: 'ems', label: 'EMT' },
  // Offered but not enabled by default: a BLS department never staffs a medic
  // seat, and a seat nobody can fill is worse than one they tick on. Turning
  // it on is one checkbox in Position Names.
  { value: 'paramedic', label: 'Paramedic' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'volunteer', label: 'Volunteer' },
];

// ─── Default positions per apparatus type ────────────────────────────────────

export const DEFAULT_APPARATUS_TYPE_POSITIONS: Record<string, { positions: string[]; minStaffing: number }> = {
  engine: {
    positions: ['officer', 'driver', 'firefighter', 'firefighter'],
    minStaffing: 4,
  },
  ladder: {
    positions: ['officer', 'driver', 'firefighter', 'firefighter'],
    minStaffing: 4,
  },
  ambulance: { positions: ['driver', 'ems', 'ems'], minStaffing: 2 },
  rescue: {
    positions: ['officer', 'driver', 'firefighter', 'firefighter'],
    minStaffing: 4,
  },
  tanker: { positions: ['driver', 'firefighter'], minStaffing: 2 },
  brush: { positions: ['driver', 'firefighter'], minStaffing: 2 },
  tower: {
    positions: ['officer', 'driver', 'firefighter', 'firefighter'],
    minStaffing: 4,
  },
  hazmat: {
    positions: ['officer', 'driver', 'firefighter', 'firefighter'],
    minStaffing: 4,
  },
  boat: { positions: ['officer', 'driver'], minStaffing: 2 },
  chief: { positions: ['officer'], minStaffing: 1 },
  utility: { positions: ['driver'], minStaffing: 1 },
};

// ─── Default positions per event resource type ───────────────────────────────

export const DEFAULT_RESOURCE_TYPE_POSITIONS: Record<string, { positions: string[]; label: string }> = {
  first_aid_station: { positions: ['ems', 'ems'], label: 'First Aid Station' },
  bicycle_team: { positions: ['ems', 'ems'], label: 'Bicycle Team' },
  command_post: { positions: ['officer', 'captain'], label: 'Command Post' },
  rehab_station: { positions: ['ems', 'firefighter'], label: 'Rehab Station' },
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

// ─── Shift report & post-shift validation settings (org.settings) ───────────

/**
 * The half of org.settings["shift_reports"] that Scheduling still owns.
 *
 * Its sibling `checklist_timing` is edited in Inventory (Inventory Admin → Checklist
 * Settings) and is deliberately absent here. The panel saves by sending this
 * object under `shift_reports`, and the settings endpoint deep-merges, so a key
 * this type does not carry is a key this panel cannot overwrite — which is what
 * keeps two screens in two modules from reverting each other.
 */
export interface ShiftReportSettings {
  post_shift_validation: {
    enabled: boolean;
    require_officer_report: boolean;
    validation_window_hours: number;
  };
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

/**
 * localStorage key for the read-only mirror of the department settings.
 * The backend (/scheduling/shift-settings) is the source of truth; this key
 * is only an offline/API-failure fallback and the source for the one-time
 * migration of pre-backend private copies (see services/shiftSettingsApi.ts).
 *
 * This is a PREFIX, not the key itself: the mirror is written per
 * organization as `scheduling_settings:{orgId}`, so logging into another
 * department on the same browser cannot be served this one's settings. A
 * legacy bare key is deliberately ignored because its owning organization
 * cannot be established safely.
 */
export const SETTINGS_KEY = 'scheduling_settings';

export const DEFAULT_SETTINGS: ShiftSettings = {
  defaultDurationHours: 12,
  defaultMinStaffing: 4,
  requireAssignmentConfirmation: true,
  overtimeThresholdHoursPerWeek: 48,
  enabledPositions: ['officer', 'driver', 'firefighter', 'ems', 'captain', 'lieutenant'],
  customPositions: [],
  apparatusTypeDefaults: { ...DEFAULT_APPARATUS_TYPE_POSITIONS },
  resourceTypeDefaults: { ...DEFAULT_RESOURCE_TYPE_POSITIONS },
};
