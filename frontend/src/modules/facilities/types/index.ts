/**
 * Facilities module TypeScript interfaces
 *
 * Maps to the backend database models in app/models/facilities.py.
 * Property names use camelCase to match the API response format
 * (backend uses alias_generator=to_camel).
 *
 * Re-exports from the legacy types location for backwards compatibility
 * with FacilityRoomPicker and other cross-module consumers.
 */

// Re-export everything from the canonical types file so existing imports
// from '../../pages/facilities/types' continue to work, while new code
// in this module can import from './types'.
export type {
  Facility,
  FacilityType,
  FacilityStatus,
  MaintenanceType,
  MaintenanceRecord,
  FacilitySystem,
  Inspection,
  Room,
  TabId,
} from '../../../pages/facilities/types';

export {
  enumLabel,
  INSPECTION_TYPES,
  MAINTENANCE_CATEGORIES,
  ROOM_TYPES,
  SYSTEM_TYPES,
  ZONE_CLASSIFICATIONS,
  ZONE_CLASSIFICATION_COLORS,
} from '../../../pages/facilities/types';
