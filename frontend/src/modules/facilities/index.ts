/**
 * Facilities Module — Barrel Export
 *
 * Routes:
 *   getFacilitiesRoutes()       — protected routes (/facilities, /locations, /apparatus-basic)
 *   getFacilitiesPublicRoutes() — public kiosk route (/display/:code)
 *
 * Reusable component:
 *   FacilityRoomPicker — drop-in room selector for cross-module use
 *
 * Types:
 *   Re-exports all facility-related interfaces for external consumption
 */

export { getFacilitiesRoutes, getFacilitiesPublicRoutes } from './routes';

// Reusable room picker for other modules (events, training, scheduling)
export { default as FacilityRoomPicker } from '../../components/FacilityRoomPicker';

// Types for cross-module consumption
export type {
  Facility,
  FacilityType,
  FacilityStatus,
  Room,
  FacilitySystem,
  MaintenanceRecord,
  MaintenanceType,
  Inspection,
} from '../../pages/facilities/types';

export { enumLabel, ROOM_TYPES, SYSTEM_TYPES, ZONE_CLASSIFICATIONS, ZONE_CLASSIFICATION_COLORS } from '../../pages/facilities/types';
